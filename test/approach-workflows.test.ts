import { expect, it } from "vitest"
import type { Schema } from "effect"
import type { ApiRequest } from "../src/domain/workflow.ts"
import { lines, makeInvoke } from "./harness.ts"

const approach = {
  id: 71,
  date: "2026-09-07T05:00:00Z",
  setting: 2,
  customPlanId: null,
  adaptationSettings: { maxEndurance: 300, outsideDuration: 120, secret: "excluded" },
  customAggressiveness: null,
  unrelated: "excluded",
}
const fixture = (changes: Schema.Json = [approach]) => {
  const reads: ApiRequest[] = []
  const invoke = makeInvoke(
    () => {
      throw new Error("unexpected legacy transport")
    },
    undefined,
    {
      workflow: () => ({
        load: async () => true,
        member: async () => ({ memberId: 42, username: "fixture-rider" }),
        request: async (request, _signal, mutation) => {
          expect(mutation).toBe(false)
          reads.push(request)
          return { trainingApproachChanges: changes, unrelated: "excluded" }
        },
      }),
    },
  )
  return { reads, invoke }
}

it("reads the member timeline and selects only approach fields", async () => {
  const f = fixture()
  const result = await f.invoke([
    "training-approaches",
    "--from",
    "2026-09-01",
    "--to",
    "2026-09-30",
    "--id",
    "71",
    "--session-file",
    "/fake/selected.json",
  ])
  expect(result.code).toBe(0)
  const envelope = lines(result.stdout)[0]!
  expect(f.reads).toEqual([
    {
      method: "GET",
      path: "/app/api/react-calendar/42/timeline?start=2026-09-01&end=2026-09-30",
      body: null,
    },
  ])
  expect(envelope.data.sessionFile).toBe("/fake/selected.json")
  expect(envelope.data.records.changes).toEqual([
    {
      id: 71,
      date: approach.date,
      setting: 2,
      customPlanId: null,
      adaptationSettings: { maxEndurance: 300, outsideDuration: 120 },
      customAggressiveness: null,
    },
  ])
  expect(result.stdout).not.toContain("excluded")
  expect((await f.invoke(envelope.next[0].args)).code).toBe(0)
  expect(f.reads).toHaveLength(1)
})

it("keeps empty histories distinct from an unsupported response", async () => {
  const f = fixture([])
  const result = lines((await f.invoke(["training-approaches"])).stdout)[0]!
  expect(result.data.records.changes).toEqual([])
})

it("recovers a missing id by listing without a date filter using the selected account", async () => {
  const f = fixture()
  const result = lines(
    (
      await f.invoke([
        "training-approaches",
        "--id",
        "999",
        "--from",
        "2026-09-01",
        "--session-file",
        "/fake/selected.json",
      ])
    ).stdout,
  )[0]!
  expect(result.error.code).toBe("not_found")
  expect(result.next[0].args).toEqual([
    "training-approaches",
    "--session-file",
    "/fake/selected.json",
    "--json",
  ])
  expect((await f.invoke(result.next[0].args)).code).toBe(0)
})

it.each([
  null,
  {},
  [approach, approach],
  [{ ...approach, id: null }],
  [{ ...approach, setting: 9 }],
  [{ ...approach, date: "2026-02-30T00:00:00Z" }],
  [{ ...approach, date: "2026-09-07garbage" }],
  [{ ...approach, date: "2026-09-07T25:00:00Z" }],
  [{ ...approach, customAggressiveness: {} }],
  [{ ...approach, adaptationSettings: {} }],
])("rejects unsupported history %j", async (changes) => {
  const f = fixture(changes)
  expect((await f.invoke(["training-approaches"])).code).toBe(65)
})

it.each([
  ["--from", "2026-02-30"],
  ["--from", "2026-10-01", "--to", "2026-09-01"],
  ["--id", ""],
])("rejects invalid inputs before opening the timeline: %j", async (...args) => {
  const f = fixture()
  expect((await f.invoke(["training-approaches", ...args])).code).toBe(64)
  expect(f.reads).toEqual([])
})
