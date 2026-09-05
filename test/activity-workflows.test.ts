import { expect, it } from "vitest"
import type { Schema } from "effect"
import { lines, makeInvoke } from "./harness.ts"

const fixture = (owner = "fixture-rider", progress: Schema.Json = { pending: false }) => {
  let notes = "Before"
  let writes = 0
  const invoke = makeInvoke(
    () => {
      throw new Error("unconfigured legacy")
    },
    undefined,
    {
      workflow: () => ({
        load: async () => true,
        member: async () => ({ memberId: 42, username: "fixture-rider" }),
        request: async (request, _, mutation) => {
          if (mutation) {
            expect(request).toEqual({
              method: "PUT",
              path: "/app/api/activities/123/details",
              body: { notes: "" },
            })
            notes = ""
            writes++
            return null
          }
          if (request.path.endsWith("/ff-progress")) return progress
          expect(request.path).toBe("/app/api/activities/123")
          return { id: 123, memberName: owner, name: "Morning ride", notes, unrelated: "omit-me" }
        },
      }),
    },
  )
  return { invoke, writes: () => writes }
}

it("clears only the account owner's notes after confirmation", async () => {
  const f = fixture()
  const args = ["edit-activity", "--id", "123", "--notes", "", "--session-file", "/fake/notes.json"]
  const preview = lines((await f.invoke(args)).stdout)[0]!
  expect(preview.status).toBe("confirmation_required")
  expect(f.writes()).toBe(0)
  const result = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
  expect(result.data.submitted).toBe(true)
  expect(f.writes()).toBe(1)
  const check = lines((await f.invoke(result.next[0].args)).stdout)[0]!
  expect(check.data.records.activity.notes).toBe("")
  expect(check.data.sessionFile).toBe("/fake/notes.json")
  expect(JSON.stringify(check)).not.toContain("omit-me")
})

it("refuses to change another athlete's completed activity", async () => {
  const f = fixture("someone-else")
  const result = lines(
    (await f.invoke(["edit-activity", "--id", "123", "--notes", "", "--yes"])).stdout,
  )[0]!
  expect(result.error.code).toBe("invalid_data")
  expect(f.writes()).toBe(0)
})

it.each([
  [{ pending: true }, "pending", "adaptation-status"],
  [{ pending: false }, "settled", "future"],
  [{ pending: false, failed: true }, "failed", "future"],
] as const)("steers according to recalculation state %j", async (progress, state, command) => {
  const f = fixture("fixture-rider", progress)
  const result = lines(
    (
      await f.invoke([
        "adaptation-status",
        "--from",
        "2026-09-01",
        "--to",
        "2026-09-08",
        "--session-file",
        "/fake/status.json",
      ])
    ).stdout,
  )[0]!
  expect(result.data.records.state).toBe(state)
  expect(result.next[0].args).toEqual([
    command,
    "--from",
    "2026-09-01",
    "--to",
    "2026-09-08",
    ...(command === "future" ? ["--details"] : []),
    "--session-file",
    "/fake/status.json",
    "--json",
  ])
  expect(f.writes()).toBe(0)
})

it("does not treat a missing status field as settled", async () => {
  const f = fixture("fixture-rider", {})
  const result = lines((await f.invoke(["adaptation-status"])).stdout)[0]!
  expect(result.error.code).toBe("invalid_data")
  expect(f.writes()).toBe(0)
})
