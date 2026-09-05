import { expect, it } from "vitest"
import type { Schema } from "effect"
import type { ApiRequest } from "../src/domain/workflow.ts"
import { recurrenceWorkflows } from "../src/domain/recurrence-workflows.ts"
import { lines, makeInvoke } from "./harness.ts"

const windowArgs = ["--from", "2026-09-07", "--to", "2026-09-14"]
const stateArgs = [
  "recurrence-state",
  "--id",
  "series-123",
  ...windowArgs,
  "--session-file",
  "/fake/recurrence-session.json",
]
const stub = (index: number, day: number) => ({
  id: "series-123",
  index,
  date: `2026-09-${String(day).padStart(2, "0")}T00:00:00`,
  type: 1,
  timeOfDay: "08:00:00",
  tss: 50,
  privateField: "omit",
})
const occurrence = (index: number, day: number) => ({
  id: "series-123",
  index,
  definition: {
    id: "series-123",
    startDate: { year: 2026, month: 9, day: 7 },
    frequency: {
      isCustom: false,
      type: 1,
      interval: 1,
      weekDays: 1,
      excludedIndices: [],
      unknown: "omit",
    },
    endCriteria: { maxRecurrences: 10 },
    privateField: "omit",
  },
  activity: {
    name: "Endurance",
    notes: "Keep",
    date: { year: 2026, month: 9, day },
    durationInSeconds: 3600,
    activityType: 1,
    timeOfDay: "08:00:00",
    tss: 50,
    workout: { id: 99, name: "Easy", unrelated: "omit" },
    unrelated: "omit",
  },
})
const fixture = () => {
  let timeline: Schema.Json = { recurringActivities: [stub(0, 7), stub(1, 14)], unrelated: "omit" }
  let series: Schema.Json = [occurrence(0, 7), occurrence(1, 14), occurrence(2, 21)]
  let fail = false
  const requests: ApiRequest[] = []
  const sessions: string[] = []
  const invoke = makeInvoke(
    () => {
      throw new Error("unexpected legacy transport")
    },
    undefined,
    {
      workflow: (session) => {
        sessions.push(session)
        return {
          load: async () => true,
          member: async () => ({ memberId: 42, username: "fixture-rider" }),
          request: async (request, signal, mutation) => {
            expect(signal).toBeInstanceOf(AbortSignal)
            expect(mutation).toBe(false)
            expect(request.method).toBe("GET")
            expect(request.body).toBeNull()
            requests.push(request)
            if (fail) throw new Error("read failed")
            if (
              request.path === "/app/api/react-calendar/42/timeline?start=2026-09-07&end=2026-09-14"
            )
              return timeline
            if (request.path === "/app/api/react-calendar/recurring-activities/series-123")
              return series
            throw new Error(`unexpected request ${request.path}`)
          },
        }
      },
    },
  )
  return {
    invoke,
    requests,
    sessions,
    timeline: (next: Schema.Json) => {
      timeline = next
    },
    series: (next: Schema.Json) => {
      series = next
    },
    fail: () => {
      fail = true
    },
  }
}

