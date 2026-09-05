import { Config, Effect, Schema } from "effect"
import { defineMutation } from "../contract/contract.ts"
import { planToken } from "../contract/token.ts"
import { ImagePlan, ImageResult, LoginPlan, LogoutPlan } from "../domain/local.ts"
import { Errors } from "../errors.ts"
import { LocalReader, LocalWriter } from "../services/local.ts"

const sessionFile = {
  kind: "flag",
  type: "path",
  description: "Saved session file; defaults to TR_SESSION_FILE or .trainerroad/session.json",
} as const
const domainErrorCodes = [
  "invalid_usage",
  "invalid_config",
  "invalid_data",
  "auth_failure",
  "cannot_write",
  "resource_conflict",
  "stale_confirmation",
  "service_unavailable",
] as const

export const login = defineMutation({
  name: "login",
  summary: "Authenticate and save a session",
  stability: "stable",
  params: {
    sessionFile,
    username: {
      kind: "flag",
      type: "string",
      description: "Account username; defaults to TR_USERNAME",
    },
    passwordStdin: {
      kind: "flag",
      type: "boolean",
      description:
        "Read one password line from piped stdin during apply; otherwise use TR_PASSWORD",
    },
    returnPath: {
      kind: "flag",
      type: "string",
      default: "/app/career",
      description: "TrainerRoad return path",
    },
  },
  planSchema: LoginPlan,
  dataSchema: Schema.Struct({ authenticated: Schema.Boolean, username: Schema.String }),
  domainErrorCodes,
  guides: ["session-and-ids"],
  idempotency: { kind: "none" },
  examples: [
    {
      command: "trainerroad-cli login --username rider --password-stdin --yes --json",
      description: "Read the password from piped stdin and save the session",
    },
  ],
  plan: Effect.fn("login.plan")(function* (input) {
    const username =
      input.username ??
      (yield* Config.string("TR_USERNAME").pipe(
        Config.withDefault(""),
        Effect.mapError(() =>
          Errors.invalidConfig({ message: "TR_USERNAME is invalid", fix: "provide --username" }),
        ),
      ))
    if (!username.trim())
      return yield* Errors.invalidUsage({
        message: "username is required",
        fix: "provide --username or set TR_USERNAME",
      })
    if (!input.returnPath.startsWith("/") || input.returnPath.startsWith("//"))
      return yield* Errors.invalidUsage({
        message: "return path must be relative to TrainerRoad",
        fix: "use --return-path /app/career",
      })
    const reader = yield* LocalReader
    return {
      ...(yield* reader.session(input.sessionFile)),
      username,
      returnPath: input.returnPath,
      passwordStdin: input.passwordStdin,
    }
  }),
  apply: Effect.fn("login.apply")(function* (plan) {
    return yield* (yield* LocalWriter).login(plan)
  }),
  renderPlanText: (plan) =>
    `Authenticate ${plan.username} and save the session to ${plan.sessionFile}. Credentials are read only after confirmation.`,
  next: ({ plan }) => [
    {
      message: "verify the authenticated account",
      args: ["whoami", "--session-file", plan.sessionFile, "--json"],
    },
  ],
})

export const logout = defineMutation({
  name: "logout",
  summary: "Remove the local saved session",
  stability: "stable",
  params: { sessionFile },
  planSchema: LogoutPlan,
  dataSchema: Schema.Struct({ cleared: Schema.Boolean }),
  domainErrorCodes,
  guides: ["session-and-ids"],
  idempotency: { kind: "always" },
  examples: [],
  plan: Effect.fn("logout.plan")(function* (input) {
    return yield* (yield* LocalReader).session(input.sessionFile)
  }),
  apply: Effect.fn("logout.apply")(function* (plan) {
    return yield* (yield* LocalWriter).logout(plan)
  }),
  renderPlanText: (plan) =>
    plan.previous === null
      ? "No saved session to remove."
      : `Remove the local session at ${plan.sessionFile}. This does not revoke other sessions.`,
})

export const workoutImage = defineMutation({
  name: "workout-image",
  summary: "Save a workout chart to a new PNG or SVG file",
  stability: "stable",
  params: {
    sessionFile,
    id: {
      kind: "flag",
      type: "integer",
      required: true,
      description: "Required workout library id",
    },
    file: {
      kind: "flag",
      type: "path",
      description: "New destination file; existing files are never overwritten",
    },
    imageFormat: {
      kind: "flag",
      type: "choice",
      choices: ["png", "svg"],
      description: "Image type, inferred from --file when absent; defaults to PNG",
    },
    width: {
      kind: "flag",
      type: "integer",
      default: 1200,
      description: "PNG width in pixels, 1 to 8192",
    },
    background: {
      kind: "flag",
      type: "string",
      default: "#1c1c1c",
      description: "PNG background color",
    },
  },
  planSchema: ImagePlan,
  dataSchema: ImageResult,
  domainErrorCodes,
  guides: ["session-and-ids"],
  idempotency: { kind: "none" },
  examples: [
    {
      command: "trainerroad-cli workout-image --id 18128 --image-format svg --dry-run --json",
      description: "Preview a chart export without writing a file",
    },
  ],
  plan: Effect.fn("workoutImage.plan")(function* (input) {
    if (input.id === undefined || input.id < 1)
      return yield* Errors.invalidUsage({
        message: "a positive workout --id is required",
        fix: "use a library id from workout-library",
      })
    if (input.width < 1 || input.width > 8192)
      return yield* Errors.invalidUsage({
        message: "width must be between 1 and 8192",
        fix: "use --width 1200",
      })
    const imageFormat =
      input.imageFormat ?? (input.file?.toLowerCase().endsWith(".svg") ? "svg" : "png")
    const reader = yield* LocalReader
    const session = yield* reader.session(input.sessionFile)
    const file = yield* reader.output(input.file ?? `workout-${input.id}.${imageFormat}`)
    const chart = yield* reader.image(session.sessionFile, input.id)
    return {
      sessionFile: session.sessionFile,
      member: chart.member,
      workoutId: input.id,
      chartUrl: chart.url,
      chartDigest: planToken(chart.svg),
      file,
      imageFormat,
      width: input.width,
      background: input.background,
    }
  }),
  apply: Effect.fn("workoutImage.apply")(function* (plan) {
    return yield* (yield* LocalWriter).image(plan)
  }),
  renderPlanText: (plan) =>
    `Write ${plan.imageFormat.toUpperCase()} for workout ${plan.workoutId} to ${plan.file}`,
})
