import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const cwd = path.resolve(import.meta.dirname, "..");

function runCli(args) {
  return spawnSync("node", ["src/cli.mjs", ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("global help points to command-specific help", () => {
  const result = runCli(["help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Use "trainerroad-cli <command> --help" for command-specific options and examples\./);
  assert.match(result.stdout, /trainerroad-cli discover --level 1/);
});

test("command help includes options and examples", () => {
  const result = runCli(["help", "move-workout"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Options:/);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /Examples:/);
  assert.match(result.stdout, /trainerroad-cli move-workout --id 123456 --to 2026-03-13 --dry-run/);
});

test("json help exposes required flags and dry-run support", () => {
  const result = runCli(["help", "move-workout", "--json"]);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "move-workout");
  assert.equal(payload.supportsDryRun, true);
  assert.deepEqual(payload.requiredFlags, ["id", "to"]);
});

test("missing required flags fail fast with actionable usage", () => {
  const result = runCli(["add-workout", "--workout-id", "18128"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required flag --date/);
  assert.match(result.stderr, /Usage:/);
  assert.match(result.stderr, /Examples:/);
  assert.match(result.stderr, /trainerroad-cli add-workout --workout-id 18128 --date 2026-03-16 --dry-run/);
});
