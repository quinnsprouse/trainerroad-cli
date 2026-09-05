import { Config, Context, Effect, FileSystem, Layer, Path, Schema, Stdio, Stream } from "effect"
import { planToken } from "../contract/token.ts"
import { Member } from "../domain/calendar.ts"
import type { LoginPlan, LogoutPlan, ImagePlan, ImageResult } from "../domain/local.ts"
import { AppError, Errors } from "../errors.ts"
import { operationFailure } from "./operations.ts"
import * as transport from "./local-transport.mjs"

const Chart = Schema.Struct({ member: Member, url: Schema.String, svg: Schema.NonEmptyString })
type Chart = typeof Chart.Type
interface Reader {
  session(input?: string): Effect.Effect<LogoutPlan, AppError>
  image(sessionFile: string, workoutId: number): Effect.Effect<Chart, AppError>
  output(input: string): Effect.Effect<string, AppError>
}
interface Writer {
  login(plan: LoginPlan): Effect.Effect<{ authenticated: boolean; username: string }, AppError>
  logout(plan: LogoutPlan): Effect.Effect<{ cleared: boolean }, AppError>
  image(plan: ImagePlan): Effect.Effect<ImageResult, AppError>
}
export class LocalReader extends Context.Service<LocalReader, Reader>()(
  "trainerroad/LocalReader",
) {}
export class LocalWriter extends Context.Service<LocalWriter, Writer>()(
  "trainerroad/LocalWriter",
) {}
const fileError = () =>
  Errors.cannotWrite({
    message: "cannot access the selected file",
    fix: "check the file path and permissions",
  })
const stale = () =>
  Errors.staleConfirmation({
    message: "the session or chart changed since the preview",
    fix: "inspect a new plan before confirming",
  })

export const localLayer = (remote: typeof transport = transport) => {
  const api = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const stdio = yield* Stdio.Stdio
    const fingerprint = Effect.fn("local.fingerprint")(function* (file: string) {
      if (!(yield* fs.exists(file))) return null
      const data = yield* fs.readFile(file)
      return planToken(Array.from(data))
    }, Effect.mapError(fileError))
    const session = Effect.fn("local.session")(function* (input?: string) {
      const configured =
        input ??
        (yield* Config.string("TR_SESSION_FILE").pipe(
          Config.withDefault(".trainerroad/session.json"),
          Effect.mapError(fileError),
        ))
      if (!configured.trim())
        return yield* Errors.invalidUsage({
          message: "session path is empty",
          fix: "provide --session-file with a file path",
        })
      const sessionFile = path.resolve(configured)
      return { sessionFile, previous: yield* fingerprint(sessionFile) }
    })
    const image = Effect.fn("local.readChart")(function* (sessionFile: string, workoutId: number) {
      const raw = yield* Effect.tryPromise({
        try: (signal) => remote.chart(sessionFile, workoutId, signal),
        catch: operationFailure,
      })
      return yield* Schema.decodeUnknownEffect(Chart)(raw).pipe(
        Effect.mapError(() =>
          Errors.invalidData({
            message: "workout has no valid chart",
            fix: "select a workout with a chart using workout-details",
          }),
        ),
      )
    })
    const output = Effect.fn("local.output")(function* (input: string) {
      const file = path.resolve(input)
      if (yield* fs.exists(file).pipe(Effect.mapError(fileError)))
        return yield* Errors.resourceConflict({
          message: "output file already exists",
          fix: "choose a new --file path; image export never overwrites files",
        })
      return file
    })
    const login = Effect.fn("local.login")(function* (plan: LoginPlan) {
      if ((yield* fingerprint(plan.sessionFile)) !== plan.previous) return yield* stale()
      let password: string
      if (plan.passwordStdin) {
        if (yield* stdio.stdinIsTerminal)
          return yield* Errors.invalidUsage({
            message: "password-stdin requires piped input",
            fix: "pipe the password from a secret manager; no terminal prompt is opened",
          })
        const first = yield* stdio.stdin.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runHead,
          Effect.timeout("5 seconds"),
          Effect.mapError(() =>
            Errors.invalidUsage({
              message: "could not read a password line",
              fix: "pipe one password line into stdin",
            }),
          ),
        )
        password = first._tag === "Some" ? first.value : ""
      } else {
        password = yield* Config.string("TR_PASSWORD").pipe(
          Config.withDefault(""),
          Effect.mapError(() =>
            Errors.invalidConfig({
              message: "TR_PASSWORD is unavailable",
              fix: "set TR_PASSWORD or use --password-stdin",
            }),
          ),
        )
      }
      if (!password || password.length > 16384)
        return yield* Errors.invalidUsage({
          message: "password is empty or too long",
          fix: "provide the password through TR_PASSWORD or --password-stdin",
        })
      yield* Effect.tryPromise({
        try: (signal) =>
          remote.login(plan.sessionFile, plan.username, password, plan.returnPath, signal),
        catch: () =>
          Errors.authFailure({
            message: "login did not complete",
            fix: "check credentials and connectivity; inspect whoami before retrying because the session may have changed",
          }),
      })
      return { authenticated: true, username: plan.username }
    })
    const logout = Effect.fn("local.logout")(function* (plan: LogoutPlan) {
      if ((yield* fingerprint(plan.sessionFile)) !== plan.previous) return yield* stale()
      if (plan.previous === null) return { cleared: false }
      yield* fs.remove(plan.sessionFile).pipe(Effect.mapError(fileError))
      return { cleared: true }
    })
    const writeImage = Effect.fn("local.writeImage")(function* (plan: ImagePlan) {
      const chart = yield* image(plan.sessionFile, plan.workoutId)
      if (
        chart.member.memberId !== plan.member.memberId ||
        chart.member.username !== plan.member.username ||
        chart.url !== plan.chartUrl ||
        planToken(chart.svg) !== plan.chartDigest
      )
        return yield* stale()
      const data =
        plan.imageFormat === "svg"
          ? new TextEncoder().encode(chart.svg)
          : yield* Effect.tryPromise({
              try: () => remote.rasterize(chart.svg, plan.width, plan.background),
              catch: () =>
                Errors.invalidConfig({
                  message: "PNG rendering failed",
                  fix: "install the optional @resvg/resvg-js package or use --image-format svg",
                }),
            })
      yield* fs
        .makeDirectory(path.dirname(plan.file), { recursive: true })
        .pipe(Effect.mapError(fileError))
      yield* fs.writeFile(plan.file, data, { flag: "wx" }).pipe(Effect.mapError(fileError))
      return {
        file: plan.file,
        bytes: data.length,
        imageFormat: plan.imageFormat,
        workoutId: plan.workoutId,
      }
    })
    return {
      reader: LocalReader.of({ session, image, output }),
      writer: LocalWriter.of({ login, logout, image: writeImage }),
    }
  })
  return Layer.merge(
    Layer.effect(
      LocalReader,
      Effect.map(api, (value) => value.reader),
    ),
    Layer.effect(
      LocalWriter,
      Effect.map(api, (value) => value.writer),
    ),
  )
}
