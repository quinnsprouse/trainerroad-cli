import { expect, it } from "vitest"
import { Effect } from "effect"
import type { ApiRequest } from "../src/domain/workflow.ts"
import { lines, makeInvoke } from "./harness.ts"

const session = "/fake/fitness-journey.json"
const args = ["ftp-dismiss", "--id", "789", "--session-file", session]
const expectedWrite: ApiRequest = {
  method: "PUT",
  path: "/app/api/membersettings",
  body: { name: "viewedPredictionId", value: 789 },
}

const fixture = () => {
  const state = { memberId: 42, ftp: 240, viewedId: 456 }
  const writes: ApiRequest[] = []
  const reads: ApiRequest[] = []
  const sessions: string[] = []
  const controls: {
    outcome: "success" | "lost-before-commit" | "lost-after-commit"
    abort?: { phase: "read" | "write"; controller: AbortController }
    onMember?: () => void
    requestAborted: boolean
  } = { outcome: "success", requestAborted: false }
  const interrupt = (signal: AbortSignal): Promise<never> => {
    signal.addEventListener(
      "abort",
      () => {
        controls.requestAborted = true
      },
      { once: true },
    )
    const pending = Effect.runPromise(Effect.never, { signal })
    controls.abort!.controller.abort()
    return pending
  }
  const invoke = makeInvoke(
    () => {
      throw new Error("unexpected legacy transport")
    },
    undefined,
    {
      workflow: (file) => {
        sessions.push(file)
        return {
          load: async () => true,
          member: async () => {
            controls.onMember?.()
            return { memberId: state.memberId, username: "fixture-rider" }
          },
          request: async (request, signal, mutation) => {
            expect(signal).toBeInstanceOf(AbortSignal)
            if (mutation) {
              writes.push(request)
              expect(request).toEqual(expectedWrite)
              if (controls.outcome === "lost-before-commit") throw new Error("connection lost")
              state.viewedId = 789
              if (controls.abort?.phase === "write") return interrupt(signal)
              if (controls.outcome === "lost-after-commit") throw new Error("response lost")
              return true
            }
            reads.push(request)
            expect(request.method).toBe("GET")
            expect(request.body).toBeNull()
            if (controls.abort?.phase === "read") return interrupt(signal)
            switch (request.path) {
              case `/app/api/react-calendar/${state.memberId}/timeline`:
                return {
                  pendingAiFtpChange: { id: 789, source: 24, value: 250 },
                  secret: "must-not-leak",
                }
              case "/app/api/membersettings?names=viewedPredictionId":
                return [{ name: "viewedPredictionId", value: state.viewedId }]
              case "/app/api/member-info":
                return {
                  memberId: state.memberId,
                  ftp: state.ftp,
                  roles: ["AiFtpBreakthrough"],
                  secret: "must-not-leak",
                }
              case "/app/api/survey/check":
                return null
              case `/app/api/weight-history/${state.memberId}/all`:
                return [
                  { id: 123, date: "2026-09-04", value: 165, units: 1, secret: "must-not-leak" },
                  { id: 124, date: "2026-09-05", value: 75, units: 0 },
                ]
              default:
                throw new Error(`Unexpected read: ${request.path}`)
            }
          },
        }
      },
    },
  )
  return { invoke, state, controls, writes, reads, sessions }
}

