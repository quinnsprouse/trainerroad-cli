import { Config, Context, Effect, Layer, Path, Schema } from "effect"
import { AppError, Errors } from "../errors.ts"
import { moveFollowUp } from "../domain/follow-up.ts"
import {
  Member,
  AccountProfile,
  MovePlan,
  MoveResult,
  PlannedActivity,
  RawActivity,
  normalizeActivity,
  sameActivity,
} from "../domain/calendar.ts"
import { createTransport } from "./transport.mjs"

type TransportFactory = typeof createTransport
interface Account {
  readonly sessionFile: string
  readonly member: Member
  readonly profile: AccountProfile
}
interface ReaderApi {
  readonly account: (sessionFile?: string) => Effect.Effect<Account, AppError>
  readonly planned: (
    id: string,
    sessionFile?: string,
  ) => Effect.Effect<Account & { readonly activity: PlannedActivity }, AppError>
}
interface WriterApi {
  readonly move: (plan: MovePlan) => Effect.Effect<MoveResult, AppError>
}

export class TrainerRoadReader extends Context.Service<TrainerRoadReader, ReaderApi>()(
  "trainerroad/Reader",
) {}
export class TrainerRoadWriter extends Context.Service<TrainerRoadWriter, WriterApi>()(
  "trainerroad/Writer",
) {}

const LOGIN_FIX =
  "run trainerroad-cli login --username <username> --password-stdin --yes with the same --session-file, then retry"
const LOGIN_NEXT = [
  {
    message: "learn how to authenticate safely",
    args: ["guide", "get", "session-and-ids", "--json"],
  },
] as const
const decodeStatus = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.Int }))
const readFailure = (cause: unknown): AppError => {
  const decoded = decodeStatus(cause)
  const status = decoded._tag === "Some" ? decoded.value.status : undefined
  if (status === 401 || status === 403) {
    return Errors.authFailure({
      message: "TrainerRoad rejected the saved session",
      fix: LOGIN_FIX,
      next: LOGIN_NEXT,
    })
  }
  if (status === 404) {
    return Errors.notFound({
      message: "TrainerRoad could not find the requested resource",
      fix: "list the calendar and use its planned activity id, not a workout library id",
    })
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
    return Errors.invalidData({
      message: "TrainerRoad rejected the request",
      fix: "check the account and planned activity id before retrying",
    })
  }
  return Errors.serviceUnavailable({
    message: "could not read TrainerRoad",
    fix: "check connectivity; wait before retrying a read",
  })
}
const invalidResponse = () =>
  Errors.invalidData({
    message: "TrainerRoad returned an unexpected response",
    fix: "stop and check the client against the current TrainerRoad API; do not infer missing fields",
  })
const decodeMember = Schema.decodeUnknownEffect(Member)
const decodeRaw = Schema.decodeUnknownEffect(RawActivity)
const decodeActivity = Schema.decodeUnknownEffect(PlannedActivity)
const activity = Effect.fn("trainerroad.decodeActivity")(function* (raw: unknown) {
  const decoded = yield* decodeRaw(raw)
  return yield* decodeActivity(normalizeActivity(decoded))
}, Effect.mapError(invalidResponse))
const stale = () =>
  Errors.staleConfirmation({
    message: "the account or planned activity changed after the preview",
    fix: "re-run without --confirm to inspect a fresh plan",
  })
const uncertainWrite = (plan: MovePlan) =>
  Errors.cannotWrite({
    message: "the move could not be verified; it may already have happened",
    fix: "read the calendar around both dates before deciding whether to retry; do not repeat the write blindly",
    guides: ["calendar-changes"],
    next: moveFollowUp(plan),
  })

const makeApi = (factory: TransportFactory) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const sessionPath = Effect.fn("trainerroad.sessionPath")(function* (input?: string) {
      const configured =
        input ??
        (yield* Config.string("TR_SESSION_FILE").pipe(
          Config.withDefault(".trainerroad/session.json"),
          Effect.mapError(() =>
            Errors.invalidConfig({
              message: "invalid TR_SESSION_FILE",
              fix: "set TR_SESSION_FILE to a session file path",
            }),
          ),
        ))
      if (configured.trim().length === 0) {
        return yield* Errors.invalidUsage({
          message: "session file path is empty",
          fix: "provide a nonempty --session-file path",
        })
      }
      return path.resolve(configured)
    })
    const request = <A>(run: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({ try: run, catch: readFailure })
    const open = Effect.fn("trainerroad.open")(function* (input?: string) {
      const sessionFile = yield* sessionPath(input)
      const client = factory(sessionFile)
      const loaded = yield* request(() => client.load())
      if (!loaded)
        return yield* Errors.authFailure({
          message: "no readable saved session",
          fix: LOGIN_FIX,
          next: LOGIN_NEXT,
        })
      const raw = yield* request((signal) => client.member(signal))
      const member = yield* decodeMember(raw).pipe(Effect.mapError(invalidResponse))
      const profile = yield* Schema.decodeUnknownEffect(AccountProfile)(raw).pipe(
        Effect.mapError(invalidResponse),
      )
      return { sessionFile, member, profile, client }
    })
    const account = Effect.fn("trainerroad.account")(function* (input?: string) {
      const { sessionFile, member, profile } = yield* open(input)
      return { sessionFile, member, profile }
    })
    const planned = Effect.fn("trainerroad.planned")(function* (id: string, input?: string) {
      const { sessionFile, member, profile, client } = yield* open(input)
      const raw = yield* request((signal) => client.planned(id, member.username, signal))
      const item = yield* activity(raw)
      if (item.id !== id) return yield* invalidResponse()
      return { sessionFile, member, profile, activity: item }
    })
    const move = Effect.fn("trainerroad.move")(function* (plan: MovePlan) {
      const { member, client } = yield* open(plan.sessionFile)
      if (member.memberId !== plan.member.memberId || member.username !== plan.member.username)
        return yield* stale()
      const raw = yield* request((signal) =>
        client.planned(plan.before.id, member.username, signal),
      )
      const before = yield* activity(raw)
      if (!sameActivity(before, plan.before)) return yield* stale()
      if (before.date === plan.to) return { member, before, after: before, changed: false }
      if (before.canMove === false)
        return yield* Errors.invalidData({
          message: "this planned activity cannot be moved",
          fix: "choose a movable planned workout in the calendar",
        })
      // A failed response after PUT does not tell us whether the server applied it.
      yield* request((signal) => client.move(before.id, plan.to, member.username, signal)).pipe(
        Effect.mapError(() => uncertainWrite(plan)),
      )
      const afterRaw = yield* request((signal) =>
        client.planned(before.id, member.username, signal),
      ).pipe(Effect.mapError(() => uncertainWrite(plan)))
      const after = yield* activity(afterRaw).pipe(Effect.mapError(() => uncertainWrite(plan)))
      if (after.id !== before.id || after.date !== plan.to) return yield* uncertainWrite(plan)
      return { member, before, after, changed: true }
    })
    return { account, planned, move }
  })

export const trainerRoadLayer = (factory: TransportFactory = createTransport) => {
  const api = makeApi(factory)
  return Layer.merge(
    Layer.effect(TrainerRoadReader, Effect.map(api, TrainerRoadReader.of)),
    Layer.effect(TrainerRoadWriter, Effect.map(api, TrainerRoadWriter.of)),
  )
}
