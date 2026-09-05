import { Effect, FileSystem, Layer, Path, Schema, Sink, Stdio, Terminal } from "effect"
import type { Exit } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { buildRoot, machineOutputLayer, runRoot } from "../src/contract/adapter.ts"
import { surfaceOf } from "../src/contract/surface.ts"
import {
  ConfirmationEnvelope,
  ErrorEnvelope,
  OkEnvelope,
  StreamEvent,
} from "../src/output/envelope.ts"
import type { OutputMode } from "../src/output/format.ts"
import { negotiate } from "../src/output/format.ts"
import { Progress } from "../src/output/progress.ts"
import { Renderer } from "../src/output/renderer.ts"
import { settleExit } from "../src/runtime.ts"
import { trainerRoadLayer } from "../src/services/trainerroad.ts"
import type { createTransport } from "../src/services/transport.mjs"
import { contracts } from "../src/commands/index.ts"
import { validateInvocation } from "../src/contract/invocation.ts"
import { findGuide } from "../src/guides/catalog.ts"
import { operationsLayer } from "../src/services/operations.ts"
import type { runOperation } from "../src/services/operation-transport.mjs"
import { localLayer } from "../src/services/local.ts"
import type * as LocalTransport from "../src/services/local-transport.mjs"
import { workflowsLayer } from "../src/services/workflows.ts"
import type { createWorkflowTransport } from "../src/services/workflow-transport.mjs"

interface LocalOptions {
  readonly workflow?: typeof createWorkflowTransport
  readonly remote?: typeof LocalTransport
  readonly filesystem?: Layer.Layer<FileSystem.FileSystem>
  readonly stdio?: Partial<Stdio.Stdio>
}
const denied = async (): Promise<never> => {
  throw new Error("unconfigured local transport fixture")
}

export interface Invocation {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

const collect = (into: Array<string>) =>
  Sink.forEach((chunk: string | Uint8Array) =>
    Effect.sync(() => {
      into.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
    }),
  )

export const makeInvoke =
  (factory: typeof createTransport, execute?: typeof runOperation, local: LocalOptions = {}) =>
  async (
    argv: ReadonlyArray<string>,
    format: OutputMode["format"] = "json",
    signal?: AbortSignal,
  ): Promise<Invocation> => {
    const mode: OutputMode = {
      format,
      noInput: true,
      color: false,
      argv: negotiate({ argv, stdoutIsTTY: false, stdinIsTTY: false, env: {} }).argv,
      helpRequested: false,
      explicitFormat: true,
    }
    const out: Array<string> = []
    const err: Array<string> = []

    const testStdio = Stdio.layerTest({
      ...local.stdio,
      stdout: () => collect(out),
      stderr: () => collect(err),
    })

    const fakeServices = Layer.merge(
      trainerRoadLayer(factory),
      operationsLayer(
        execute ??
          (async () => {
            throw new Error("unconfigured operation fixture")
          }),
      ),
    )

    const environment = Layer.mergeAll(
      local.filesystem ?? FileSystem.layerNoop({}),
      Path.layer,
      testStdio,
      Layer.succeed(
        Terminal.Terminal,
        Terminal.make({
          columns: Effect.succeed(80),
          rows: Effect.succeed(24),
          readInput: Effect.die("no input in tests"),
          readLine: Effect.die("no input in tests"),
          display: () => Effect.void,
        }),
      ),
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.die("no processes in tests")),
      ),
    )

    const root = buildRoot("trainerroad-cli", "test cli", contracts)
    const rendererLayer = Renderer.layer(mode, "trainerroad-cli")
    // Machine formats get the same Console/formatter shim bin.ts installs.
    const outputShim = format === "text" ? Layer.empty : machineOutputLayer(format)
    const layer = Layer.mergeAll(
      fakeServices,
      workflowsLayer(
        local.workflow ??
          (() => {
            throw new Error("unconfigured workflow fixture")
          }),
      ),
      localLayer(local.remote ?? { login: denied, chart: denied, rasterize: denied }),
      rendererLayer,
      Progress.layer.pipe(Layer.provideMerge(rendererLayer)),
      outputShim,
    ).pipe(Layer.provideMerge(environment))
    const exit: Exit.Exit<void, unknown> = await Effect.runPromiseExit(
      runRoot(root, "0.0.0", mode.argv).pipe(Effect.provide(layer)),
      signal === undefined ? undefined : { signal },
    )
    const settled = settleExit({
      exit,
      mode,
      binName: "trainerroad-cli",
      describeData: () => ({}),
      surfaces: contracts.map(surfaceOf),
    })
    for (const chunk of settled.writes) {
      ;(chunk.stream === "stdout" ? out : err).push(chunk.text)
    }
    return { stdout: out.join(""), stderr: err.join(""), code: settled.code }
  }

const AnyEnvelope = Schema.Union([OkEnvelope, ErrorEnvelope, ConfirmationEnvelope])
const decodeEnvelope = Schema.decodeUnknownSync(AnyEnvelope)
const decodeEvent = Schema.decodeUnknownSync(StreamEvent)

export const lines = (text: string, wire: "json" | "ndjson" = "json"): Array<Record<string, any>> =>
  text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const value = JSON.parse(line) as Record<string, any>
      if (wire === "json") {
        decodeEnvelope(value)
      } else {
        decodeEvent(value)
      }
      for (const action of value.next ?? []) {
        const reason = validateInvocation(contracts.map(surfaceOf), action.args)
        if (reason !== undefined) throw new Error(`invalid next action: ${reason}`)
      }
      for (const topic of value.guides ?? []) {
        if (findGuide(topic) === undefined) throw new Error(`missing guide: ${topic}`)
      }
      if (value.warnings?.some((warning: string) => warning.startsWith("dropped ")))
        throw new Error(`guidance was dropped: ${JSON.stringify(value.warnings)}`)
      return value
    })