it("discovers IDs and indices then follows member-validated details and same-window discovery", async () => {
  const f = fixture()
  const result = await f.invoke([
    "recurring-activities",
    ...windowArgs,
    "--session-file",
    "/fake/recurrence-session.json",
  ])
  expect(result.code).toBe(0)
  const discovered = lines(result.stdout)[0]!
  expect(discovered.data.records).toMatchObject({
    scope: "selected-window-only",
    occurrences: [
      { id: "series-123", index: 0, date: "2026-09-07" },
      { id: "series-123", index: 1, date: "2026-09-14" },
    ],
  })
  expect(result.stdout).not.toContain("privateField")
  expect(discovered.next[0].args).toEqual([...stateArgs, "--json"])
  const detailedResult = await f.invoke(discovered.next[0].args)
  expect(detailedResult.code).toBe(0)
  const detailed = lines(detailedResult.stdout)[0]!
  expect(detailed.data.records.writesSupported).toBe(false)
  expect(detailed.data.records.occurrences).toHaveLength(2)
  expect(detailed.data.records.occurrences[0]).toMatchObject({
    id: "series-123",
    index: 0,
    definition: { startDate: "2026-09-07", frequency: { type: 1, weekDays: 1 } },
    activity: { name: "Endurance", durationInSeconds: 3600, workout: { id: 99, name: "Easy" } },
  })
  expect(detailedResult.stdout).not.toContain("privateField")
  expect(detailedResult.stdout).not.toContain("unrelated")
  expect(detailed.next[0].args).toEqual([
    "recurring-activities",
    ...windowArgs,
    "--session-file",
    "/fake/recurrence-session.json",
    "--json",
  ])
  expect((await f.invoke(detailed.next[0].args)).code).toBe(0)
  expect((await f.invoke(detailed.next[1].args)).code).toBe(0)
  expect(f.sessions.every((session) => session === "/fake/recurrence-session.json")).toBe(true)
  expect(
    f.requests.some(
      (request) => request.path === "/app/api/react-calendar/recurring-activities/series-123",
    ),
  ).toBe(true)
})

it("returns empty discovery without claiming that all member series are absent", async () => {
  const f = fixture()
  f.timeline({ recurringActivities: [] })
  const result = lines((await f.invoke(["recurring-activities", ...windowArgs])).stdout)[0]!
  expect(result.data.records).toEqual({
    occurrences: [],
    scope: "selected-window-only",
    coverage: "timeline-recurrence-entries-only",
  })
  expect((await f.invoke(result.next[0].args)).code).toBe(0)
})

it("does not expose series details without member-window membership", async () => {
  const f = fixture()
  f.timeline({ recurringActivities: [{ ...stub(0, 7), id: "another-series" }] })
  const result = await f.invoke(stateArgs)
  expect(lines(result.stdout)[0]!.error.code).toBe("not_found")
  expect(result.stdout).not.toContain("Endurance")
})

it.each(
  [
    [],
    [occurrence(0, 7)],
    [occurrence(0, 7), occurrence(0, 7)],
    [{ ...occurrence(0, 7), id: "foreign" }],
    [{ ...occurrence(0, 7), index: -1 }],
    [occurrence(0, 8), occurrence(1, 14)],
    [{ ...occurrence(0, 7), definition: { ...occurrence(0, 7).definition, id: "foreign" } }],
  ].map((series) => ({ series })),
)("refuses mismatched or incomplete series %j", async ({ series }) => {
  const f = fixture()
  f.series(series)
  expect(lines((await f.invoke(stateArgs)).stdout)[0]!.error.code).toBe("invalid_data")
})

it.each([
  { recurringActivities: {} },
  { recurringActivities: [stub(0, 7), stub(0, 7)] },
  { recurringActivities: [{ ...stub(0, 7), index: 0.5 }] },
  { recurringActivities: [{ ...stub(0, 7), date: "2026-02-30" }] },
  { recurringActivities: [{ ...stub(0, 7), type: {} }] },
])("rejects malformed member timeline %j", async (timeline) => {
  const f = fixture()
  f.timeline(timeline)
  expect(
    lines((await f.invoke(["recurring-activities", ...windowArgs])).stdout)[0]!.error.code,
  ).toBe("invalid_data")
})

it.each([
  { args: ["--from", "2026-02-30", "--to", "2026-09-14"] },
  { args: ["--from", "2026-09-14", "--to", "2026-09-07"] },
  { args: ["--from", "2026-09-07"] },
  { args: [...windowArgs, "--payload", "{}"] },
])("rejects invalid or arbitrary input before reading %j", async ({ args }) => {
  const f = fixture()
  expect((await f.invoke(["recurring-activities", ...args])).code).not.toBe(0)
  expect(f.requests).toEqual([])
})

