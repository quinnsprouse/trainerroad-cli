import { expect, it } from "vitest"
import type { Schema } from "effect"
import type { ApiRequest } from "../src/domain/workflow.ts"
import { planningWorkflows, reapplyPlanWorkflow } from "../src/domain/planning-workflows.ts"
import { lines, makeInvoke } from "./harness.ts"

const baseAnnotation = {
  id: "note-123",
  title: "Before",
  text: "Keep me",
  typeId: 1,
  colorId: 2,
  date: { year: 2026, month: 9, day: 7 },
  duration: 86400,
  plannedActivityGroupId: null,
}
const basePlan = {
  id: 501,
  name: "Before",
  start: "2026-09-07T00:00:00",
  end: "2026-12-20T00:00:00",
}
const emptyCalendar = () => ({
  plannedActivities: [],
  activities: [],
  annotations: [],
  events: [],
  recurringActivities: [],
})
const fixture = () => {
  let annotation: Schema.Json = structuredClone(baseAnnotation)
  let plans: Schema.Json = [structuredClone(basePlan)]
  let event: Schema.Json = { id: "event-123", name: "Fondo", customPlanId: 501 }
  let calendar: Schema.Json = {
    ...emptyCalendar(),
    plannedActivities: [
      { id: "planned-1", date: { year: 2026, month: 9, day: 7 }, manuallyCompleted: false },
      { id: "planned-2", date: { year: 2026, month: 9, day: 8 }, manuallyCompleted: true },
    ],
  }
  let failed = false
  const writes: ApiRequest[] = []
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
        request: async (request, signal, mutation) => {
          expect(signal).toBeInstanceOf(AbortSignal)
          if (mutation) {
            writes.push(request)
            if (failed) throw new Error("response lost")
            if (request.path === "/app/api/calendar/annotations/note-123")
              annotation = { ...baseAnnotation, ...(request.body as object) }
            if (request.path.endsWith("note-123/move"))
              annotation = { ...baseAnnotation, date: "2026-09-14" }
            if (request.path === "/app/api/plan-builder/custom-plan/501")
              plans = [{ ...basePlan, name: "Autumn" }]
            if (request.path.includes("week/delete"))
              calendar = {
                ...emptyCalendar(),
                plannedActivities: [
                  {
                    id: "planned-2",
                    date: { year: 2026, month: 9, day: 8 },
                    manuallyCompleted: true,
                  },
                ],
              }
            return null
          }
          reads.push(request)
          if (request.path === "/app/api/react-calendar/annotation/note-123") return annotation
          if (request.path === "/app/api/annotation-color")
            return [
              { id: 2, annotationTypeId: 1 },
              { id: 9, annotationTypeId: 2 },
            ]
          if (
            request.path === "/app/api/plan-builder/current-custom-plans" ||
            request.path === "/app/api/plan-builder/42/all-user-plans"
          )
            return plans
          if (request.path === "/app/api/react-calendar/42/single-event/event-123") return event
          if (request.path.startsWith("/app/api/react-calendar/42/timeline?")) return calendar
          if (request.path === "/app/api/calendar/42/ff-progress")
            return { pending: false, failed: false }
          throw new Error(`Unexpected request: ${request.path}`)
        },
      }),
    },
  )
  return {
    invoke,
    writes,
    reads,
    changeAnnotation: (next: Schema.Json) => {
      annotation = next
    },
    changePlans: (next: Schema.Json) => {
      plans = next
    },
    changeEvent: (next: Schema.Json) => {
      event = next
    },
    changeCalendar: (next: Schema.Json) => {
      calendar = next
    },
    fail: () => {
      failed = true
    },
  }
}

