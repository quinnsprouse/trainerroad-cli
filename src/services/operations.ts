import { Clock, Config, Context, Effect, Layer, Path, Schema } from "effect"
import { AppError, Errors } from "../errors.ts"
import { Flags, JsonObject, OperationPlan } from "../domain/operation.ts"
import { calendarFollowUp } from "../domain/follow-up.ts"
import { runOperation } from "./operation-transport.mjs"

export class OperationsReader extends Context.Service<
  OperationsReader,
  {
    query(name: string, flags: Flags): Effect.Effect<Schema.Json, AppError>
    plan(name: string, flags: Flags): Effect.Effect<OperationPlan, AppError>
  }
>()("trainerroad/OperationsReader") {}
export class OperationsWriter extends Context.Service<
  OperationsWriter,
  {
    apply(plan: OperationPlan): Effect.Effect<Schema.Json, AppError>
  }
>()("trainerroad/OperationsWriter") {}

const decodeStatus = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.Int }))
const decodePreview = Schema.decodeUnknownEffect(OperationPlan.fields.preview)
const decodeObject = Schema.decodeUnknownEffect(JsonObject)
const invalidResponse = () =>
  Errors.invalidData({
    message: "TrainerRoad returned an unexpected response",
    fix: "check the command against the current API before retrying",
  })
export const operationFailure = (cause: unknown): AppError => {
  if (Schema.is(AppError)(cause)) return cause
  const status = decodeStatus(cause)
  if (status._tag === "Some") {
    if (status.value.status === 401 || status.value.status === 403)
      return Errors.authFailure({
        message: "saved session was rejected",
        fix: "run trainerroad-cli login --username <username> --password-stdin --yes",
      })
    if (status.value.status === 404)
      return Errors.notFound({
        message: "requested resource was not found",
        fix: "list the relevant resources and check the id",
      })
    if (status.value.status >= 500 || status.value.status === 429)
      return Errors.serviceUnavailable({
        message: "TrainerRoad is temporarily unavailable",
        fix: "wait before retrying a read; verify calendar state before another write",
      })
    return Errors.invalidData({
      message: "TrainerRoad rejected the request",
      fix: "check the command parameters and the account before retrying",
    })
  }
  if (
    cause instanceof Error &&
    /^(Invalid |Missing required |No .* matched|Ambiguous |--|add-event needs)/.test(cause.message)
  )
    return Errors.invalidUsage({
      message: cause.message,
      fix: "run trainerroad-cli describe --command <command> --json and correct the inputs",
    })
  if (
    cause instanceof Error &&
    /requires private authenticated|Authentication required/.test(cause.message)
  )
    return Errors.authFailure({
      message: "this command requires an authenticated session",
      fix: "run trainerroad-cli login --username <username> --password-stdin --yes",
    })
  return Errors.serviceUnavailable({
    message: "could not complete the TrainerRoad request",
    fix: "check connectivity and account access before retrying",
  })
}

const contextualFailure = (cause: unknown, command: string, plan?: OperationPlan): AppError => {
  const error = operationFailure(cause)
  const fields = {
    code: error.code,
    message: error.message,
    fix: error.fix,
    transient: error.transient,
    exit: error.exit,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.guides !== undefined ? { guides: error.guides } : {}),
  }
  if (error.code === "cannot_write" && plan !== undefined)
    return new AppError({ ...fields, next: calendarFollowUp(plan) })
  if (error.code === "auth_failure")
    return new AppError({
      ...fields,
      fix: "read the session guide, then log in using the same --session-file as this command",
      next: [
        {
          message: "learn how to authenticate safely",
          args: ["guide", "get", "session-and-ids", "--json"],
        },
      ],
    })
  if (error.code === "invalid_usage")
    return new AppError({
      ...fields,
      fix: `run trainerroad-cli describe --command ${command} --json and correct the inputs`,
      next: [
        {
          message: "inspect this command's inputs",
          args: ["describe", "--command", command, "--json"],
        },
      ],
    })
  return error
}

export const operationsLayer = (execute: typeof runOperation = runOperation) => {
  const api = Effect.gen(function* () {
    const path = yield* Path.Path
    const resolveFlags = Effect.fn("operations.resolveFlags")(function* (input: Flags) {
      const configured = yield* Config.string("TR_SESSION_FILE").pipe(
        Config.withDefault(".trainerroad/session.json"),
        Effect.mapError(() =>
          Errors.invalidConfig({
            message: "invalid TR_SESSION_FILE",
            fix: "set a session file path",
          }),
        ),
      )
      const tz =
        input.tz ??
        (yield* Config.string("TR_TIMEZONE").pipe(
          Config.withDefault(Intl.DateTimeFormat().resolvedOptions().timeZone),
          Effect.mapError(() =>
            Errors.invalidConfig({ message: "invalid TR_TIMEZONE", fix: "use an IANA timezone" }),
          ),
        ))
      yield* Effect.try({
        try: () => new Intl.DateTimeFormat("en", { timeZone: String(tz) }).resolvedOptions(),
        catch: () =>
          Errors.invalidUsage({
            message: "invalid timezone",
            fix: "use --tz with an IANA timezone such as America/New_York",
          }),
      })
      return {
        ...input,
        "session-file": path.resolve(String(input["session-file"] ?? configured)),
        tz,
      }
    })
    const query = Effect.fn("operations.query")(function* (name: string, input: Flags) {
      const flags = yield* resolveFlags(input)
      const now = yield* Clock.currentTimeMillis
      const raw = yield* Effect.tryPromise({
        try: (signal) => execute(name, flags, "query", now, signal),
        catch: (cause) => contextualFailure(cause, name),
      })
      const data = yield* decodeObject(raw).pipe(Effect.mapError(invalidResponse))
      if (Array.isArray(data.records)) {
        const { records, ...rest } = data
        return { ...rest, command: name, items: records, count: records.length }
      }
      return { ...data, command: name }
    })
    const plan = Effect.fn("operations.plan")(function* (command: string, input: Flags) {
      const flags = yield* resolveFlags(input)
      const now = yield* Clock.currentTimeMillis
      const raw = yield* Effect.tryPromise({
        try: (signal) => execute(command, flags, "plan", now, signal),
        catch: (cause) => contextualFailure(cause, command),
      })
      const data = yield* decodeObject(raw).pipe(Effect.mapError(invalidResponse))
      const { generatedAt: _generatedAt, ...stable } = data
      const preview = yield* decodePreview(stable).pipe(Effect.mapError(invalidResponse))
      return { command, flags, preview }
    })
    const apply = Effect.fn("operations.apply")(function* (confirmed: OperationPlan) {
      const now = yield* Clock.currentTimeMillis
      const raw = yield* Effect.tryPromise({
        try: (signal) =>
          execute(confirmed.command, confirmed.flags, "apply", now, signal, confirmed.preview),
        catch: (cause) => contextualFailure(cause, confirmed.command, confirmed),
      })
      return yield* decodeObject(raw).pipe(
        Effect.mapError(() =>
          Errors.cannotWrite({
            message: "write response could not be decoded",
            fix: "read the calendar before retrying the write",
            next: calendarFollowUp(confirmed),
          }),
        ),
      )
    })
    return { query, plan, apply }
  })
  return Layer.merge(
    Layer.effect(OperationsReader, Effect.map(api, OperationsReader.of)),
    Layer.effect(OperationsWriter, Effect.map(api, OperationsWriter.of)),
  )
}
