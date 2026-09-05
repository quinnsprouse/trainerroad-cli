import { expect, it } from "vitest"
import { runOperation } from "../src/services/operation-transport.mjs"
import { makeInvoke, lines } from "./harness.ts"

const commands = [
  ["add-workout", "--workout-id", "88"],
  ["copy-workout", "--id", "source"],
  ["add-event", "--name", "Fixture", "--discipline", "gravel", "--duration", "60", "--tss", "50"],
  ["add-annotation", "--type", "time-off", "--days", "3"],
]

function fixture(duplicates: boolean, unrelated = false) {
  const workout = { id: 88, name: "Fixture", isOutside: false }
  const source = { id: "source", date: { year: 2026, month: 9, day: 10 }, workout }
  const planned = [source]
  const events: any[] = []
  const annotations: any[] = []
  const writes: string[] = []
  const create = (kind: string, rows: any[], record: any) => {
    writes.push(kind)
    rows.push({ ...record, id: "created-1" })
    if (duplicates) rows.push({ ...record, id: "created-2" })
  }
  const api = {
    loadSession: async () => true,
    getMemberInfo: async () => ({ memberId: 42, username: "fixture" }),
    getTimeline: async () => ({ plannedActivities: planned, events, annotations }),
    getPlannedActivity: async () => source,
    getWorkoutsByIds: async () => [workout],
    getPlannedActivitiesByIds: async (_member: unknown, _username: unknown, ids: string[]) =>
      planned.filter((row) => ids.includes(row.id)),
    getAnnotation: async (id: string) => annotations.find((row) => row.id === id),
    tryAddWorkoutToCalendar: async () => {
      create("add", planned, { date: { year: 2030, month: 2, day: 1 }, workout })
      return [{ ok: true }]
    },
    copyPlannedActivity: async () => {
      create("copy", planned, { date: { year: 2030, month: 2, day: 1 }, workout })
      return {}
    },
    createEvent: async (request: any) => {
      create("event", events, {
        name: unrelated ? "Different event" : request.name,
        date: { year: 2030, month: 2, day: 1 },
        activityEventType: request.discipline,
        racePriority: request.racePriority,
      })
      return {}
    },
    createAnnotation: async (request: any) => {
      create("annotation", annotations, {
        ...request,
        title: unrelated ? "Different note" : request.title,
        date: { year: 2030, month: 2, day: 1 },
      })
      return {}
    },
  }
  const invoke = makeInvoke(
    () => {
      throw new Error("unexpected transport")
    },
    (name, flags, phase, now, signal, expected) =>
      runOperation(name, flags, phase, now, signal, expected, () => api),
  )
  return { invoke, writes }
}

it.each(commands)("follows the complete %s guidance journey", async (...args) => {
  const test = fixture(false)
  const dry = lines(
    (
      await test.invoke([
        ...args,
        "--date",
        "2030-02-01",
        "--session-file",
        "/fake/rider with spaces.json",
        "--tz",
        "Pacific/Auckland",
        "--dry-run",
      ])
    ).stdout,
  )[0]!
  expect(dry.guides).toContain("calendar-changes")
  expect(test.writes).toEqual([])
  const preview = lines((await test.invoke(dry.next[0].args)).stdout)[0]!
  expect(preview.status).toBe("confirmation_required")
  expect(preview.next[0].args).toEqual(preview.confirmation.confirmArgs)
  expect(test.writes).toEqual([])
  const applied = await test.invoke(preview.next[0].args)
  expect(applied.code, applied.stdout).toBe(0)
  const success = lines(applied.stdout)[0]!
  expect(success.guides).toEqual([])
  expect(test.writes).toHaveLength(1)
  await Promise.all(
    success.next.map(async (next: { args: string[] }) => {
      expect(next.args).toContain("/fake/rider with spaces.json")
      expect(next.args).toContain("Pacific/Auckland")
      expect((await test.invoke(next.args)).code).toBe(0)
    }),
  )
  const calendar = success.next.find((next: any) => next.args[0] === "future")
  expect(calendar.args).toContain("2030-02-01")
  expect(calendar.args).not.toContain("--days")
  if (args[0] === "add-annotation") expect(calendar.args).toContain("2030-02-03")
  expect(test.writes).toHaveLength(1)
})

it.each(commands)("does not claim success for ambiguous %s records", async (...args) => {
  const test = fixture(true)
  const result = await test.invoke([...args, "--date", "2030-02-01", "--yes"])
  const error = lines(result.stdout)[0]!
  expect(error.error.code).toBe("cannot_write")
  expect(error.error.transient).toBe(false)
  expect(error.guides).toContain("calendar-changes")
  expect(test.writes).toHaveLength(1)
  await Promise.all(
    error.next.map(async (next: { args: string[] }) =>
      expect((await test.invoke(next.args)).code).toBe(0),
    ),
  )
  expect(test.writes).toHaveLength(1)
})

it.each(commands.slice(2))(
  "does not mistake another user's concurrent %s for this write",
  async (...args) => {
    const test = fixture(false, true)
    const result = await test.invoke([...args, "--date", "2030-02-01", "--yes"])
    expect(lines(result.stdout)[0]!.error.code).toBe("cannot_write")
    expect(test.writes).toHaveLength(1)
  },
)
