import test from "node:test"
import assert from "node:assert/strict"
import { commandAddEvent } from "../src/operations/event-mutations.mjs"

const MEMBER_INFO = { memberId: 211199, username: "quinnsprouse" }

function createDeps(client) {
  const outputs = []
  return {
    outputs,
    deps: {
      withClient: async () => client,
      isJsonMode: () => true,
      requireFlag(command, flags, name) {
        const value = flags[name]
        if (value === undefined || value === null || value === "") {
          throw new Error(`Missing required flag --${name} for ${command}`)
        }
        return value
      },
      toBoolean(value, fallback = false) {
        if (value == null) return fallback
        if (typeof value === "boolean") return value
        return ["1", "true", "yes"].includes(String(value).toLowerCase())
      },
      requirePositiveInteger(value, fallback) {
        if (value == null) return fallback
        const parsed = Number(value)
        return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
      },
      requireNumber(value, fallback) {
        if (value == null) return fallback
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : fallback
      },
      normalizeDateOnlyInput(value, fallback) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : fallback
      },
      async writeOutput(payload) {
        outputs.push(payload)
      },
    },
  }
}

function createClient() {
  const calls = []
  const events = [{ id: "old-1", name: "Black Fork", date: { year: 2026, month: 5, day: 2 } }]
  return {
    calls,
    events,
    async getMemberInfo() {
      return MEMBER_INFO
    },
    async getTimeline() {
      return { events: [...events] }
    },
    async createEvent(body, username) {
      calls.push(["createEvent", body, username])
      const [year, month, day] = body.date.split("-").map(Number)
      events.push({
        id: "evt-new",
        name: body.name,
        date: { year, month, day },
        racePriority: body.racePriority,
        activityType: 1,
        activityEventType: body.discipline,
        tss: body.tss ?? 0,
      })
      return { events: [], annotations: [], planToReapply: null, wouldExtendPlan: false }
    },
  }
}

await test("add-event posts a TSS-based event and reports the created record", async () => {
  const client = createClient()
  const { deps, outputs } = createDeps(client)

  outputs.push(
    await commandAddEvent(
      {
        name: "Test Gravel",
        date: "2027-02-01",
        discipline: "gravel",
        priority: "A",
        duration: "300",
        tss: "340",
        notes: "long day",
        json: true,
      },
      deps,
    ),
  )

  const [, body, username] = client.calls[0]
  assert.equal(username, "quinnsprouse")
  assert.deepEqual(body, {
    customPlanId: null,
    name: "Test Gravel",
    date: "2027-02-01",
    time: null,
    discipline: 16,
    duration: 18000,
    notes: "long day",
    racePriority: 3,
    stressEstimateType: 1,
    stressEstimateValue: null,
    tss: 340,
    manuallyCompleted: false,
  })
  const payload = outputs[0]
  assert.equal(payload.dryRun, false)
  assert.equal(payload.event.id, "evt-new")
  assert.equal(payload.event.name, "Test Gravel")
  assert.equal(payload.event.dateOnly, "2027-02-01")
  assert.equal(payload.query.priority, "A")
  assert.match(
    payload.message,
    /Added A event "Test Gravel" on 2027-02-01 \(plannedActivityId=evt-new\)/,
  )
  assert.match(payload.message, /remove-workout --id evt-new/)
})

await test("add-event uses intensity mode when --tss is absent and defaults priority to B", async () => {
  const client = createClient()
  const { deps, outputs } = createDeps(client)

  outputs.push(
    await commandAddEvent(
      {
        name: "Crit",
        date: "2026-10-06",
        discipline: "3",
        duration: "60",
        intensity: "9",
        json: true,
      },
      deps,
    ),
  )

  const body = client.calls[0][1]
  assert.equal(body.discipline, 3)
  assert.equal(body.racePriority, 2)
  assert.equal(body.stressEstimateType, 2)
  assert.equal(body.stressEstimateValue, 9)
  assert.equal(body.tss, null)
  assert.equal(outputs[0].query.discipline, "criterium")
})

await test("add-event validates discipline, priority, duration, and stress inputs", async () => {
  const client = createClient()
  const { deps } = createDeps(client)
  const base = {
    name: "X",
    date: "2026-10-06",
    discipline: "gravel",
    duration: "60",
    tss: "100",
    json: true,
  }

  await assert.rejects(
    () => commandAddEvent({ ...base, discipline: "unicycle" }, deps),
    /Invalid --discipline/,
  )
  await assert.rejects(
    () => commandAddEvent({ ...base, priority: "Z" }, deps),
    /Invalid --priority/,
  )
  await assert.rejects(
    () => commandAddEvent({ ...base, duration: "0" }, deps),
    /--duration <minutes> is required/,
  )
  await assert.rejects(
    () => commandAddEvent({ ...base, tss: undefined }, deps),
    /--tss <number> or --intensity/,
  )
  await assert.rejects(
    () => commandAddEvent({ ...base, date: "next friday" }, deps),
    /Invalid --date/,
  )
  assert.equal(client.calls.length, 0)
})

await test("add-event --dry-run previews without calling the API", async () => {
  const client = createClient()
  const { deps, outputs } = createDeps(client)

  outputs.push(
    await commandAddEvent(
      {
        name: "Test Gravel",
        date: "2027-02-01",
        discipline: "gravel",
        duration: "300",
        tss: "340",
        "dry-run": true,
        json: true,
      },
      deps,
    ),
  )

  assert.equal(client.calls.length, 0)
  assert.equal(outputs[0].dryRun, true)
  assert.equal(outputs[0].event, null)
  assert.match(outputs[0].message, /Would add B event "Test Gravel" \(gravel\) on 2027-02-01\./)
})
