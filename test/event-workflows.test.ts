import { expect, it } from "vitest"
import type { Schema } from "effect"
import type { ApiRequest } from "../src/domain/workflow.ts"
import { lines, makeInvoke } from "./harness.ts"

const baseEvent = {
  id: "event-123",
  name: "Fondo",
  date: { year: 2026, month: 9, day: 7 },
  timeOfDay: "08:15:00",
  durationInSeconds: 7200,
  discipline: 4,
  racePriority: 3,
  notes: "Keep this",
  stressEstimateType: 1,
  stressEstimateValue: 150,
  customPlanId: null,
  manuallyCompleted: false,
}
const fixture = () => {
  let event: Record<string, Schema.Json> = { ...baseEvent }
  let membership: Schema.Json = { id: "event-123", stageRaceId: null, isTriRace: false }
  let failed = false
  let overlapping: Schema.Json = false
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
            const body = request.body as Record<string, Schema.Json>
            if (typeof body.date !== "string")
              throw new Error("missing event date in fixture write")
            const [year, month, day] = body.date.split("-").map(Number)
            event = {
              ...event,
              name: body.name!,
              notes: body.notes!,
              date: { year: year!, month: month!, day: day! },
              ...(body.time === undefined ? {} : { timeOfDay: body.time }),
              discipline: body.discipline!,
              racePriority: body.racePriority!,
              durationInSeconds: body.duration!,
              stressEstimateType: body.stressEstimateType!,
              stressEstimateValue:
                body.stressEstimateType === 1 ? body.tss! : body.stressEstimateValue!,
            }
            return { planToReapply: { id: 501, routeToPlanBuilder: true } }
          }
          reads.push(request)
          if (request.path === "/app/api/react-calendar/42/single-event/event-123") return event
          if (request.path === "/app/api/calendar/42/events/event-123") return membership
          if (request.path.startsWith("/app/api/react-calendar/42/has-overlapping-a-races?"))
            return overlapping
          if (request.path === "/app/api/calendar/42/ff-progress")
            return { pending: false, failed: false }
          throw new Error(`Unexpected request ${request.path}`)
        },
      }),
    },
  )
  return {
    invoke,
    reads,
    writes,
    change: (fields: Record<string, Schema.Json>) => {
      event = { ...event, ...fields }
    },
    omit: (field: string) => {
      event = Object.fromEntries(Object.entries(event).filter(([key]) => key !== field))
    },
    membership: (next: Schema.Json) => {
      membership = next
    },
    fail: () => {
      failed = true
    },
    overlap: (next: Schema.Json) => {
      overlapping = next
    },
  }
}
const edit = ["edit-event", "--id", "event-123"]

