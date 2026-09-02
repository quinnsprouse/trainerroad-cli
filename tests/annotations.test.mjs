import test from "node:test";
import assert from "node:assert/strict";
import {
  commandAddAnnotation,
  commandAnnotationDetails,
  commandRemoveAnnotation,
} from "../src/commands/annotation-mutations.mjs";
import { HttpError } from "../src/trainerroad-client.mjs";

const MEMBER_INFO = { memberId: 211199, username: "quinnsprouse" };

function detail(overrides = {}) {
  return {
    id: "ann-1",
    date: { year: 2026, month: 9, day: 21 },
    timeOfDay: null,
    duration: 172800,
    title: "Head cold",
    text: "resting",
    styleIndex: 2,
    typeId: 2,
    colorId: 2,
    colorHex: "#c7251a",
    plannedActivityGroupId: null,
    ...overrides,
  };
}

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
      toBoolean(value, fallback = false) {
        if (value == null) return fallback;
        if (typeof value === "boolean") return value;
        return ["1", "true", "yes"].includes(String(value).toLowerCase());
      },
      requirePositiveInteger(value, fallback) {
        if (value == null) return fallback;
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
      },
      normalizeDateOnlyInput(value, fallback) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : fallback;
      },
      async writeOutput(payload) {
        outputs.push(payload);
      },
    },
  };
}

function createClient({ existing = [], detailById = {} } = {}) {
  const calls = [];
  const annotations = [...existing];
  const details = { ...detailById };
  return {
    calls,
    annotations,
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getTimeline() {
      return { annotations: annotations.map((id) => ({ id })) };
    },
    async getAnnotation(id) {
      calls.push(["getAnnotation", id]);
      if (!details[id]) throw new HttpError("Request failed: 404", { status: 404 });
      return details[id];
    },
    async createAnnotation(body, username) {
      calls.push(["createAnnotation", body, username]);
      const id = `new-${annotations.length + 1}`;
      annotations.push(id);
      details[id] = detail({ id, ...body, date: { year: 2026, month: 9, day: 21 } });
      return { ok: true, status: 204 };
    },
    async deleteAnnotation(id) {
      calls.push(["deleteAnnotation", id]);
      const index = annotations.indexOf(id);
      if (index >= 0) annotations.splice(index, 1);
      delete details[id];
      return { ok: true, status: 204 };
    },
  };
}

test("add-annotation posts a whole-day duration and reports the created annotation", async () => {
  const client = createClient({ existing: ["old-1"] });
  const { deps, outputs } = createDeps(client);

  await commandAddAnnotation(
    { type: "illness", date: "2026-09-21", "end-date": "2026-09-22", title: "Head cold", notes: "resting", json: true },
    deps,
  );

  const create = client.calls.find(([name]) => name === "createAnnotation");
  assert.deepEqual(create[1], {
    date: "2026-09-21",
    timeOfDay: null,
    duration: 172800,
    title: "Head cold",
    text: "resting",
    typeId: 2,
    colorId: 2,
  });
  assert.equal(create[2], "quinnsprouse");
  const payload = outputs[0];
  assert.equal(payload.dryRun, false);
  assert.equal(payload.annotation.id, "new-2");
  assert.equal(payload.annotation.typeLabel, "illness");
  assert.equal(payload.annotation.durationDays, 2);
  assert.equal(payload.annotation.endDateOnly, "2026-09-22");
  assert.match(payload.message, /Added illness "Head cold" on 2026-09-21 through 2026-09-22/);
  assert.match(payload.adaptiveTraining, /adapt/);
});

test("add-annotation --days sets the duration and defaults the title to the type", async () => {
  const client = createClient();
  const { deps, outputs } = createDeps(client);

  await commandAddAnnotation({ type: "time-off", date: "2026-09-21", days: "3", json: true }, deps);

  const body = client.calls.find(([name]) => name === "createAnnotation")[1];
  assert.equal(body.duration, 3 * 86400);
  assert.equal(body.typeId, 4);
  assert.equal(body.title, "Time Off");
  assert.equal(outputs[0].query.endDateOnly, "2026-09-23");
});

