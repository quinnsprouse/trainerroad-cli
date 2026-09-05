import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { contracts } from "../src/commands/index.ts"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const scratch = mkdtempSync(join(tmpdir(), "trainerroad-pack-"))
try {
  const [pack] = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        scratch,
        "--cache",
        join(scratch, "npm-cache"),
      ],
      { cwd: root, encoding: "utf8" },
    ),
  )
  const files = pack.files.map((file) => file.path)
  assert.ok(files.includes("dist/bin.cjs"))
  assert.ok(files.includes("bin/trainerroad-cli.mjs"))
  assert.ok(files.includes("skills/trainerroad-cli/SKILL.md"))
  assert.ok(files.includes("docs/workflow-coverage.md"))
  assert.ok(
    !files.some((file) => /^(src|test|tests|trial|node_modules|\.trainerroad)\//.test(file)),
  )
  execFileSync("tar", ["-xzf", join(scratch, pack.filename), "-C", scratch])
  const output = execFileSync(
    process.execPath,
    [join(scratch, "package/bin/trainerroad-cli.mjs"), "describe", "--json"],
    {
      cwd: scratch,
      encoding: "utf8",
      timeout: 10000,
      env: {
        PATH: process.env.PATH,
        CI: "1",
        TR_SESSION_FILE: join(scratch, "missing-session.json"),
      },
    },
  )
  const envelope = JSON.parse(output)
  assert.equal(envelope.status, "ok")
  assert.deepEqual(
    envelope.data.commands.map((command) => command.name).toSorted(),
    contracts.map((command) => command.name).toSorted(),
  )
  for (const topic of envelope.data.guideTopics) {
    const guide = JSON.parse(
      execFileSync(
        process.execPath,
        [join(scratch, "package/bin/trainerroad-cli.mjs"), "guide", "get", topic.topic, "--json"],
        {
          cwd: scratch,
          encoding: "utf8",
          timeout: 10000,
          env: {
            PATH: process.env.PATH,
            CI: "1",
            TR_SESSION_FILE: join(scratch, "missing-session.json"),
          },
        },
      ),
    )
    assert.equal(guide.status, "ok")
    assert.equal(guide.data.topic, topic.topic)
    assert.ok(guide.data.content.length > 0)
  }
  console.log(
    `Pack smoke passed: isolated binary describes all ${contracts.length} commands and serves every guide.`,
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
