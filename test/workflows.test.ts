import { expect, it } from "vitest"
import type { ApiRequest } from "../src/domain/workflow.ts"
import { lines, makeInvoke } from "./harness.ts"

const fixture = () => {
  let activity = {
    id: "planned-123",
    date: { year: 2026, month: 9, day: 10 },
    adaptationLocked: false,
    manuallyCompleted: false,
  }
  const writes: ApiRequest[] = []
  let failWrite = false
  let memberId = 42
  const invoke = makeInvoke(
    () => {
      throw new Error("unexpected legacy transport")
    },
    undefined,
    {
      workflow: () => ({
        load: async () => true,
        member: async () => ({ memberId, username: "fixture-rider" }),
        request: async (request, signal, mutation) => {
          expect(signal).toBeInstanceOf(AbortSignal)
          if (mutation) {
            writes.push(request)
            if (failWrite) throw new Error("response lost")
            return null
          }
          if (request.path === "/app/api/calendar/plannedactivities/planned-123") return activity
          if (request.path === `/app/api/calendar/${memberId}/ff-progress`)
            return { pending: false, owner: null, currentDay: null, failed: false }
          throw new Error(`Unexpected read: ${request.path}`)
        },
      }),
    },
  )
  return {
    invoke,
    writes,
    change: () => {
      activity = { ...activity, adaptationLocked: true }
    },
    switchAccount: () => {
      memberId = 99
    },
    fail: () => {
      failWrite = true
    },
  }
}

it.each([
  ["skip-workout", [], "PUT", "/skip", null],
  ["pin-workout", ["--pinned", "true"], "PUT", "/pin", { pinned: true }],
  ["pin-workout", ["--pinned", "false"], "PUT", "/pin", { pinned: false }],
  [
    "complete-workout",
    ["--completed", "true"],
    "POST",
    "/mark-manually-complete",
    { completed: true },
  ],
  [
    "complete-workout",
    ["--completed", "false"],
    "POST",
    "/mark-manually-complete",
    { completed: false },
  ],
] as const)(
  "previews and confirms %s %j, then steers to verification",
  async (name, flags, method, suffix, body) => {
    const f = fixture()
    const args = [name, "--id", "planned-123", ...flags, "--session-file", "/fake/session.json"]
    const dry = await f.invoke([...args, "--dry-run"])
    expect(dry.code).toBe(0)
    expect(f.writes).toEqual([])
    const preview = await f.invoke(args)
    expect(preview.code).toBe(4)
    const envelope = lines(preview.stdout)[0]!
    expect(f.writes).toEqual([])
    const applied = await f.invoke(envelope.confirmation.confirmArgs)
    expect(applied.code).toBe(0)
    expect(f.writes).toEqual([
      { method, path: "/app/api/calendar/plannedactivities/planned-123" + suffix, body },
    ])
    const result = lines(applied.stdout)[0]!
    expect(result.data).toMatchObject({ submitted: true, verification: "required" })
    expect(result.next[0].args).toContain("/fake/session.json")
    const check = lines((await f.invoke(result.next[0].args)).stdout)[0]!
    expect(check.data.records.activity.id).toBe("planned-123")
    const progress = lines((await f.invoke(check.next[0].args)).stdout)[0]!
    expect(progress.data.records.progress.pending).toBe(false)
    expect(f.writes).toHaveLength(1)
  },
)

it.each(["state", "account"])("refuses changed %s before dispatch", async (target) => {
  const f = fixture()
  const preview = lines((await f.invoke(["skip-workout", "--id", "planned-123"])).stdout)[0]!
  if (target === "state") f.change()
  else f.switchAccount()
  const result = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
  expect(result.error.code).toBe("stale_confirmation")
  expect(f.writes).toEqual([])
  expect(result.next[0].args).not.toContain("--yes")
})

it("does not retry uncertain writes and emits a read-only next action", async () => {
  const f = fixture()
  f.fail()
  const result = lines(
    (await f.invoke(["skip-workout", "--id", "planned-123", "--yes"])).stdout,
  )[0]!
  expect(result.error.code).toBe("cannot_write")
  expect(result.error.transient).toBe(false)
  expect(f.writes).toHaveLength(1)
  expect(result.next[0].args[0]).toBe("planned-activity")
  expect((await f.invoke(result.next[0].args)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})

it.each([
  ["pin-workout", "--id", "planned-123"],
  ["pin-workout", "--id", "planned-123", "--pinned", "maybe"],
  ["skip-workout", "--id", ""],
  ["skip-workout", "--id", ".."],
])("rejects invalid arguments: %j", async (...args) => {
  const f = fixture()
  const result = await f.invoke([...args, "--yes"])
  expect(result.code).not.toBe(0)
  expect(f.writes).toEqual([])
})