test("add-annotation accepts aliases and numeric type ids", async () => {
  const client = createClient();
  const { deps } = createDeps(client);

  await commandAddAnnotation({ type: "sick", date: "2026-09-21", json: true }, deps);
  await commandAddAnnotation({ type: "3", date: "2026-09-21", json: true }, deps);

  const typeIds = client.calls.filter(([name]) => name === "createAnnotation").map(([, body]) => body.typeId);
  assert.deepEqual(typeIds, [2, 3]);
});

test("add-annotation rejects unknown types and end dates before the start", async () => {
  const client = createClient();
  const { deps } = createDeps(client);

  await assert.rejects(
    () => commandAddAnnotation({ type: "vacation", date: "2026-09-21", json: true }, deps),
    /Invalid --type "vacation"/,
  );
  await assert.rejects(
    () => commandAddAnnotation({ type: "note", date: "2026-09-21", "end-date": "2026-09-20", json: true }, deps),
    /is before --date/,
  );
  assert.equal(client.calls.length, 0);
});

test("add-annotation --dry-run previews without calling the API", async () => {
  const client = createClient();
  const { deps, outputs } = createDeps(client);

  await commandAddAnnotation({ type: "note", date: "2026-09-21", title: "New saddle", "dry-run": true, json: true }, deps);

  assert.equal(client.calls.length, 0);
  assert.equal(outputs[0].dryRun, true);
  assert.equal(outputs[0].annotation, null);
  assert.match(outputs[0].message, /Would add note "New saddle" on 2026-09-21\./);
});

test("annotation-details returns the compact detail shape", async () => {
  const client = createClient({ existing: ["ann-1"], detailById: { "ann-1": detail() } });
  const { deps, outputs } = createDeps(client);

  await commandAnnotationDetails({ id: "ann-1", json: true }, deps);

  assert.deepEqual(outputs[0].annotation, {
    id: "ann-1",
    type: "illness",
    typeId: 2,
    typeLabel: "illness",
    title: "Head cold",
    text: "resting",
    date: { year: 2026, month: 9, day: 21 },
    dateOnly: "2026-09-21",
    endDateOnly: "2026-09-22",
    durationSeconds: 172800,
    durationDays: 2,
    timeOfDay: null,
    colorId: 2,
    colorHex: "#c7251a",
    plannedActivityGroupId: null,
  });
});

test("remove-annotation deletes an existing annotation and reports what it removed", async () => {
  const client = createClient({ existing: ["ann-1"], detailById: { "ann-1": detail() } });
  const { deps, outputs } = createDeps(client);

  await commandRemoveAnnotation({ id: "ann-1", json: true }, deps);

  assert.deepEqual(client.calls, [["getAnnotation", "ann-1"], ["deleteAnnotation", "ann-1"]]);
  assert.equal(outputs[0].noop, false);
  assert.equal(outputs[0].before.title, "Head cold");
  assert.match(outputs[0].message, /Removed illness "Head cold" on 2026-09-21/);
});

test("remove-annotation is a no-op when the annotation is already gone", async () => {
  const client = createClient();
  const { deps, outputs } = createDeps(client);

  await commandRemoveAnnotation({ id: "missing", json: true }, deps);

  assert.deepEqual(client.calls, [["getAnnotation", "missing"]]);
  assert.equal(outputs[0].noop, true);
  assert.equal(outputs[0].before, null);
});

test("remove-annotation --dry-run leaves the annotation in place", async () => {
  const client = createClient({ existing: ["ann-1"], detailById: { "ann-1": detail() } });
  const { deps, outputs } = createDeps(client);

  await commandRemoveAnnotation({ id: "ann-1", "dry-run": true, json: true }, deps);

  assert.deepEqual(client.calls, [["getAnnotation", "ann-1"]]);
  assert.equal(outputs[0].dryRun, true);
  assert.equal(client.annotations.length, 1);
});