it("discovers the pending ID, previews, confirms once, and reads the persisted dismissal", async () => {
  const f = fixture()
  const initial = await f.invoke(["ftp-prompt", "--session-file", session])
  expect(initial.code).toBe(0)
  const prompt = lines(initial.stdout)[0]!
  expect(prompt.data.records).toMatchObject({
    accountMemberId: 42,
    accountFtp: 240,
    pending: { id: 789, source: 24, value: 250 },
    viewedPredictionId: 456,
    canDismiss: true,
    reason: "ready",
  })
  expect(f.reads.map((read) => read.path)).toEqual([
    "/app/api/react-calendar/42/timeline",
    "/app/api/membersettings?names=viewedPredictionId",
    "/app/api/member-info",
    "/app/api/survey/check",
  ])
  expect(prompt.next.map((next: { args: string[] }) => next.args)).toEqual([
    ["describe", "--command", "ftp-dismiss", "--json"],
    ["guide", "get", "athlete-feedback", "--json"],
  ])
  const guidance = await Promise.all(
    prompt.next.map((next: { args: string[] }) => f.invoke(next.args)),
  )
  expect(guidance.map((response) => response.code)).toEqual([0, 0])
  const dry = await f.invoke([...args, "--dry-run"])
  expect(dry.code).toBe(0)
  expect(lines(dry.stdout)[0]!.data).toMatchObject({
    dryRun: true,
    plan: { sessionFile: session, request: expectedWrite },
  })
  expect(f.writes).toEqual([])
  const preview = await f.invoke(args)
  expect(preview.code).toBe(4)
  const planned = lines(preview.stdout)[0]!
  expect(planned.status).toBe("confirmation_required")
  expect(planned.plan).toMatchObject({
    input: { id: "789" },
    sessionFile: session,
    request: expectedWrite,
    before: prompt.data.records,
  })
  expect(f.writes).toEqual([])
  for (const output of [initial.stdout, dry.stdout, preview.stdout])
    expect(output).not.toContain("must-not-leak")

  const response = await f.invoke(planned.confirmation.confirmArgs)
  expect(response.code).toBe(0)
  const applied = lines(response.stdout)[0]!
  expect(applied.data).toMatchObject({ submitted: true, verification: "required" })
  expect(f.writes).toEqual([expectedWrite])
  expect(applied.next[0].args).toEqual(["ftp-prompt", "--session-file", session, "--json"])
  expect(applied.next[0].message).toContain("789")
  const verified = await f.invoke(applied.next[0].args)
  expect(verified.code).toBe(0)
  expect(lines(verified.stdout)[0]!.data.records).toMatchObject({
    accountFtp: prompt.data.records.accountFtp,
    pending: prompt.data.records.pending,
    viewedPredictionId: 789,
    canDismiss: false,
    reason: "already-viewed",
  })
  expect(verified.stdout).not.toContain("must-not-leak")
  expect(f.sessions.every((file) => file === session)).toBe(true)
  expect(f.writes).toEqual([expectedWrite])
})

it.each(["lost-before-commit", "lost-after-commit"] as const)(
  "reads persisted state after %s without retrying the uncertain PUT",
  async (outcome) => {
    const f = fixture()
    const preview = lines((await f.invoke(args)).stdout)[0]!
    f.controls.outcome = outcome
    const result = await f.invoke(preview.confirmation.confirmArgs)
    expect(result.code).not.toBe(0)
    const failed = lines(result.stdout)[0]!
    expect(failed.error).toMatchObject({ code: "cannot_write", transient: false })
    expect(failed.next[0].args).toEqual(["ftp-prompt", "--session-file", session, "--json"])
    expect(f.writes).toEqual([expectedWrite])
    const verified = await f.invoke(failed.next[0].args)
    expect(verified.code).toBe(0)
    expect(lines(verified.stdout)[0]!.data.records).toMatchObject({
      accountFtp: 240,
      pending: { id: 789, value: 250 },
      viewedPredictionId: outcome === "lost-after-commit" ? 789 : 456,
      canDismiss: outcome === "lost-before-commit",
    })
    expect(f.sessions.every((file) => file === session)).toBe(true)
    expect(f.writes).toEqual([expectedWrite])
  },
)

