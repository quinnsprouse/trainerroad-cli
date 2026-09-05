import { Cause, Config, Context, Effect, Layer, Path, Schema } from "effect"
import { canonicalJson } from "../contract/token.ts"
import { Member } from "../domain/calendar.ts"
import { Flags } from "../domain/operation.ts"
import {
  WorkflowData,
  WorkflowPlan,
  Submitted,
  type Workflow,
  type ApiRequest,
} from "../domain/workflow.ts"
import { workflows } from "../domain/workflows.ts"
import { AppError, Errors } from "../errors.ts"
import { operationFailure } from "./operations.ts"
import { createWorkflowTransport } from "./workflow-transport.mjs"

export class WorkflowReader extends Context.Service<
  WorkflowReader,
  {
    query(
      name: string,
      input: Flags,
      sessionFile?: string,
    ): Effect.Effect<typeof WorkflowData.Type, AppError>
    plan(name: string, input: Flags, sessionFile?: string): Effect.Effect<WorkflowPlan, AppError>
  }
>()("trainerroad/WorkflowReader") {}
export class WorkflowWriter extends Context.Service<
  WorkflowWriter,
  {
    apply(plan: WorkflowPlan): Effect.Effect<typeof Submitted.Type, AppError>
  }
>()("trainerroad/WorkflowWriter") {}

const invalidResponse = () =>
  Errors.invalidData({
    message: "unexpected workflow response",
    fix: "stop and check the current TrainerRoad API before proceeding",
  })
const selectWorkflow = (name: string): Workflow => {
  const spec = workflows.find((item) => item.name === name)
  if (spec === undefined)
    throw Errors.invalidUsage({
      message: "unknown workflow",
      fix: "run describe --json to select a supported workflow",
    })
  return spec
}
const checked = <A>(run: () => A) => Effect.try({ try: run, catch: operationFailure })

const sessionFailure = (cause: unknown, session: string): AppError => {
  const error = operationFailure(cause)
  if (error.code !== "auth_failure") return error
  return Errors.authFailure({
    message: error.message,
    fix: "read the session guide, then preview login using the same --session-file; confirm only the user's authorized login",
    details: { sessionFile: session },
    guides: ["session-and-ids"],
    next: [
      {
        message: `authenticate using the selected session path: ${session}`,
        args: ["guide", "get", "session-and-ids", "--json"],
      },
    ],
  })
}

const contextual = (error: AppError, spec: Workflow, session: string): AppError => {
  if (error.next !== undefined) return error
  const next =
    error.code === "not_found" && spec.discover !== undefined
      ? spec.discover(session)
      : [
          {
            message: "inspect the workflow requirements",
            args: ["describe", "--command", spec.name, "--json"],
          },
          {
            message: "read the workflow's prerequisites and recovery steps",
            args: [
              "guide",
              "get",
              error.code === "auth_failure" ? "session-and-ids" : spec.guide,
              "--json",
            ],
          },
        ]
  return new AppError({
    code: error.code,
    message: error.message,
    fix: error.fix,
    transient: error.transient,
    exit: error.exit,
    guides: [spec.guide],
    next,
  })
}

