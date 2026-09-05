import { expect, it } from "vitest"
import { Effect } from "effect"
import { makeInvoke, lines } from "./harness.ts"

it.each(["query", "plan", "apply"] as const)(
  "interrupts %s with a terminal event and a safe continuation",
  async (phaseToAbort) => {
    const controller = new AbortController()
    let writes = 0
    let requestAborted = false
    let abortEnabled = true
    const invoke = makeInvoke(
      () => {
        throw new Error("unexpected transport")
      },
      async (command, _flags, phase, _now, signal) => {
        if (phase === "apply") writes++
        if (abortEnabled && phase === phaseToAbort) {
          signal.addEventListener(
            "abort",
            () => {
              requestAborted = true
            },
            { once: true },
          )
          const pending = Effect.runPromise(Effect.never, { signal })
          controller.abort()
          return await pending
        }
        return {
          command,
          member: { memberId: 42, username: "fixture" },
          query: { date: "2030-02-01" },
          records: [],
          dryRun: phase === "plan",
        }
      },
    )
    const args = phaseToAbort === "query" ? ["future"] : ["remove-workout", "--id", "fixture", "-y"]
    const result = await invoke(args, "ndjson", controller.signal)
    expect(result.code).toBe(130)
    expect(requestAborted).toBe(true)
    const events = lines(result.stdout, "ndjson")
    expect(events).toHaveLength(1)
    const error = events[0]!
    expect(error.error.code).toBe("interrupted")
    expect(error.guides.length).toBeGreaterThan(0)
    expect(error.next[0].args).not.toContain("--yes")
    expect(error.next[0].args).not.toContain("-y")
    expect(error.next[0].args).not.toContain("--confirm")
    expect(writes).toBe(phaseToAbort === "apply" ? 1 : 0)
    abortEnabled = false
    const resumed = await invoke(error.next[0].args, "ndjson")
    expect(resumed.code).toBe(phaseToAbort === "query" ? 0 : 4)
    expect(writes).toBe(phaseToAbort === "apply" ? 1 : 0)
  },
)