it.each(["ftp", "viewedId", "memberId"] as const)(
  "rejects a stale %s confirmation before dispatch",
  async (field) => {
    const f = fixture()
    const preview = lines((await f.invoke(args)).stdout)[0]!
    f.state[field] += 1
    const response = await f.invoke(preview.confirmation.confirmArgs)
    expect(response.code).not.toBe(0)
    const stale = lines(response.stdout)[0]!
    expect(stale.error.code).toBe("stale_confirmation")
    expect(f.writes).toEqual([])
    expect(stale.next[0].args).toContain(session)
    for (const flag of ["--confirm", "--yes", "-y"]) expect(stale.next[0].args).not.toContain(flag)
    const fresh = await f.invoke(stale.next[0].args)
    expect(fresh.code).toBe(4)
    expect(lines(fresh.stdout)[0]!.status).toBe("confirmation_required")
    expect(f.writes).toEqual([])
  },
)

it("rejects an FTP change between confirmation validation and the final write preflight", async () => {
  const f = fixture()
  const preview = lines((await f.invoke(args)).stdout)[0]!
  let opens = 0
  f.controls.onMember = () => {
    opens++
    if (opens === 2) f.state.ftp = 245
  }
  const response = await f.invoke(preview.confirmation.confirmArgs)
  expect(response.code).not.toBe(0)
  expect(lines(response.stdout)[0]!.error.code).toBe("stale_confirmation")
  expect(opens).toBe(2)
  expect(f.writes).toEqual([])
})

it.each([
  { flags: [] },
  { flags: ["--id", ""] },
  { flags: ["--id", "788"] },
  { flags: ["--id", "789", "--action", "dismiss"] },
])("rejects missing, invalid, or undeclared inputs $flags without a write", async ({ flags }) => {
  const f = fixture()
  const result = await f.invoke(["ftp-dismiss", ...flags, "--session-file", session, "--yes"])
  expect(result.code).not.toBe(0)
  expect(f.writes).toEqual([])
})

it("reads an account weight record with its recorded units and a discovery next action", async () => {
  const f = fixture()
  const result = await f.invoke(["weight-record", "--id", "123", "--session-file", session])
  expect(result.code).toBe(0)
  const envelope = lines(result.stdout)[0]!
  expect(envelope.data.records).toEqual({
    weight: { id: 123, date: "2026-09-04", value: 165, units: 1, unitName: "pounds" },
  })
  expect(envelope.next[0].args).toEqual(["weight-history", "--session-file", session, "--json"])
  expect(result.stdout).not.toContain("must-not-leak")
  expect(f.writes).toEqual([])
})

it("aborts a prompt read without dispatching a mutation", async () => {
  const f = fixture()
  const controller = new AbortController()
  f.controls.abort = { phase: "read", controller }
  const response = await f.invoke(
    ["ftp-prompt", "--session-file", session],
    "ndjson",
    controller.signal,
  )
  expect(response.code).toBe(130)
  const events = lines(response.stdout, "ndjson")
  expect(events).toHaveLength(1)
  expect(events[0]!.error.code).toBe("interrupted")
  expect(f.controls.requestAborted).toBe(true)
  expect(f.writes).toEqual([])
})

it("aborts a dispatched PUT and verifies its uncertain result without repeating it", async () => {
  const f = fixture()
  const preview = lines((await f.invoke(args)).stdout)[0]!
  const controller = new AbortController()
  f.controls.abort = { phase: "write", controller }
  const response = await f.invoke(preview.confirmation.confirmArgs, "ndjson", controller.signal)
  const events = lines(response.stdout, "ndjson")
  expect(events).toHaveLength(1)
  const failed = events[0]!
  expect(response.code).not.toBe(0)
  expect(failed.error.code).toBe("cannot_write")
  expect(f.controls.requestAborted).toBe(true)
  expect(f.writes).toEqual([expectedWrite])
  expect(failed.next[0].args).toEqual(["ftp-prompt", "--session-file", session, "--json"])
  delete f.controls.abort
  const verified = await f.invoke(failed.next[0].args)
  expect(verified.code).toBe(0)
  expect(lines(verified.stdout)[0]!.data.records).toMatchObject({
    viewedPredictionId: 789,
    accountFtp: 240,
  })
  expect(f.writes).toEqual([expectedWrite])
})
