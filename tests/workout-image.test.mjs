import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commandWorkoutImage } from "../src/commands/workout-image.mjs";

const MEMBER_INFO = { memberId: 211199, username: "quinnsprouse" };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="10" height="5" fill="#29a8e0"/></svg>';
const CHART_URL = "https://cdn.example.test/workouts/1592808/chart.svg";

function createDeps(client) {
  const outputs = [];
  return {
    outputs,
    deps: {
      withClient: async () => client,
      isJsonMode: () => true,
      requireFlag(command, flags, name) {
        const value = flags[name];
        if (value === undefined || value === null || value === "") {
          throw new Error(`Missing required flag --${name} for ${command}`);
        }
        return value;
      },
      requirePositiveInteger(value, fallback) {
        if (value == null) return fallback;
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
      },
      async writeOutput(payload) {
        outputs.push(payload);
      },
    },
  };
}

function createClient({ picUrl = CHART_URL } = {}) {
  const fetched = [];
  return {
    fetched,
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getWorkoutSummary(workoutId) {
      return { summary: { id: workoutId, workoutName: "Fishers", duration: 60, tss: 74, intensityFactor: 0.86, picUrl } };
    },
    async fetchText(url) {
      fetched.push(url);
      return SVG;
    },
  };
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "trcli-image-"));
}

test("workout-image writes the chart SVG verbatim when the file extension is .svg", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "fishers.svg");
  const client = createClient();
  const { deps, outputs } = createDeps(client);

  await commandWorkoutImage({ id: "1592808", file, json: true }, deps);

  assert.deepEqual(client.fetched, [CHART_URL]);
  assert.equal(await fs.readFile(file, "utf8"), SVG);
  const payload = outputs[0];
  assert.equal(payload.query.format, "svg");
  assert.equal(payload.chartUrl, CHART_URL);
  assert.equal(payload.workout.workoutName, "Fishers");
  assert.equal(payload.file, file);
  assert.equal(payload.size, null);
});

test("workout-image defaults to PNG and reports the rendered size", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "fishers.png");
  const { deps, outputs } = createDeps(createClient());

  await commandWorkoutImage({ id: "1592808", file, width: "100", json: true }, deps);

  const bytes = await fs.readFile(file);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(outputs[0].query.format, "png");
  assert.deepEqual(outputs[0].size, { width: 100, height: 50 });
});

test("workout-image fails clearly when the workout has no chart", async () => {
  const { deps } = createDeps(createClient({ picUrl: null }));
  await assert.rejects(() => commandWorkoutImage({ id: "42", json: true }, deps), /no chart image/);
});

test("workout-image rejects unknown formats and non-numeric ids", async () => {
  const { deps } = createDeps(createClient());
  await assert.rejects(() => commandWorkoutImage({ id: "abc", json: true }, deps), /Expected a numeric workout ID/);
  await assert.rejects(() => commandWorkoutImage({ id: "1", format: "gif", json: true }, deps), /Expected png or svg/);
});
