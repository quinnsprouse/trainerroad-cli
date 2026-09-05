import test from "node:test"
import assert from "node:assert/strict"
import { commandRemoveWorkout } from "../src/operations/workout-mutations.mjs"
import { HttpError } from "../src/trainerroad-client.mjs"

const MEMBER_INFO = { memberId: 211199, username: "quinnsprouse" }

function plannedWorkout() {
  return {
    id: "p1",
    date: { year: 2027, month: 1, day: 15 },
    workout: { id: 2773112, name: "Bess", isOutside: false, duration: 60, tss: 32 },
    tss: 32,
    canMove: true,
    recommendationReason: 27,
  }
}

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
      async writeOutput(payload) {
        outputs.push(payload)
      },
    },
  }
}

function createClient({ existing = {} } = {}) {
  const calls = []
  const records = { ...existing }
  return {
    calls,
    records,
    async getMemberInfo() {
      return MEMBER_INFO
    },
    async getPlannedActivity(id) {
      calls.push(["getPlannedActivity", id])
      if (!records[id]) throw new HttpError("Request failed: 404", { status: 404 })
      return records[id]
    },
    async deletePlannedActivity(id, username) {
      calls.push(["deletePlannedActivity", id, username])
      delete records[id]
      return { ok: true, status: 204 }
    },
  }
}

await test("remove-workout deletes the planned activity and reports what it removed", async () => {
  const client = createClient({ existing: { p1: plannedWorkout() } })
  const { deps, outputs } = createDeps(client)

  outputs.push(await commandRemoveWorkout({ id: "p1", json: true }, deps))

  assert.deepEqual(client.calls, [
    ["getPlannedActivity", "p1"],
    ["deletePlannedActivity", "p1", "quinnsprouse"],
  ])
  const payload = outputs[0]
  assert.equal(payload.noop, false)
  assert.equal(payload.before.workoutName, "Bess")
  assert.equal(payload.before.date, "2027-01-15")
  assert.match(payload.message, /Removed Bess from 2027-01-15/)
  assert.match(payload.adaptiveTraining, /Adaptive Training/)
  assert.equal(Object.keys(client.records).length, 0)
})

await test("remove-workout --dry-run previews without deleting", async () => {
  const client = createClient({ existing: { p1: plannedWorkout() } })
  const { deps, outputs } = createDeps(client)

  outputs.push(await commandRemoveWorkout({ id: "p1", "dry-run": true, json: true }, deps))

  assert.deepEqual(client.calls, [["getPlannedActivity", "p1"]])
  assert.equal(outputs[0].dryRun, true)
  assert.match(outputs[0].message, /Would remove Bess from 2027-01-15/)
  assert.ok(client.records.p1)
})

await test("remove-workout is a no-op when the planned activity is already gone", async () => {
  const client = createClient()
  const { deps, outputs } = createDeps(client)

  outputs.push(await commandRemoveWorkout({ id: "missing", json: true }, deps))

  assert.deepEqual(client.calls, [["getPlannedActivity", "missing"]])
  assert.equal(outputs[0].noop, true)
  assert.equal(outputs[0].before, null)
})

await test("remove-workout surfaces non-404 lookup failures", async () => {
  const client = createClient()
  client.getPlannedActivity = async () => {
    throw new HttpError("Request failed: 500", { status: 500 })
  }
  const { deps, outputs } = createDeps(client)

  await assert.rejects(() => commandRemoveWorkout({ id: "p1", json: true }, deps), /500/)
  assert.equal(outputs.length, 0)
})