it("previews named annotation edits, writes once, verifies saved fields and carries dates", async () => {
  const f = fixture()
  const args = [
    "edit-annotation",
    "--id",
    "note-123",
    "--title",
    "After",
    "--text",
    "",
    "--days",
    "2",
    "--session-file",
    "/fake/session.json",
  ]
  const previewResult = await f.invoke(args)
  expect(previewResult.code).toBe(4)
  const preview = lines(previewResult.stdout)[0]!
  expect(f.writes).toEqual([])
  const applied = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
  expect(f.writes).toEqual([
    {
      method: "PUT",
      path: "/app/api/calendar/annotations/note-123",
      body: {
        colorId: 2,
        date: "2026-09-07",
        duration: 172800,
        text: "",
        title: "After",
        typeId: 1,
      },
    },
  ])
  const verified = lines((await f.invoke(applied.next[0].args)).stdout)[0]!
  expect(verified.data.records.annotation).toMatchObject({
    title: "After",
    text: "",
    duration: 172800,
  })
  expect(verified.next[0].args).toEqual([
    "adaptation-status",
    "--from",
    "2026-09-07",
    "--to",
    "2026-09-08",
    "--session-file",
    "/fake/session.json",
    "--json",
  ])
  expect((await f.invoke(verified.next[0].args)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})

it("moves an annotation using date strings from its current record", async () => {
  const f = fixture()
  const result = lines(
    (await f.invoke(["move-annotation", "--id", "note-123", "--to", "2026-09-14", "--yes"])).stdout,
  )[0]!
  expect(f.writes[0]).toEqual({
    method: "PUT",
    path: "/app/api/calendar/annotations/note-123/move",
    body: { oldDate: "2026-09-07", newDate: "2026-09-14" },
  })
  const checked = lines((await f.invoke(result.next[0].args)).stdout)[0]!
  expect(checked.data.records.annotation.date).toBe("2026-09-14")
})

it.each([
  ["edit-annotation", "--id", "note-123"],
  ["edit-annotation", "--id", "note-123", "--days", "0"],
  ["edit-annotation", "--id", "note-123", "--type", "illness"],
  ["edit-annotation", "--id", "note-123", "--color-id", "999"],
  ["move-annotation", "--id", "note-123", "--to", "2026-02-30"],
  ["move-annotation", "--id", "note-123", "--to", "2026-09-07"],
  ["delete-week", "--start", "2026-09-07", "--end", "2026-09-14"],
  ["move-week", "--start", "2026-09-07", "--to", "2026-09-07"],
])("rejects invalid or ambiguous intent %j", async (...args) => {
  const f = fixture()
  expect((await f.invoke([...args, "--yes"])).code).not.toBe(0)
  expect(f.writes).toEqual([])
})

it.each([
  null,
  { ...baseAnnotation, typeId: 6 },
  { ...baseAnnotation, duration: 1 },
  { ...baseAnnotation, date: { year: 2026, month: 2, day: 30 } },
  { ...baseAnnotation, id: "other" },
  { ...baseAnnotation, text: undefined },
])("fails closed for unknown annotation state %j", async (annotation) => {
  const f = fixture()
  f.changeAnnotation(JSON.parse(JSON.stringify(annotation)) as Schema.Json)
  expect(
    (await f.invoke(["edit-annotation", "--id", "note-123", "--title", "After", "--yes"])).code,
  ).not.toBe(0)
  expect(f.writes).toEqual([])
})

it("refuses stale annotation content before dispatch", async () => {
  const f = fixture()
  const preview = lines(
    (await f.invoke(["edit-annotation", "--id", "note-123", "--title", "After"])).stdout,
  )[0]!
  f.changeAnnotation({ ...baseAnnotation, text: "Changed elsewhere" })
  const result = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
  expect(result.error.code).toBe("stale_confirmation")
  expect(f.writes).toEqual([])
})

it("renames only a discovered current custom plan and reads it back", async () => {
  const f = fixture()
  const result = lines(
    (await f.invoke(["rename-plan", "--id", "501", "--name", "Autumn", "--yes"])).stdout,
  )[0]!
  expect(f.writes[0]).toEqual({
    method: "POST",
    path: "/app/api/plan-builder/custom-plan/501",
    body: { updatedName: "Autumn" },
  })
  const verified = lines((await f.invoke(result.next[0].args)).stdout)[0]!
  expect(verified.data.records.plan.name).toBe("Autumn")
})

it("offers custom plan discovery for a missing id", async () => {
  const f = fixture()
  const result = lines(
    (
      await f.invoke([
        "rename-plan",
        "--id",
        "999",
        "--name",
        "Autumn",
        "--yes",
        "--session-file",
        "/fake/session.json",
      ])
    ).stdout,
  )[0]!
  expect(result.error.code).toBe("not_found")
  expect(result.next[0].args[0]).toBe("custom-plans")
  expect((await f.invoke(result.next[0].args)).code).toBe(0)
  expect(f.writes).toEqual([])
})

it.each(["copy", "move"])(
  "uses date objects and six inclusive day offsets for %s-week",
  async (operation) => {
    const f = fixture()
    const args = [`${operation}-week`, "--start", "2026-09-07", "--to", "2026-09-14"]
    expect((await f.invoke([...args, "--dry-run"])).code).toBe(0)
    expect(f.writes).toEqual([])
    const result = lines((await f.invoke([...args, "--yes"])).stdout)[0]!
    expect(f.writes).toEqual([
      {
        method: "POST",
        path: `/app/api/react-calendar/week/${operation}`,
        body: {
          oldDate: { year: 2026, month: 9, day: 7 },
          newDate: { year: 2026, month: 9, day: 14 },
          days: 6,
        },
      },
    ])
    expect(f.reads.map((request) => request.path)).toContain(
      "/app/api/react-calendar/42/timeline?start=2026-09-07&end=2026-09-13",
    )
    const verifications = await Promise.all(
      result.next.map((action: { args: string[] }) => f.invoke(action.args)),
    )
    expect(verifications.map((verification) => verification.code)).toEqual([0, 0])
    const verified = lines((await f.invoke(result.next[0].args)).stdout)[0]!
    expect(verified.next[0].args.slice(0, 5)).toEqual([
      "adaptation-status",
      "--from",
      "2026-09-14",
      "--to",
      "2026-09-20",
    ])
    expect(f.writes).toHaveLength(1)
  },
)

it("shows the expected deletion set and preserves manually completed records", async () => {
  const f = fixture()
  const result = lines(
    (await f.invoke(["delete-week", "--start", "2026-09-07", "--end", "2026-09-13", "--yes"]))
      .stdout,
  )[0]!
  expect(f.writes).toEqual([
    {
      method: "DELETE",
      path: "/app/api/react-calendar/week/delete?startDate=2026-09-07&endDate=2026-09-13",
      body: null,
    },
  ])
  const verified = lines((await f.invoke(result.next[0].args)).stdout)[0]!
  expect(
    verified.data.records.calendar.plannedActivities.map((item: { id: string }) => item.id),
  ).toEqual(["planned-2"])
  const spec = planningWorkflows.find((item) => item.name === "delete-week")!
  const before = spec.select!(
    {
      calendar: {
        ...emptyCalendar(),
        plannedActivities: [
          { id: "one", date: "2026-09-07", manuallyCompleted: false },
          { id: "two", date: "2026-09-08", manuallyCompleted: true },
        ],
      },
    },
    { start: "2026-09-07", end: "2026-09-13" },
  )
  expect(before.expectedDeletions).toEqual([
    { id: "one", date: "2026-09-07", manuallyCompleted: false },
  ])
  expect(before.preservedManuallyCompleted).toEqual([
    { id: "two", date: "2026-09-08", manuallyCompleted: true },
  ])
})

it.each([{}, { ...emptyCalendar(), plannedActivities: [{ id: "unknown", date: "2026-09-07" }] }])(
  "rejects incomplete bulk deletion evidence %j",
  async (calendar) => {
    const f = fixture()
    f.changeCalendar(calendar)
    expect(
      (await f.invoke(["delete-week", "--start", "2026-09-07", "--end", "2026-09-13", "--yes"]))
        .code,
    ).not.toBe(0)
    expect(f.writes).toEqual([])
  },
)

it.each([
  null,
  { id: "event-123", name: "Fondo" },
  { id: "event-123", name: "Fondo", customPlanId: 999 },
  { id: "event-123", name: "Fondo", planDetails: { customPlanId: 501 } },
])("requires observed top-level event membership %j", async (event) => {
  const f = fixture()
  f.changeEvent(event)
  expect(
    (await f.invoke(["reapply-plan", "--plan-id", "501", "--event-id", "event-123", "--yes"])).code,
  ).not.toBe(0)
  expect(f.writes).toEqual([])
})

it("validates reapply plan and event identities and sends one null-body PUT", async () => {
  const f = fixture()
  const result = lines(
    (await f.invoke(["reapply-plan", "--plan-id", "501", "--event-id", "event-123", "--yes"]))
      .stdout,
  )[0]!
  expect(f.writes).toEqual([
    {
      method: "PUT",
      path: "/app/api/calendar/plans/plan/501/reapply-plan?eventId=event-123",
      body: null,
    },
  ])
  expect((await f.invoke(result.next[0].args)).code).toBe(0)
  expect(
    reapplyPlanWorkflow.reads(
      { planId: "501", eventId: "event-123" },
      { memberId: 42, username: "fixture" },
    ).event?.path,
  ).toBe("/app/api/react-calendar/42/single-event/event-123")
})

it.each([
  ["edit-annotation", "--id", "note-123", "--title", "After"],
  ["rename-plan", "--id", "501", "--name", "Autumn"],
  ["delete-week", "--start", "2026-09-07", "--end", "2026-09-13"],
])("never retries an uncertain write for %j and makes recovery read-only", async (...args) => {
  const f = fixture()
  f.fail()
  const result = lines(
    (await f.invoke([...args, "--yes", "--session-file", "/fake/session.json"])).stdout,
  )[0]!
  expect(result.error.code).toBe("cannot_write")
  expect(f.writes).toHaveLength(1)
  expect(result.next[0].args).not.toContain("--yes")
  expect(result.next[0].args).toContain("/fake/session.json")
  expect((await f.invoke(result.next[0].args)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})
