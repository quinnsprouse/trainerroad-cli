import { expect, it } from "vitest"
import { operationContracts } from "../src/commands/operations.ts"
import { runOperation } from "../src/services/operation-transport.mjs"
import { HttpError } from "../src/trainerroad-client.mjs"
import { makeInvoke, lines } from "./harness.ts"

const member = { memberId: 42, username: "fixture", ftp: 250 }
const workout = { id: 88, name: "Fixture", workoutName: "Fixture", duration: 60, isOutside: false }
const row = { id: "planned-1", date: { year: 2026, month: 9, day: 10 }, workout }
const annotation = {
  id: "note-1",
  date: { year: 2026, month: 9, day: 10 },
  typeId: 1,
  title: "Fixture",
  duration: 86400,
}
const missing = () =>
  new HttpError("fixture missing", { status: 404, statusText: "Not Found", path: "/fixture" })
function fixture() {
  let current: typeof row | null = structuredClone(row)
  let note: typeof annotation | null = structuredClone(annotation)
  let account = { ...member }
  const writes: string[] = []
  const reads: string[] = []
  const api = {
    loadSession: async () => true,
    getMemberInfo: async () => account,
    getTimeline: async () => ({
      plannedActivities: current ? [current] : [],
      activities: [],
      events: [],
      annotations: note ? [note] : [],
      fitnessThresholds: [],
    }),
    getPlannedActivity: async () => {
      if (!current) throw missing()
      return structuredClone(current)
    },
    getPlannedActivitiesByIds: async () => (current ? [structuredClone(current)] : []),
    getActivitiesByIds: async () => [],
    getPersonalRecordsByActivityIds: async () => ({}),
    getAnnotation: async () => {
      if (!note) throw missing()
      return structuredClone(note)
    },
    getPublicTssByUsername: async () => ({
      tssByDay: [],
      ftpRecordsDate: [{ date: "2026-09-01", value: 250 }],
    }),
    getCareerLevels: async () => ({ levels: {} }),
    getCareerSummary: async () => ({ ftp: 250 }),
    getAiFtpEligibility: async () => ({ can: true }),
    getAiFtpFailureStatus: async () => ({}),
    getWeightHistory: async () => [],
    getCurrentCustomPlan: async () => null,
    getAllUserPlans: async () => [],
    getPlanPhases: async () => [],
    getPowerRanking: async () => [],
    getPersonalRecordsForDateRange: async () => ({ results: [{ personalRecords: [] }] }),
    getWorkoutProfilesByZone: async () => [],
    searchWorkoutLibrary: async () => ({ workouts: [workout], predicate: { totalCount: 1 } }),
    getWorkoutsByIds: async () => [workout],
    getWorkoutSummary: async () => ({ summary: workout }),
    getWorkoutLevels: async () => ({}),
    getWorkoutChartData: async () => ({ courseData: [] }),
    getTrainNowStatus: async () => ({}),
    getTrainNowSuggestions: async () => ({ suggestions: { Endurance: [{ workoutId: 88 }] } }),
    getWorkoutInformation: async () => [workout],
    getPlannedActivityAlternates: async () => [],
    deletePlannedActivity: async () => {
      writes.push("deletePlannedActivity")
      current = null
      return {}
    },
    deleteAnnotation: async () => {
      writes.push("deleteAnnotation")
      note = null
      return {}
    },
    switchPlannedActivityMode: async () => {
      writes.push("switchPlannedActivityMode")
      current = { ...row, workout: { ...workout, isOutside: true } }
      return current
    },
    replacePlannedActivityWithAlternate: async () => {
      writes.push("replacePlannedActivityWithAlternate")
      current = { ...row, workout: { ...workout, id: 99 } }
      return current
    },
    createEvent: async () => {
      writes.push("createEvent")
      throw new Error("fixture response lost")
    },
    createAnnotation: async () => {
      writes.push("createAnnotation")
      throw new Error("fixture response lost")
    },
    copyPlannedActivity: async () => {
      writes.push("copyPlannedActivity")
      throw new Error("fixture response lost")
    },
    tryAddWorkoutToCalendar: async () => {
      writes.push("tryAddWorkoutToCalendar")
      throw new Error("fixture response lost")
    },
  }
  const execute: typeof runOperation = (name, flags, phase, now, signal, expected) => {
    reads.push(name)
    return runOperation(name, flags, phase, now, signal, expected, () => api)
  }
  const invoke = makeInvoke(() => {
    throw new Error("no separate move transport")
  }, execute)
  return {
    invoke,
    execute,
    writes,
    reads,
    api,
    changeAccount: () => {
      account = { ...member, memberId: 99 }
    },
    changeRow: () => {
      current = { ...row, workout: { ...workout, name: "Changed" } }
    },
  }
}

