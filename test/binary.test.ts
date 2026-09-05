import { execa } from "execa"
import { describe, expect, it } from "vitest"
import { CLI_NAME } from "../src/meta.ts"
import { contracts } from "../src/commands/index.ts"
import { surfaceOf } from "../src/contract/surface.ts"
import { validateInvocation } from "../src/contract/invocation.ts"
import { lines } from "./harness.ts"

const surfaces = contracts.map(surfaceOf)

describe.each(["src/bin.ts", "dist/bin.cjs"])("offline executable %s", (entry) => {
  const run = (args: ReadonlyArray<string>) =>
    execa(process.execPath, [entry, ...args], {
      reject: false,
      extendEnv: false,
      env: { CI: "1", TR_SESSION_FILE: "/nonexistent-trainerroad-fixture/session.json" },
      timeout: 10_000,
    })

  it("describes all commands from the main roster", async () => {
    const result = await run(["describe", "--json"])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")
    const output = lines(result.stdout)[0]!
    expect(output.status).toBe("ok")
    expect(result.stdout).toContain("move-workout")
    expect(result.stdout).not.toContain("task create")
  })

  it("returns version and guide content without authentication", async () => {
    const version = await run(["--version", "--json"])
    const guide = await run(["guide", "get", "calendar-changes", "--json"])
    expect(version.exitCode).toBe(0)
    expect(lines(version.stdout)[0]!.guides).toEqual([])
    expect(guide.exitCode).toBe(0)
    expect(lines(guide.stdout)[0]!.data.content).toContain("atomic conditional update")
  })

  it("returns a structured error for a missing session", async () => {
    const result = await run(["whoami"])
    expect(result.exitCode).toBe(77)
    expect(lines(result.stdout)[0]!.error.code).toBe("auth_failure")
  })

  it("rejects bad input before session access", async () => {
    const result = await run([
      "move-workout",
      "--id",
      "planned-123",
      "--to",
      "2026-02-30",
      "--yes",
      "--json",
    ])
    expect(result.exitCode).toBe(64)
    expect(lines(result.stdout)[0]!.error.code).toBe("invalid_usage")
  })

  it("provides machine help without a login", async () => {
    const result = await run(["move-workout", "--help", "--json"])
    expect(result.exitCode).toBe(0)
    expect(lines(result.stdout)[0]!.status).toBe("ok")
    expect(result.stdout).toContain("supportsDryRun")
  })

  it.each([
    ["unknown-command"],
    ["login", "--password=FIXTURE_SECRET"],
    ["login", "--password=FIXTURE_SECRET", "--help"],
    ["whoami", "--helpful", "--help"],
    ["whoami", "--log-level", "bogus", "--help"],
    ["--wizard=false"],
    ["--completions", "bash"],
    ["--help=maybe"],
    ["--format", "xml"],
    ["guide", "list", "--fields", "missing"],
  ])("returns an actionable machine error for %j", async (...args) => {
    const result = await run([...args, "--json"])
    expect(result.exitCode).toBe(64)
    const error = lines(result.stdout)[0]!
    expect(error.error.code).toBe("invalid_usage")
    expect(error.error.fix.length).toBeGreaterThan(0)
    expect(result.stdout + result.stderr).not.toContain("FIXTURE_SECRET")
    expect(error.next.length).toBeGreaterThan(0)
    const recovery = await run(error.next[0].args)
    expect(recovery.exitCode).toBe(0)
    expect(lines(recovery.stdout)[0]!.status).toBe("ok")
  })

  it("renders the same offline guide as text, JSON, and NDJSON", async () => {
    const json = await run(["guide", "get", "session-and-ids", "--json"])
    const text = await run(["guide", "get", "session-and-ids", "--format", "text"])
    const stream = await run(["guide", "get", "session-and-ids", "--format", "ndjson"])
    const content = lines(json.stdout)[0]!.data.content
    expect(text.stdout).toContain(content.trim())
    expect(lines(stream.stdout, "ndjson")[0]!.data.content).toBe(content)
    expect([json.exitCode, text.exitCode, stream.exitCode]).toEqual([0, 0, 0])
  })
})

it("keeps all declared examples executable for this command roster", () => {
  for (const contract of contracts) {
    for (const example of contract.examples) {
      const [bin, ...args] = example.command.split(" ")
      expect(bin).toBe(CLI_NAME)
      expect(validateInvocation(surfaces, args), example.command).toBeUndefined()
    }
  }
})