it("previews, confirms one preserving edit, and follows read-only verification", async () => {
  const f = fixture()
  f.change({ privateField: "do not retain", customPlanId: 501 })
  const result = await f.invoke([
    ...edit,
    "--name",
    "Autumn",
    "--notes",
    "",
    "--session-file",
    "/fake/session.json",
  ])
  expect(result.code).toBe(4)
  expect(f.writes).toEqual([])
  expect(result.stdout).not.toContain("privateField")
  const preview = lines(result.stdout)[0]!
  const applied = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
  expect(applied.data).toMatchObject({ submitted: true, verification: "required" })
  expect(f.writes).toEqual([
    {
      method: "PUT",
      path: "/app/api/calendar/plannedactivities/event-123/event",
      body: {
        name: "Autumn",
        date: "2026-09-07",
        time: "08:15:00",
        discipline: 4,
        duration: 7200,
        notes: "",
        racePriority: 3,
        stressEstimateType: 1,
        stressEstimateValue: null,
        tss: 150,
        customPlanId: 501,
        manuallyCompleted: false,
      },
    },
  ])
  expect(applied.next[0].args).toEqual([
    "event-state",
    "--id",
    "event-123",
    "--session-file",
    "/fake/session.json",
    "--json",
  ])
  const checked = lines((await f.invoke(applied.next[0].args)).stdout)[0]!
  expect(checked.data.records.event).toMatchObject({ name: "Autumn", notes: "", customPlanId: 501 })
  expect(checked.next[0].args).toEqual([
    "adaptation-status",
    "--from",
    "2026-09-07",
    "--to",
    "2026-09-07",
    "--session-file",
    "/fake/session.json",
    "--json",
  ])
  expect((await f.invoke(checked.next[0].args)).code).toBe(0)
  expect(applied.next[1].message).toContain("Plan Builder")
  expect((await f.invoke(applied.next[1].args)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})

it("reads exact member routes and preserves intensity without confusing it with TSS", async () => {
  const f = fixture()
  f.change({ secret: "omit", stressEstimateType: 2, stressEstimateValue: 4 })
  const result = lines((await f.invoke(["event-state", "--id", "event-123"])).stdout)[0]!
  expect(result.data.records.event).toMatchObject({
    stressEstimateType: 2,
    stressEstimateValue: 4,
    tss: null,
  })
  expect(result.data.records.event.secret).toBeUndefined()
  expect(f.reads.map((request) => request.path)).toEqual([
    "/app/api/react-calendar/42/single-event/event-123",
    "/app/api/calendar/42/events/event-123",
  ])
  expect((await f.invoke([...edit, "--name", "After", "--yes"])).code).toBe(0)
  expect(f.writes[0]?.body).toMatchObject({
    stressEstimateType: 2,
    stressEstimateValue: 4,
    tss: null,
  })
})

it("allows standalone duration/custom TSS without changing date or priority", async () => {
  const f = fixture()
  f.change({ stressEstimateType: 2, stressEstimateValue: 4 })
  expect(
    (await f.invoke([...edit, "--duration-seconds", "9000", "--tss", "180", "--yes"])).code,
  ).toBe(0)
  expect(f.writes[0]?.body).toMatchObject({
    duration: 9000,
    tss: 180,
    stressEstimateType: 1,
    stressEstimateValue: null,
    date: "2026-09-07",
    racePriority: 3,
  })
})

it.each(["duration-seconds", "tss"])("refuses plan-attached %s changes", async (flag) => {
  const f = fixture()
  f.change({ customPlanId: 501 })
  const result = lines((await f.invoke([...edit, `--${flag}`, "180", "--yes"])).stdout)[0]!
  expect(result.error.code).toBe("invalid_usage")
  expect(f.writes).toEqual([])
})

it("changes date/time/discipline/priority with one write and verifies both affected dates", async () => {
  const f = fixture()
  const preview = lines(
    (
      await f.invoke([
        ...edit,
        "--date",
        "2026-09-14",
        "--time",
        "09:30",
        "--discipline",
        "gravel",
        "--race-priority",
        "a",
        "--session-file",
        "/fake/selected.json",
      ])
    ).stdout,
  )[0]!
  expect(preview.status).toBe("confirmation_required")
  expect(preview.plan.before.overlappingARaces).toBe(false)
  expect(f.writes).toEqual([])
  const result = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0]?.body).toMatchObject({
    date: "2026-09-14",
    time: "09:30:00",
    discipline: 16,
    racePriority: 3,
    notes: baseEvent.notes,
    tss: 150,
    customPlanId: null,
  })
  expect(f.reads.filter((request) => request.path.includes("has-overlapping-a-races"))).toEqual(
    expect.arrayContaining([
      {
        method: "GET",
        body: null,
        path: "/app/api/react-calendar/42/has-overlapping-a-races?date=2026-09-14&raceId=event-123",
      },
    ]),
  )
  expect(result.next[0].args).toEqual([
    "event-state",
    "--id",
    "event-123",
    "--from",
    "2026-09-07",
    "--to",
    "2026-09-14",
    "--session-file",
    "/fake/selected.json",
    "--json",
  ])
  const check = lines((await f.invoke(result.next[0].args)).stdout)[0]!
  expect(check.data.records.event).toMatchObject({
    date: "2026-09-14",
    time: "09:30:00",
    discipline: 16,
  })
  expect(check.next[0].args).toEqual([
    "adaptation-status",
    "--from",
    "2026-09-07",
    "--to",
    "2026-09-14",
    "--session-file",
    "/fake/selected.json",
    "--json",
  ])
  expect((await f.invoke(check.next[0].args)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})

it("preserves the union when moving an event earlier", async () => {
  const f = fixture()
  const result = lines((await f.invoke([...edit, "--date", "2026-09-01", "--yes"])).stdout)[0]!
  expect(result.next[0].args).toContain("2026-09-01")
  expect(result.next[0].args).toContain("2026-09-07")
})

it("clears time explicitly and allows demoting a standalone A event", async () => {
  const f = fixture()
  expect((await f.invoke([...edit, "--clear-time", "--race-priority", "b", "--yes"])).code).toBe(0)
  expect(f.writes[0]?.body).toMatchObject({ time: null, racePriority: 2 })
  expect(f.reads.some((request) => request.path.includes("has-overlapping"))).toBe(false)
})

it.each([
  ["--date", "2026-02-30"],
  ["--time", "24:00"],
  ["--time", "09:07"],
  ["--time", "09:00", "--clear-time"],
  ["--race-priority", "a"],
  ["--discipline", "triathlon"],
  ["--clear-time", "false"],
])("rejects ambiguous event changes %j", async (...args) => {
  const f = fixture()
  expect((await f.invoke([...edit, ...args, "--yes"])).code).toBe(64)
  expect(f.writes).toEqual([])
})

it.each([
  ["--date", "2026-09-14"],
  ["--time", "09:30"],
  ["--clear-time"],
  ["--race-priority", "c"],
  ["--discipline", "gravel"],
])("keeps new fields unavailable for plan-attached events %j", async (...args) => {
  const f = fixture()
  f.change({ customPlanId: 501 })
  expect((await f.invoke([...edit, ...args, "--yes"])).code).toBe(64)
  expect(f.writes).toEqual([])
})

it.each([true, null, {}, "false"])("refuses unavailable A-race clearance %j", async (overlap) => {
  const f = fixture()
  f.overlap(overlap)
  expect((await f.invoke([...edit, "--date", "2026-09-14", "--yes"])).code).not.toBe(0)
  expect(f.writes).toEqual([])
})

it("rechecks spacing after confirmation and refuses a newly conflicting A race", async () => {
  const f = fixture()
  const preview = lines((await f.invoke([...edit, "--date", "2026-09-14"])).stdout)[0]!
  f.overlap(true)
  expect((await f.invoke(preview.confirmation.confirmArgs)).code).not.toBe(0)
  expect(f.writes).toEqual([])
})

it("allows a conflicting date only when the user selects a non-A priority", async () => {
  const f = fixture()
  f.overlap(true)
  expect(
    (await f.invoke([...edit, "--date", "2026-09-14", "--race-priority", "c", "--yes"])).code,
  ).toBe(0)
  expect(f.writes[0]?.body).toMatchObject({ racePriority: 1, date: "2026-09-14" })
})

it.each([
  { id: "foreign-event" },
  { discipline: 6 },
  { discipline: -1 },
  { discipline: 17 },
  { stressEstimateType: 3 },
  { date: { year: 2026, month: 2, day: 30 } },
  { durationInSeconds: 0 },
  { customPlanId: {} },
  { timeOfDay: "tomorrow" },
])("fails closed for unsupported response %j", async (fields) => {
  const f = fixture()
  f.change(fields)
  const result = lines((await f.invoke([...edit, "--name", "After", "--yes"])).stdout)[0]!
  expect(result.error.code).toBe("invalid_data")
  expect(f.writes).toEqual([])
})

it.each([
  { id: "foreign-event", stageRaceId: null, isTriRace: false },
  { id: "event-123", stageRaceId: "stage-123", isTriRace: false },
  { id: "event-123", stageRaceId: null, isTriRace: true },
  { id: "event-123" },
])("refuses missing, foreign or grouped membership %j", async (membership) => {
  const f = fixture()
  f.membership(membership)
  const result = lines((await f.invoke([...edit, "--notes", "After", "--yes"])).stdout)[0]!
  expect(result.error.code).toBe("invalid_data")
  expect(f.writes).toEqual([])
})

it.each(["durationInSeconds", "customPlanId", "stressEstimateValue"])(
  "refuses missing %s",
  async (field) => {
    const f = fixture()
    f.omit(field)
    const result = lines((await f.invoke([...edit, "--notes", "After", "--yes"])).stdout)[0]!
    expect(result.error.code).toBe("invalid_data")
    expect(f.writes).toEqual([])
  },
)

it.each([
  { args: [] },
  { args: ["--name", "  "] },
  { args: ["--tss", "0"] },
  { args: ["--duration-seconds", "-1"] },
  { args: ["--name", "Fondo"] },
  { args: ["--payload", "{}"] },
])("rejects invalid/no-op/unknown edit inputs %j", async ({ args }) => {
  const f = fixture()
  expect((await f.invoke([...edit, ...args, "--yes"])).code).not.toBe(0)
  expect(f.writes).toEqual([])
})

it("rejects composite group/leg IDs before reading", async () => {
  const f = fixture()
  expect(
    (await f.invoke(["edit-event", "--id", "group§§leg", "--name", "After", "--yes"])).code,
  ).not.toBe(0)
  expect(f.reads).toEqual([])
  expect(f.writes).toEqual([])
})

it("refuses stale content between preview and confirmation", async () => {
  const f = fixture()
  const preview = lines((await f.invoke([...edit, "--name", "After"])).stdout)[0]!
  f.change({ notes: "Changed elsewhere" })
  const result = lines((await f.invoke(preview.confirmation.confirmArgs)).stdout)[0]!
  expect(result.error.code).toBe("stale_confirmation")
  expect(f.writes).toEqual([])
})

it("does not retry an uncertain write and provides a safe read", async () => {
  const f = fixture()
  f.fail()
  const result = lines((await f.invoke([...edit, "--notes", "After", "--yes"])).stdout)[0]!
  expect(result.error.code).toBe("cannot_write")
  expect(f.writes).toHaveLength(1)
  expect(result.next[0].args[0]).toBe("event-state")
  expect((await f.invoke(result.next[0].args)).code).toBe(0)
  expect(f.writes).toHaveLength(1)
})

it("preserves omitted time and caller-observed defaults", async () => {
  const f = fixture()
  f.omit("timeOfDay")
  f.omit("notes")
  f.omit("manuallyCompleted")
  expect((await f.invoke([...edit, "--name", "After", "--yes"])).code).toBe(0)
  expect(f.writes[0]?.body).toMatchObject({ notes: "", manuallyCompleted: false })
  expect(f.writes[0]?.body).not.toHaveProperty("time")
})