const queryArgs: Record<string, string[]> = {
  today: ["--date", "2026-09-10"],
  future: ["--from", "2026-09-01", "--to", "2026-09-30", "--details"],
  past: ["--from", "2026-08-01", "--to", "2026-08-31", "--details"],
  "workout-details": ["--id", "88", "--include-chart", "true"],
  "workout-alternates": ["--id", "planned-1"],
  "annotation-details": ["--id", "note-1"],
}
const mutations: Record<string, string[]> = {
  "add-workout": ["--workout-id", "88", "--date", "2026-09-12"],
  "copy-workout": ["--id", "planned-1", "--date", "2026-09-12"],
  "replace-workout": ["--id", "planned-1", "--alternate-id", "99"],
  "switch-workout": ["--id", "planned-1", "--mode", "outside"],
  "add-event": [
    "--name",
    "Fixture",
    "--date",
    "2026-09-12",
    "--discipline",
    "gravel",
    "--duration",
    "60",
    "--tss",
    "50",
  ],
  "remove-workout": ["--id", "planned-1"],
  "add-annotation": ["--type", "time-off", "--date", "2026-09-12"],
  "remove-annotation": ["--id", "note-1"],
}

it.each([
  ["workout-details", "--id", "planned-1"],
  ["workout-details", "--id=0"],
  ["add-workout", "--workout-id", "-1", "--date", "2026-09-12"],
  [
    "add-event",
    "--name",
    "Fixture",
    "--date",
    "2026-09-12",
    "--discipline",
    "gravel",
    "--duration",
    "60",
    "--intensity",
    "11",
  ],
  [
    "add-event",
    "--name",
    "Fixture",
    "--date",
    "2026-09-12",
    "--discipline",
    "gravel",
    "--duration",
    "60",
    "--intensity",
    "5",
    "--tss",
    "50",
  ],
])("rejects invalid command input before account access: %j", async (...args) => {
  const test = fixture()
  const result = await test.invoke(args)
  expect(result.code).toBe(64)
  expect(test.reads).toEqual([])
  expect(test.writes).toEqual([])
})

it.each(
  operationContracts
    .filter((contract) => contract.kind === "query")
    .map((contract) => contract.name),
)("runs %s through the main runtime with a fixture client", async (name) => {
  const test = fixture()
  const result = await test.invoke([name, ...(queryArgs[name] ?? [])])
  expect(result.code, result.stdout).toBe(0)
  expect(lines(result.stdout)[0]!.data.command).toBe(name)
  expect(test.writes).toEqual([])
})

it.each(Object.entries(mutations))("previews %s without invoking a write", async (name, args) => {
  const test = fixture()
  const preview = await test.invoke([name, ...args])
  expect(preview.code, preview.stdout).toBe(4)
  expect(lines(preview.stdout)[0]!.plan.command).toBe(name)
  const dry = await test.invoke([name, ...args, "--dry-run"])
  expect(dry.code, dry.stdout).toBe(0)
  expect(lines(dry.stdout)[0]!.data.dryRun).toBe(true)
  expect(test.writes).toEqual([])
})

it.each(["remove-workout", "remove-annotation", "switch-workout", "replace-workout"])(
  "applies and verifies %s once",
  async (name) => {
    const test = fixture()
    const preview = await test.invoke([
      name,
      ...mutations[name]!,
      "--session-file",
      "/fake/selected",
    ])
    const result = await test.invoke(lines(preview.stdout)[0]!.confirmation.confirmArgs)
    expect(result.code, result.stdout).toBe(0)
    expect(test.writes).toHaveLength(1)
    expect(lines(result.stdout)[0]!.next[0].args).toContain("/fake/selected")
  },
)

it.each(["add-workout", "copy-workout", "add-event", "add-annotation"])(
  "does not retry %s after a lost write response",
  async (name) => {
    const test = fixture()
    const result = await test.invoke([name, ...mutations[name]!, "--yes"])
    expect(lines(result.stdout)[0]!.error.code).toBe("cannot_write")
    expect(lines(result.stdout)[0]!.error.transient).toBe(false)
    expect(test.writes).toHaveLength(1)
  },
)