it("rejects composite series IDs and keeps discovery commands read-only", async () => {
  const f = fixture()
  expect((await f.invoke(["recurrence-state", "--id", "series§§0", ...windowArgs])).code).not.toBe(
    0,
  )
  expect(f.requests).toEqual([])
  expect(
    recurrenceWorkflows
      .filter((workflow) => workflow.name !== "delete-recurrence-tail")
      .every((workflow) => workflow.write === undefined),
  ).toBe(true)
})

const tailFlags = [
  "--id",
  "series-123",
  "--index",
  "0",
  "--from",
  "2026-09-07",
  "--verify-through",
  "2026-09-14",
  "--session-file",
  "/fake/tail-session.json",
]
const materialized = (id: string | number, recurrenceId: string | null, completed = false) => ({
  id,
  recurrenceId,
  recurrenceIndex: 1,
  manuallyCompleted: completed,
  date: { year: 2026, month: 9, day: 14 },
  name: `Planned ${id}`,
  tss: 55,
  durationInSeconds: 3600,
})
const tailFixture = () => {
  let recurring = [stub(0, 7), stub(1, 14)]
  let series: Schema.Json = [occurrence(0, 7), occurrence(1, 14)]
  let planned: Record<string, Schema.Json>[] = [
    materialized("p1", "series-123"),
    materialized("p2", "other-series"),
    materialized("p3", "series-123", true),
  ]
  let completed = [
    { id: 101, started: "2026-09-08T09:00:00", tss: 44, type: 1 },
    { id: 102, started: "2026-09-09T09:00:00", tss: 33, type: 1 },
  ]
  let hydrateResponse: ((data: Record<string, Schema.Json>[]) => Schema.Json) | undefined
  let failWrite = false
  const writes: ApiRequest[] = []
  const requests: ApiRequest[] = []
  const invoke = makeInvoke(
    () => {
      throw new Error("unexpected legacy transport")
    },
    undefined,
    {
      workflow: (session) => {
        expect(session).toBe("/fake/tail-session.json")
        return {
          load: async () => true,
          member: async () => ({ memberId: 42, username: "fixture-rider" }),
          request: async (request, _signal, mutation) => {
            requests.push(request)
            if (mutation) {
              writes.push(request)
              if (failWrite) throw new Error("write response lost")
              recurring = []
              series = []
              planned = planned.filter(
                (item) => item.recurrenceId !== "series-123" || item.manuallyCompleted,
              )
              return null
            }
            expect(request.method).toBe("GET")
            if (
              request.path === "/app/api/react-calendar/42/timeline?start=2026-09-07&end=2026-09-14"
            )
              return {
                recurringActivities: recurring,
                plannedActivities: planned.map((item) => ({
                  id: item.id,
                  date: item.date,
                  title: item.name,
                  manuallyCompleted: item.manuallyCompleted,
                })),
                activities: completed,
              }
            if (request.path === "/app/api/react-calendar/recurring-activities/series-123")
              return series
            if (request.path === "/app/api/react-calendar/42/planned-activities") {
              expect(request.ids?.length).toBeGreaterThan(0)
              expect(request.ids!.length).toBeLessThanOrEqual(100)
              expect(request.ids!.join(",").length).toBeLessThanOrEqual(8192)
              const matches = planned.filter(
                (item) =>
                  (typeof item.id === "string" || typeof item.id === "number") &&
                  request.ids!.includes(String(item.id)),
              )
              return hydrateResponse ? hydrateResponse(matches) : matches
            }
            if (request.path === "/app/api/calendar/42/ff-progress")
              return { pending: false, failed: false }
            throw new Error(`unexpected request ${request.path}`)
          },
        }
      },
    },
  )
  return {
    invoke,
    writes,
    requests,
    hydrate: (transform: (data: Record<string, Schema.Json>[]) => Schema.Json) => {
      hydrateResponse = transform
    },
    planned: (items: Record<string, Schema.Json>[]) => {
      planned = items
    },
    series: (items: Schema.Json) => {
      series = items
    },
    noRecurrence: () => {
      recurring = []
      series = []
    },
    changeCompleted: () => {
      completed = [{ id: 101, started: "2026-09-08T09:00:00", tss: 99, type: 1 }, completed[1]!]
    },
    reverse: () => {
      recurring.reverse()
      planned.reverse()
      completed.reverse()
      if (Array.isArray(series)) series.reverse()
    },
    fail: () => {
      failWrite = true
    },
  }
}

