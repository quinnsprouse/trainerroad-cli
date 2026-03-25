import test from "node:test";
import assert from "node:assert/strict";
import { commandMoveWorkout, commandReplaceWorkout, commandSwitchWorkout } from "../src/commands/workout-mutations.mjs";
import { commandAddWorkout, commandCopyWorkout } from "../src/commands/workout-tools.mjs";

const MEMBER_INFO = { memberId: 999, username: "athlete" };

function dateParts(dateOnly) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return { year, month, day };
}

function plannedActivity({
  id,
  date,
  workoutId,
  workoutName = "Workout",
  isOutside = false,
  duration = 60,
  tss = 50,
}) {
  return {
    id,
    date: dateParts(date),
    workout: {
      id: workoutId,
      name: workoutName,
      isOutside,
      duration,
      tss,
    },
    tss,
  };
}

function workout(workoutId, workoutName = "Workout", isOutside = false) {
  return {
    id: workoutId,
    name: workoutName,
    workoutName,
    isOutside,
    duration: 60,
    tss: 50,
    progression: { text: "Endurance", id: 1 },
    profileId: 2,
    profileName: "Sustained Power",
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
        const normalized = String(value).trim().toLowerCase();
        if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
        if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
        return fallback;
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

test("move-workout dry-run previews without mutating", async () => {
  let moveCalls = 0;
  const client = {
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getPlannedActivity() {
      return plannedActivity({ id: "p1", date: "2026-03-12", workoutId: 10, workoutName: "Baxter" });
    },
    async movePlannedActivity() {
      moveCalls += 1;
      return {};
    },
  };
  const { deps, outputs } = createDeps(client);

  await commandMoveWorkout({ id: "p1", to: "2026-03-13", "dry-run": true, json: true }, deps);

  assert.equal(moveCalls, 0);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].dryRun, true);
  assert.equal(outputs[0].noop, false);
  assert.equal(outputs[0].before.date, "2026-03-12");
  assert.equal(outputs[0].after.date, "2026-03-13");
});

test("move-workout returns a no-op when already on target date", async () => {
  let moveCalls = 0;
  const client = {
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getPlannedActivity() {
      return plannedActivity({ id: "p1", date: "2026-03-13", workoutId: 10, workoutName: "Baxter" });
    },
    async movePlannedActivity() {
      moveCalls += 1;
      return {};
    },
  };
  const { deps, outputs } = createDeps(client);

  await commandMoveWorkout({ id: "p1", to: "2026-03-13", json: true }, deps);

  assert.equal(moveCalls, 0);
  assert.equal(outputs[0].noop, true);
});

test("replace-workout returns a no-op when the alternate is already applied", async () => {
  let replaceCalls = 0;
  const client = {
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getPlannedActivity() {
      return plannedActivity({ id: "p1", date: "2026-03-13", workoutId: 18128, workoutName: "Baxter" });
    },
    async replacePlannedActivityWithAlternate() {
      replaceCalls += 1;
      return {};
    },
  };
  const { deps, outputs } = createDeps(client);

  await commandReplaceWorkout({ id: "p1", "alternate-id": "18128", json: true }, deps);

  assert.equal(replaceCalls, 0);
  assert.equal(outputs[0].noop, true);
});

test("switch-workout returns a no-op when already in the requested mode", async () => {
  let switchCalls = 0;
  const client = {
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getPlannedActivity() {
      return plannedActivity({
        id: "p1",
        date: "2026-03-13",
        workoutId: 18128,
        workoutName: "Baxter",
        isOutside: true,
      });
    },
    async switchPlannedActivityMode() {
      switchCalls += 1;
      return {};
    },
  };
  const { deps, outputs } = createDeps(client);

  await commandSwitchWorkout({ id: "p1", mode: "outside", json: true }, deps);

  assert.equal(switchCalls, 0);
  assert.equal(outputs[0].noop, true);
});

