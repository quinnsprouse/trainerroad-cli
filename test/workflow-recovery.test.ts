import { Effect } from "effect"
import { expect, it } from "vitest"
import { lines, makeInvoke } from "./harness.ts"

const unauthorized = (): never => {
  throw Object.assign(new Error("unauthorized fixture"), { status: 401 })
}

it("recovers an interrupted dispatched write with read-only verification", async () => {
  const controller = new AbortController()
  let writes = 0
  let aborted = false
  const invoke = makeInvoke(
    () => {
      throw new Error("no legacy transport")
    },
    undefined,
    {
      workflow: () => ({
        load: async () => true,
        member: async () => ({ memberId: 42, username: "fixture" }),
        request: async (_, signal, mutation) => {
          if (!mutation) return { id: "planned-123", date: { year: 2026, month: 9, day: 10 } }
          writes++
          signal.addEventListener(
            "abort",
            () => {
              aborted = true
            },
            { once: true },
          )
          const pending = Effect.runPromise(Effect.never, { signal })
          controller.abort()
          return await pending
        },
      }),
    },
  )
  const result = await invoke(
    ["skip-workout", "--id", "planned-123", "--session-file", "/fake/selected.json", "--yes"],
    "json",
    controller.signal,
  )
  const envelope = lines(result.stdout)[0]!
  expect(envelope.error.code).toBe("cannot_write")
  expect(envelope.error.transient).toBe(false)
  expect(envelope.next[0].args[0]).toBe("planned-activity")
  expect(envelope.next[0].args).toContain("/fake/selected.json")
  expect(aborted).toBe(true)
  expect(writes).toBe(1)
})

it.each(["load", "member", "read"])(
  "keeps the selected session in %s authentication recovery",
  async (stage) => {
    const invoke = makeInvoke(
      () => {
        throw new Error("no legacy transport")
      },
      undefined,
      {
        workflow: () => ({
          load: async () => stage !== "load",
          member: async () =>
            stage === "member" ? unauthorized() : { memberId: 42, username: "fixture" },
          request: async () => unauthorized(),
        }),
      },
    )
    const envelope = lines(
      (
        await invoke([
          "planned-activity",
          "--id",
          "planned-123",
          "--session-file",
          "/fake/selected.json",
        ])
      ).stdout,
    )[0]!
    expect(envelope.error.code).toBe("auth_failure")
    expect(envelope.error.details.sessionFile).toBe("/fake/selected.json")
    expect(envelope.error.fix).not.toContain("--yes")
    expect(envelope.next[0].args[0]).toBe("guide")
  },
)