it("previews unbounded deletion, writes once and verifies an empty recurrence tail with materialized/completed snapshots", async () => {
  const f = tailFixture()
  const result = await f.invoke(["delete-recurrence-tail", ...tailFlags])
  expect(result.code).toBe(4)
  const preview = lines(result.stdout)[0]!
  expect(f.writes).toEqual([])
  const plan = preview.plan
  expect(plan.before.deletionScope).toMatchObject({
    from: "2026-09-07",
    end: null,
    noEnd: true,
    affectsBeyondPreviewWindow: true,
  })
  expect(plan.before.previewWindow).toEqual({
    from: "2026-09-07",
    through: "2026-09-14",
    partial: true,
  })
  expect(plan.before.anchor).toMatchObject({
    id: "series-123",
    index: 0,
    activity: { date: "2026-09-07" },
  })
  expect(plan.before.linkedPlannedActivities.map((item: { id: string }) => item.id)).toEqual([
    "p1",
    "p3",
  ])
  expect(plan.before.completedActivitySnapshots).toHaveLength(2)
  expect(plan.before.completedPlannedSnapshots).toHaveLength(1)
  expect(plan.request).toEqual({
    method: "DELETE",
    path: "/app/api/calendar-recurrence/series-123?from=2026-09-07",
    body: null,
  })
  const applied = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
  expect(applied.data).toMatchObject({ submitted: true, verification: "required" })
  expect(f.writes).toHaveLength(1)
  expect(applied.next[0].args).toEqual(["recurrence-tail-state", ...tailFlags, "--json"])
  const verified = lines((await f.invoke(applied.next[0].args)).stdout)[0]!
  expect(verified.data.records.occurrences).toEqual([])
  expect(
    verified.data.records.linkedPlannedActivities.map((item: { id: string }) => item.id),
  ).toEqual(["p3"])
  expect(verified.data.records.completedActivitySnapshots).toEqual(
    plan.before.completedActivitySnapshots,
  )
  expect(verified.data.records.completedPlannedSnapshots).toEqual(
    plan.before.completedPlannedSnapshots,
  )
  expect(verified.data.records.verification).toContain("no preservation")
  expect((await f.invoke(applied.next[1].args)).code).toBe(0)
  expect((await f.invoke(applied.next[2].args)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})

it("does not false-stale when series, timeline, batch and completed records reorder", async () => {
  const f = tailFixture()
  const preview = lines((await f.invoke(["delete-recurrence-tail", ...tailFlags])).stdout)[0]!
  f.reverse()
  expect((await f.invoke(preview.confirmation.confirmArgs)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})

it.each([null, "other-series"])(
  "keeps surviving planned IDs visible when recurrence linkage becomes %j",
  async (linkage) => {
    const f = tailFixture()
    const preview = lines((await f.invoke(["delete-recurrence-tail", ...tailFlags])).stdout)[0]!
    expect(preview.plan.before.linkedPlannedActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p1", recurrenceId: "series-123", manuallyCompleted: false }),
      ]),
    )
    const applied = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
    f.planned([materialized("p1", linkage)])
    const verified = lines((await f.invoke(applied.next[0].args)).stdout)[0]!
    expect(verified.data.records.occurrences).toEqual([])
    expect(verified.data.records.linkedPlannedActivities).toEqual([])
    expect(verified.data.records.inspectedPlannedActivities).toEqual([
      expect.objectContaining({ id: "p1", recurrenceId: linkage, manuallyCompleted: false }),
    ])
    expect(verified.data.records.verification).toContain(
      "no preservation or whole-tail completion claim",
    )
    expect(f.writes).toHaveLength(1)
  },
)

it.each(["linked", "completed", "definition"])(
  "rejects stale %s state without writing",
  async (kind) => {
    const f = tailFixture()
    const preview = lines((await f.invoke(["delete-recurrence-tail", ...tailFlags])).stdout)[0]!
    if (kind === "linked")
      f.hydrate((data) =>
        data.map((item) => (item.id === "p1" ? { ...item, recurrenceId: "other-series" } : item)),
      )
    if (kind === "completed") f.changeCompleted()
    if (kind === "definition")
      f.series([occurrence(0, 7), { ...occurrence(1, 14), newUnknownField: true }])
    const result = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
    expect(result.error.code).toBe("stale_confirmation")
    expect(f.writes).toEqual([])
  },
)

it.each(["missing", "duplicate", "foreign", "shape", "missing-linkage", "date", "completion"])(
  "refuses %s hydration before writing",
  async (kind) => {
    const f = tailFixture()
    f.hydrate((data) => {
      if (kind === "missing") return data.slice(1)
      if (kind === "duplicate") return [...data, data[0]!]
      if (kind === "foreign") return [...data, materialized("foreign", "series-123")]
      if (kind === "shape") return { items: data }
      if (kind === "missing-linkage") return data.map(({ recurrenceId: _omit, ...item }) => item)
      if (kind === "date")
        return data.map((item) => ({ ...item, date: { year: 2026, month: 9, day: 13 } }))
      return data.map((item) => ({ ...item, manuallyCompleted: !item.manuallyCompleted }))
    })
    expect(
      lines((await f.invoke(["delete-recurrence-tail", ...tailFlags, "--yes"])).stdout)[0]!.error
        .code,
    ).toBe("invalid_data")
    expect(f.writes).toEqual([])
  },
)

it("rejects materialized-only anchors but permits their deletion-aware state read", async () => {
  const f = tailFixture()
  f.noRecurrence()
  expect(
    lines((await f.invoke(["delete-recurrence-tail", ...tailFlags, "--yes"])).stdout)[0]!.error
      .code,
  ).toBe("not_found")
  expect(f.writes).toEqual([])
  const result = lines((await f.invoke(["recurrence-tail-state", ...tailFlags])).stdout)[0]!
  expect(result.data.records.occurrences).toEqual([])
  expect(result.data.records.linkedPlannedActivities).toHaveLength(2)
})

it("does not retry an uncertain delete and offers a successful read-only recovery", async () => {
  const f = tailFixture()
  f.fail()
  const result = lines(
    (await f.invoke(["delete-recurrence-tail", ...tailFlags, "--yes"])).stdout,
  )[0]!
  expect(result.error.code).toBe("cannot_write")
  expect(f.writes).toHaveLength(1)
  expect(result.next[0].args).toEqual(["recurrence-tail-state", ...tailFlags, "--json"])
  expect((await f.invoke(result.next[0].args)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})

it("hydrates every member planned ID in batches of at most 100 using string IDs", async () => {
  const f = tailFixture()
  f.planned(
    Array.from({ length: 201 }, (_, i) => materialized(i + 1, i === 0 ? "series-123" : null)),
  )
  expect((await f.invoke(["recurrence-tail-state", ...tailFlags])).code).toBe(0)
  const batches = f.requests.filter((request) => request.ids !== undefined)
  expect(batches.map((request) => request.ids?.length)).toEqual([100, 100, 1])
  expect(new Set(batches.flatMap((request) => request.ids!)).size).toBe(201)
})

it("also bounds batch header length", async () => {
  const f = tailFixture()
  f.planned(Array.from({ length: 20 }, (_, i) => materialized(`${i}-${"x".repeat(1000)}`, null)))
  expect((await f.invoke(["recurrence-tail-state", ...tailFlags])).code).toBe(0)
  expect(f.requests.filter((request) => request.ids !== undefined)).toHaveLength(3)
})

it("uses identical code-unit ordering across mixed-case batch boundaries and reordered confirmation", async () => {
  const f = tailFixture()
  const ids = Array.from(
    { length: 151 },
    (_, i) => `${i % 2 ? "a" : "Z"}-${String(i).padStart(3, "0")}`,
  )
  f.planned(ids.map((id) => materialized(id, "series-123")))
  const preview = lines((await f.invoke(["delete-recurrence-tail", ...tailFlags])).stdout)[0]!
  const batches = f.requests.filter((request) => request.ids !== undefined)
  expect(batches.map((request) => request.ids!.length)).toEqual([100, 51])
  expect(batches.flatMap((request) => request.ids!)).toEqual(ids.toSorted())
  f.reverse()
  expect((await f.invoke(preview.confirmation.confirmArgs)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})

it("does not issue an empty hydration batch or read a deleted series during verification", async () => {
  const f = tailFixture()
  f.planned([])
  f.noRecurrence()
  const result = await f.invoke(["recurrence-tail-state", ...tailFlags])
  expect(result.code).toBe(0)
  expect(f.requests).toHaveLength(1)
  expect(lines(result.stdout)[0]!.data.records.linkedPlannedActivities).toEqual([])
})

it.each([
  { replacement: ["--index", "99"] },
  { replacement: ["--index", "-1"] },
  { replacement: ["--from", "2026-09-08"] },
  { replacement: ["--verify-through", "2026-09-06"] },
])("rejects nonmatching or invalid tail filters %j", async ({ replacement }) => {
  const f = tailFixture()
  const flags = tailFlags.map((item, index) =>
    tailFlags[index - 1] === replacement[0] ? replacement[1]! : item,
  )
  expect((await f.invoke(["delete-recurrence-tail", ...flags, "--yes"])).code).not.toBe(0)
  expect(f.writes).toEqual([])
})

it("limits suggested reads without losing discovered IDs or recovery guidance", async () => {
  const f = fixture()
  f.timeline({
    recurringActivities: ["one", "two", "three", "four"].map((id) => ({ ...stub(0, 7), id })),
  })
  const result = lines((await f.invoke(["recurring-activities", ...windowArgs])).stdout)[0]!
  expect(result.data.records.occurrences).toHaveLength(4)
  expect(result.next).toHaveLength(3)
  expect(result.next[2].args).toEqual(["guide", "get", "recurrence-changes", "--json"])
})

it("does not retry a failed read or attempt a mutation", async () => {
  const f = fixture()
  f.fail()
  expect((await f.invoke(stateArgs)).code).not.toBe(0)
  expect(f.requests).toHaveLength(1)
})

it.each([
  { frequency: { isCustom: false, type: 99, interval: 1, weekDays: 1, excludedIndices: [] } },
  { frequency: { isCustom: true, type: 1, interval: 0, weekDays: 1, excludedIndices: [] } },
  { frequency: { isCustom: true, type: 1, interval: 1, weekDays: 128, excludedIndices: [] } },
  { frequency: { isCustom: true, type: 1, interval: 1, weekDays: 1, excludedIndices: [-1] } },
  { endCriteria: { maxRecurrences: -2 } },
  { startDate: { year: 2026, month: 2, day: 30 } },
])("rejects malformed definitions %j", async (changes) => {
  const f = fixture()
  const first = occurrence(0, 7)
  f.series([{ ...first, definition: { ...first.definition, ...changes } }, occurrence(1, 14)])
  expect(lines((await f.invoke(stateArgs)).stdout)[0]!.error.code).toBe("invalid_data")
})

it("normalizes a date end criterion and limits extra response dates locally", async () => {
  const f = fixture()
  f.timeline({ recurringActivities: [stub(0, 7), stub(1, 14), stub(2, 21)] })
  const first = occurrence(0, 7)
  f.series([
    {
      ...first,
      definition: {
        ...first.definition,
        startDate: "2026-09-07",
        endCriteria: { date: "2026-10-07" },
      },
    },
    occurrence(1, 14),
    occurrence(2, 21),
  ])
  const result = lines((await f.invoke(stateArgs)).stdout)[0]!
  expect(result.data.records.occurrences).toHaveLength(2)
  expect(result.data.records.occurrences[0].definition.endCriteria).toEqual({ date: "2026-10-07" })
})
