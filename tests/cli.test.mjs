import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { contracts } from "../src/commands/index.ts"

const cwd = path.resolve(import.meta.dirname, "..")
function runCli(args) {
  return spawnSync(process.execPath, ["dist/bin.cjs", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      CI: "1",
      TR_SESSION_FILE: "/nonexistent-trainerroad-fixture/session.json",
    },
  })
}

await test("machine help derives the complete roster from contracts", () => {
  const result = runCli(["--help", "--json"])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.schemaVersion, "1")
  assert.equal(payload.status, "ok")
  assert.deepEqual(
    payload.data.commands.map((command) => command.name).toSorted(),
    contracts.map((command) => command.name).toSorted(),
  )
  assert.ok(payload.data.commands.some((command) => command.name === "workout-image"))
  assert.ok(payload.data.commands.some((command) => command.name === "add-annotation"))
  assert.equal(result.stderr, "")
})

await test("command metadata exposes required flags and confirmation controls", () => {
  const result = runCli(["describe", "--command", "move-workout", "--json"])
  assert.equal(result.status, 0)
  const command = JSON.parse(result.stdout).data.commands[0]
  assert.equal(command.capabilities.supportsDryRun, true)
  assert.deepEqual(
    command.params.filter((param) => param.required).map((param) => param.cliName),
    ["--id", "--to"],
  )
  assert.ok(command.params.some((param) => param.cliName === "--confirm"))
})

await test("missing required flags fail before any account lookup", () => {
  const result = runCli(["add-workout", "--workout-id", "18128", "--json"])
  assert.equal(result.status, 64)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.error.code, "invalid_usage")
  assert.match(payload.error.message, /date/)
  assert.ok(payload.error.fix)
})

await test("the removed password flag is rejected without echoing its value", () => {
  const result = runCli([
    "login",
    "--username",
    "fixture",
    "--password",
    "FIXTURE_SECRET",
    "--yes",
    "--json",
  ])
  assert.equal(result.status, 64)
  assert.equal(JSON.parse(result.stdout).error.code, "invalid_usage")
  assert.doesNotMatch(result.stdout + result.stderr, /FIXTURE_SECRET/)
})

await test("schema and NDJSON version are available offline", () => {
  const schema = runCli(["schema", "--json"])
  assert.equal(schema.status, 0)
  assert.equal(JSON.parse(schema.stdout).status, "ok")
  const version = runCli(["--version", "--format", "ndjson"])
  assert.equal(version.status, 0)
  const summary = JSON.parse(version.stdout)
  assert.equal(summary.event, "summary")
  assert.deepEqual(summary.next, [])
  assert.deepEqual(summary.guides, [])
})