it("rejects a changed account and activity before any write", async () => {
  const test = fixture()
  const preview = await test.invoke(["remove-workout", ...mutations["remove-workout"]!])
  test.changeAccount()
  test.changeRow()
  const result = await test.invoke(lines(preview.stdout)[0]!.confirmation.confirmArgs)
  expect(lines(result.stdout)[0]!.error.code).toBe("stale_confirmation")
  expect(test.writes).toEqual([])
})

it("rechecks the confirmed preview inside the write service", async () => {
  const test = fixture()
  const flags = { id: "planned-1", tz: "UTC", "session-file": "/fake/session" }
  const signal = new AbortController().signal
  const raw = (await test.execute("remove-workout", flags, "plan", 0, signal)) as Record<
    string,
    unknown
  >
  delete raw.generatedAt
  test.changeRow()
  await expect(
    test.execute("remove-workout", flags, "apply", 0, signal, raw),
  ).rejects.toMatchObject({ code: "stale_confirmation" })
  expect(test.writes).toEqual([])
})

it.each(Object.entries(mutations))(
  "keeps the %s confirmation flow usable in NDJSON",
  async (name, args) => {
    const test = fixture()
    const result = await test.invoke(
      [name, ...args, "--session-file", "/fake/selected", "--dry-run"],
      "ndjson",
    )
    const dry = lines(result.stdout, "ndjson").at(-1)!
    expect(dry.event).toBe("summary")
    expect(dry.guides).toContain("calendar-changes")
    await Promise.all(
      dry.guides.map(async (topic: string) => {
        const brief = lines((await test.invoke(["guide", "get", topic, "--brief"])).stdout)[0]!
        expect(brief.data.brief).toBeTruthy()
        expect(brief.data.content).toBeUndefined()
      }),
    )
    const preview = lines((await test.invoke(dry.next[0].args, "ndjson")).stdout, "ndjson").at(-1)!
    expect(preview.event).toBe("confirmation_required")
    expect(preview.next[0].args).toContain("ndjson")
    expect(test.writes).toEqual([])
    const applied = await test.invoke(preview.next[0].args, "ndjson")
    const events = lines(applied.stdout, "ndjson")
    expect(
      events.filter((event) => ["summary", "confirmation_required", "error"].includes(event.event)),
    ).toHaveLength(1)
    expect(test.writes).toHaveLength(1)
    expect(events.at(-1)!.next.length).toBeGreaterThan(0)
  },
)

it.each([
  ["--dry-run", "--yes"],
  ["--dry-run", "--confirm", "fake"],
  ["--yes", "--confirm", "fake"],
])("rejects conflicting controls %j before any account access", async (...controls) => {
  const test = fixture()
  const result = await test.invoke(["remove-workout", ...mutations["remove-workout"]!, ...controls])
  expect(result.code).toBe(64)
  expect(lines(result.stdout)[0]!.error.code).toBe("invalid_usage")
  expect(test.reads).toEqual([])
  expect(test.writes).toEqual([])
})

it("routes domain input errors to that command's contract", async () => {
  const test = fixture()
  const result = await test.invoke([
    "add-annotation",
    "--type",
    "unknown-type",
    "--date",
    "2030-02-01",
  ])
  const error = lines(result.stdout)[0]!
  expect(error.error.code).toBe("invalid_usage")
  expect(error.error.fix).not.toContain("<command>")
  const description = lines((await test.invoke(error.next[0].args)).stdout)[0]!
  expect(description.data.commands.map((command: any) => command.name)).toEqual(["add-annotation"])
  expect(test.writes).toEqual([])
})

it("routes missing authentication to the offline session guide", async () => {
  const test = fixture()
  test.api.loadSession = async () => false
  const error = lines(
    (await test.invoke(["future", "--session-file", "/fake/selected"])).stdout,
  )[0]!
  expect(error.error.code).toBe("auth_failure")
  const guide = lines((await test.invoke(error.next[0].args)).stdout)[0]!
  expect(guide.data.topic).toBe("session-and-ids")
  expect(guide.data.content).toContain("--password-stdin")
  expect(test.writes).toEqual([])
})