test("add-workout dry-run warns about matching workouts but does not convert to a no-op", async () => {
  let addCalls = 0;
  const existing = plannedActivity({
    id: "existing",
    date: "2026-03-16",
    workoutId: 18128,
    workoutName: "Baxter",
  });
  const client = {
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getWorkoutsByIds() {
      return [workout(18128, "Baxter")];
    },
    async getTimeline() {
      return { plannedActivities: [existing] };
    },
    async getPlannedActivitiesByIds() {
      return [existing];
    },
    async tryAddWorkoutToCalendar() {
      addCalls += 1;
      return [];
    },
  };
  const { deps, outputs } = createDeps(client);

  await commandAddWorkout(
    { "workout-id": "18128", date: "2026-03-16", "dry-run": true, json: true },
    deps,
  );

  assert.equal(addCalls, 0);
  assert.equal(outputs[0].noop, false);
  assert.equal(outputs[0].existingMatches.length, 1);
  assert.match(outputs[0].warnings[0], /Found 1 matching workout/);
});

test("copy-workout dry-run warns about matching workouts but does not convert to a no-op", async () => {
  let copyCalls = 0;
  const source = plannedActivity({
    id: "source",
    date: "2026-03-15",
    workoutId: 18128,
    workoutName: "Baxter",
  });
  const existing = plannedActivity({
    id: "existing",
    date: "2026-03-16",
    workoutId: 18128,
    workoutName: "Baxter",
  });
  const client = {
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getPlannedActivity() {
      return source;
    },
    async getTimeline() {
      return { plannedActivities: [existing] };
    },
    async getPlannedActivitiesByIds() {
      return [existing];
    },
    async copyPlannedActivity() {
      copyCalls += 1;
      return {};
    },
  };
  const { deps, outputs } = createDeps(client);

  await commandCopyWorkout({ id: "source", date: "2026-03-16", "dry-run": true, json: true }, deps);

  assert.equal(copyCalls, 0);
  assert.equal(outputs[0].noop, false);
  assert.equal(outputs[0].existingMatches.length, 1);
  assert.match(outputs[0].warnings[0], /Found 1 matching workout/);
});

test("add-workout still performs the mutation when matching workouts already exist", async () => {
  let addCalls = 0;
  let phase = "before";
  const existing = plannedActivity({
    id: "existing",
    date: "2026-03-16",
    workoutId: 18128,
    workoutName: "Baxter",
  });
  const created = plannedActivity({
    id: "created",
    date: "2026-03-16",
    workoutId: 18128,
    workoutName: "Baxter",
  });
  const client = {
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getWorkoutsByIds() {
      return [workout(18128, "Baxter")];
    },
    async getTimeline() {
      return {
        plannedActivities: phase === "before" ? [existing] : [existing, created],
      };
    },
    async getPlannedActivitiesByIds(memberId, username, ids) {
      return [existing, created].filter((item) => ids.includes(item.id));
    },
    async tryAddWorkoutToCalendar() {
      addCalls += 1;
      phase = "after";
      return [{ endpoint: "primary", ok: true, status: 200 }];
    },
  };
  const { deps, outputs } = createDeps(client);

  await commandAddWorkout({ "workout-id": "18128", date: "2026-03-16", json: true }, deps);

  assert.equal(addCalls, 1);
  assert.equal(outputs[0].created.plannedActivityId, "created");
});

test("copy-workout still performs the mutation when matching workouts already exist", async () => {
  let copyCalls = 0;
  let phase = "before";
  const source = plannedActivity({
    id: "source",
    date: "2026-03-15",
    workoutId: 18128,
    workoutName: "Baxter",
  });
  const existing = plannedActivity({
    id: "existing",
    date: "2026-03-16",
    workoutId: 18128,
    workoutName: "Baxter",
  });
  const created = plannedActivity({
    id: "created",
    date: "2026-03-16",
    workoutId: 18128,
    workoutName: "Baxter",
  });
  const client = {
    async getMemberInfo() {
      return MEMBER_INFO;
    },
    async getPlannedActivity() {
      return source;
    },
    async getTimeline() {
      return {
        plannedActivities: phase === "before" ? [existing] : [existing, created],
      };
    },
    async getPlannedActivitiesByIds(memberId, username, ids) {
      return [existing, created].filter((item) => ids.includes(item.id));
    },
    async copyPlannedActivity() {
      copyCalls += 1;
      phase = "after";
      return { ok: true };
    },
  };
  const { deps, outputs } = createDeps(client);

  await commandCopyWorkout({ id: "source", date: "2026-03-16", json: true }, deps);

  assert.equal(copyCalls, 1);
  assert.equal(outputs[0].created.plannedActivityId, "created");
});