export const workflowsLayer = (
  factory: typeof createWorkflowTransport = createWorkflowTransport,
) => {
  const api = Effect.gen(function* () {
    const path = yield* Path.Path
    const open = Effect.fn("workflow.open")(function* (file?: string) {
      const configured =
        file ??
        (yield* Config.string("TR_SESSION_FILE").pipe(
          Config.withDefault(".trainerroad/session.json"),
          Effect.mapError(() =>
            Errors.invalidConfig({
              message: "invalid session configuration",
              fix: "set TR_SESSION_FILE to a nonempty path",
            }),
          ),
        ))
      if (configured.trim().length === 0)
        return yield* Errors.invalidUsage({
          message: "empty session path",
          fix: "supply a nonempty --session-file",
        })
      const sessionFile = path.resolve(configured)
      const client = factory(sessionFile)
      const loaded = yield* Effect.tryPromise({
        try: () => client.load(),
        catch: (cause) => sessionFailure(cause, sessionFile),
      })
      if (!loaded)
        return yield* sessionFailure(
          Errors.authFailure({
            message: "no authenticated session",
            fix: "authenticate the selected session",
          }),
          sessionFile,
        )
      const raw = yield* Effect.tryPromise({
        try: (signal) => client.member(signal),
        catch: (cause) => sessionFailure(cause, sessionFile),
      })
      const member = yield* Schema.decodeUnknownEffect(Member)(raw).pipe(
        Effect.mapError(invalidResponse),
      )
      return { sessionFile, client, member }
    })
    const inspect = Effect.fn("workflow.inspect")(function* (
      spec: Workflow,
      input: Flags,
      account: Effect.Success<ReturnType<typeof open>>,
    ) {
      const read = (requests: Readonly<Record<string, ApiRequest>>) =>
        Effect.forEach(Object.entries(requests), ([key, request]) =>
          Effect.gen(function* () {
            const raw = yield* Effect.tryPromise({
              try: (signal) => account.client.request(request, signal, false),
              catch: (cause) => sessionFailure(cause, account.sessionFile),
            })
            const data = yield* Schema.decodeUnknownEffect(Schema.Json)(raw).pipe(
              Effect.mapError(invalidResponse),
            )
            return [key, data] as const
          }),
        )
      const requests = yield* checked(() => spec.reads(input, account.member))
      const initial = Object.fromEntries(yield* read(requests))
      const additional = yield* checked(() => spec.hydrate?.(initial, input, account.member) ?? {})
      if (Object.keys(additional).some((key) => Object.hasOwn(initial, key)))
        return yield* invalidResponse()
      const records = { ...initial, ...Object.fromEntries(yield* read(additional)) }
      return yield* checked(() => spec.select?.(records, input) ?? records)
    })
    const validate = (spec: Workflow, input: Flags) =>
      checked(() => {
        for (const [key, param] of Object.entries(spec.params)) {
          const v = input[key]
          if (param.kind === "flag" && param.required && v === undefined)
            throw Errors.invalidUsage({
              message: `missing ${key}`,
              fix: "provide every required flag shown by describe",
            })
          if (v !== undefined && param.type === "choice" && !param.choices.includes(String(v)))
            throw Errors.invalidUsage({
              message: `invalid ${key}`,
              fix: `choose ${param.choices.join(", ")}`,
            })
          if (
            v !== undefined &&
            ((param.type === "integer" && (typeof v !== "number" || !Number.isSafeInteger(v))) ||
              (param.type === "boolean" && typeof v !== "boolean") ||
              ((param.type === "path" || param.type === "string" || param.type === "choice") &&
                typeof v !== "string"))
          )
            throw Errors.invalidUsage({
              message: `invalid value type for ${key}`,
              fix: "use the value type declared by describe",
            })
        }
        for (const key of Object.keys(input))
          if (!Object.hasOwn(spec.params, key))
            throw Errors.invalidUsage({
              message: `unexpected workflow input ${key}`,
              fix: "use only flags declared by this command",
            })
        spec.validate?.(input)
      })
    const prepare = Effect.fn("workflow.prepare")(function* (
      name: string,
      input: Flags,
      file?: string,
    ) {
      const spec = yield* checked(() => selectWorkflow(name))
      yield* validate(spec, input)
      if (spec.write === undefined)
        return yield* Errors.invalidUsage({
          message: "cannot apply a read workflow",
          fix: "run the query without confirmation flags",
        })
      const account = yield* open(file)
      const before = yield* inspect(spec, input, account).pipe(
        Effect.mapError((error) => contextual(error, spec, account.sessionFile)),
      )
      const request: ApiRequest = yield* checked(() => spec.write!(input, account.member, before))
      return {
        plan: {
          command: name,
          input,
          sessionFile: account.sessionFile,
          member: account.member,
          before,
          request,
        },
        account,
        spec,
      }
    })
    const query = Effect.fn("workflow.query")(function* (
      name: string,
      input: Flags,
      file?: string,
    ) {
      const spec = yield* checked(() => selectWorkflow(name))
      yield* validate(spec, input)
      if (spec.write !== undefined)
        return yield* Errors.invalidUsage({
          message: "mutation requires a plan",
          fix: "preview the mutation and confirm it",
        })
      const account = yield* open(file)
      return {
        member: account.member,
        sessionFile: account.sessionFile,
        records: yield* inspect(spec, input, account).pipe(
          Effect.mapError((error) => contextual(error, spec, account.sessionFile)),
        ),
      }
    })
    const plan = Effect.fn("workflow.plan")(function* (name: string, input: Flags, file?: string) {
      return (yield* prepare(name, input, file)).plan
    })
    const apply = Effect.fn("workflow.apply")(function* (confirmed: WorkflowPlan) {
      const {
        plan: current,
        account,
        spec,
      } = yield* prepare(confirmed.command, confirmed.input, confirmed.sessionFile)
      if (canonicalJson(current) !== canonicalJson(confirmed))
        return yield* Errors.staleConfirmation({
          message: "the account or workflow state changed after preview",
          fix: "inspect a fresh preview without --confirm or --yes",
        })
      // A successful HTTP response is an acknowledgement, not proof of completed background work.
      const uncertain = () =>
        Errors.cannotWrite({
          message: "the request may already have been applied",
          fix: "run the suggested read-only check before retrying; never repeat this write blindly",
          guides: [spec.guide],
          next: spec.next(current.input, current.sessionFile, current.before),
        })
      yield* Effect.uninterruptibleMask((restore) =>
        restore(
          Effect.tryPromise({
            try: (signal) => account.client.request(current.request, signal, true),
            catch: uncertain,
          }).pipe(
            Effect.flatMap((response) =>
              response === false ? Effect.fail(uncertain()) : Effect.void,
            ),
          ),
        ).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.fail(uncertain()) : Effect.failCause(cause),
          ),
        ),
      )
      return { member: current.member, submitted: true as const, verification: "required" as const }
    })
    return { query, plan, apply }
  })
  return Layer.merge(
    Layer.effect(WorkflowReader, Effect.map(api, WorkflowReader.of)),
    Layer.effect(WorkflowWriter, Effect.map(api, WorkflowWriter.of)),
  )
}
