import test from "node:test";
import assert from "node:assert/strict";
import { commandPlan } from "../src/commands/plan.mjs";
import { deriveCurrentPlanFromPlans } from "../src/lib/planning-normalizers.mjs";
import { HttpError, TrainerRoadClient, isHttpStatus } from "../src/trainerroad-client.mjs";

const MEMBER_INFO = { memberId: 211199, username: "quinnsprouse" };
const TODAY = "2026-09-02";

const PLANS = [
  {
    id: 501,
    name: "Old Base Plan",
    discipline: "road",
    volume: "mid",
    start: "2026-01-05T00:00:00",
    end: "2026-03-29T00:00:00",
    isAdHoc: false,
  },
  {
    id: 502,
    name: "Gran Fondo Plan",
    discipline: "road",
    volume: "high",
    start: "2026-07-06T00:00:00",
    end: "2026-11-15T00:00:00",
    isAdHoc: false,
  },
];

const PHASES = [
  { id: 1, customPlanId: 501, type: "base", planName: "Old Base", start: "2026-01-05T00:00:00", end: "2026-03-29T00:00:00" },
  { id: 2, customPlanId: 502, type: "base", planName: "Fondo Base", start: "2026-07-06T00:00:00", end: "2026-08-30T00:00:00" },
  { id: 3, customPlanId: 502, type: "build", planName: "Fondo Build", start: "2026-08-31T00:00:00", end: "2026-10-11T00:00:00" },
  { id: 4, customPlanId: 502, type: "specialty", planName: "Fondo Specialty", start: "2026-10-12T00:00:00", end: "2026-11-15T00:00:00" },
];

function createDeps(client, { todayDateOnly = TODAY } = {}) {
  const outputs = [];
  return {
    outputs,
    deps: {
      todayDateOnly,
      async resolveQueryContext() {
        return { mode: "private", client, memberInfo: MEMBER_INFO, authenticatedMemberInfo: MEMBER_INFO };
      },
      requirePrivateContext() {},
      applyAgentRecordFilters(records) {
        return { records, filterSummary: null };
      },
      toRecordsOnlyPayload(payload) {
        return payload;
      },
      isJsonMode: () => true,
      hasAgentRecordTransforms: () => false,
      async writeOutput(payload) {
        outputs.push(payload);
      },
    },
  };
}

function createClient({ currentPlanError = null, currentPlan = null } = {}) {
  const calls = [];
  return {
    calls,
    async getCurrentCustomPlan(memberId, username) {
      calls.push(["getCurrentCustomPlan", memberId, username]);
      if (currentPlanError) throw currentPlanError;
      return currentPlan;
    },
    async getAllUserPlans(memberId, username) {
      calls.push(["getAllUserPlans", memberId, username]);
      return PLANS;
    },
    async getPlanPhases(memberId, username) {
      calls.push(["getPlanPhases", memberId, username]);
      return PHASES;
    },
  };
}

function notFound(path) {
  return new HttpError(`Request failed: 404 Not Found for ${path} -> `, { status: 404, statusText: "Not Found", path });
}

test("client builds plan-builder URLs from memberId and keeps username in the referer", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url, referer: init.headers.get("referer") });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const client = new TrainerRoadClient({ sessionFile: "/dev/null" });
    await client.getAllUserPlans(MEMBER_INFO.memberId, MEMBER_INFO.username);
    await client.getPlanPhases(MEMBER_INFO.memberId, MEMBER_INFO.username);
    await client.getCurrentCustomPlan(MEMBER_INFO.memberId, MEMBER_INFO.username);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "https://www.trainerroad.com/app/api/plan-builder/211199/all-user-plans",
      "https://www.trainerroad.com/app/api/plan-builder/211199/plan-phases",
      "https://www.trainerroad.com/app/api/plan-builder/current-custom-plan/211199",
    ],
  );
  for (const request of requests) {
    assert.equal(request.referer, "https://www.trainerroad.com/app/career/quinnsprouse");
    assert.doesNotMatch(request.url, /quinnsprouse/);
  }
});

test("client surfaces HTTP status on failed requests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 404, statusText: "Not Found" });
  try {
    const client = new TrainerRoadClient({ sessionFile: "/dev/null" });
    await assert.rejects(
      () => client.getCurrentCustomPlan(211199, "quinnsprouse"),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 404);
        assert.equal(error.path, "/app/api/plan-builder/current-custom-plan/211199");
        assert.match(error.message, /Request failed: 404 Not Found/);
        assert.ok(isHttpStatus(error, 404));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("plan command passes memberId (not username) to plan-builder client calls", async () => {
  const client = createClient({ currentPlanError: notFound("/app/api/plan-builder/current-custom-plan/211199") });
  const { deps } = createDeps(client);

  await commandPlan({ json: true }, deps);

  assert.deepEqual(
    client.calls.sort(),
    [
      ["getAllUserPlans", 211199, "quinnsprouse"],
      ["getCurrentCustomPlan", 211199, "quinnsprouse"],
      ["getPlanPhases", 211199, "quinnsprouse"],
    ],
  );
});

test("plan command treats a current-custom-plan 404 as non-fatal and derives the current plan", async () => {
  const client = createClient({ currentPlanError: notFound("/app/api/plan-builder/current-custom-plan/211199") });
  const { deps, outputs } = createDeps(client);

  await commandPlan({ json: true, view: "current" }, deps);

  assert.equal(outputs.length, 1);
  const payload = outputs[0];
  assert.equal(payload.mode, "private");
  assert.deepEqual(payload.member, MEMBER_INFO);
  assert.deepEqual(payload.counts, { plans: 2, phases: 4, currentPlan: 1 });
  assert.equal(payload.currentPlan.id, 502);
  assert.equal(payload.currentPlan.name, "Gran Fondo Plan");
  assert.equal(payload.currentPlan.memberId, 211199);
  assert.equal(payload.currentPlan.dateOnly, "2026-07-06");
  assert.equal(payload.currentPlan.source, "all-user-plans");
  assert.equal(payload.currentPlan.currentPhase, "build");
  assert.equal(payload.currentPlan.currentPhaseStart, "2026-08-31T00:00:00");
  assert.equal(payload.currentPlan.currentPhaseEnd, "2026-10-11T00:00:00");
  assert.equal(payload.currentPlan.phaseCount, 3);
  assert.deepEqual(
    payload.currentPlan.phases.map((phase) => phase.type),
    ["base", "build", "specialty"],
  );
  assert.equal(payload.count, 1);
  assert.equal(payload.records[0].id, 502);
});

test("plan command still fails on non-404 current-custom-plan errors", async () => {
  const error = new HttpError("Request failed: 500 Server Error", { status: 500, statusText: "Server Error" });
  const client = createClient({ currentPlanError: error });
  const { deps, outputs } = createDeps(client);

  await assert.rejects(() => commandPlan({ json: true }, deps), /500/);
  assert.equal(outputs.length, 0);
});

test("plan command prefers the explicit current-custom-plan payload when available", async () => {
  const explicit = {
    id: 777,
    name: "Explicit Plan",
    memberId: 211199,
    start: "2026-08-01T00:00:00",
    end: "2026-12-01T00:00:00",
    currentPhase: 2,
    phases: [{ id: 9, customPlanId: 777, type: "build", start: "2026-08-01T00:00:00", end: "2026-09-30T00:00:00" }],
  };
  const client = createClient({ currentPlan: explicit });
  const { deps, outputs } = createDeps(client);

  await commandPlan({ json: true, view: "current" }, deps);

  assert.equal(outputs[0].currentPlan.id, 777);
  assert.equal(outputs[0].currentPlan.source, "current-custom-plan");
  assert.equal(outputs[0].currentPlan.currentPhase, 2);
  assert.equal(outputs[0].currentPlan.phaseCount, 1);
});

test("plan command reports no current plan when today falls outside every plan window", async () => {
  const client = createClient({ currentPlanError: notFound("/app/api/plan-builder/current-custom-plan/211199") });
  const { deps, outputs } = createDeps(client, { todayDateOnly: "2026-05-01" });

  await commandPlan({ json: true, view: "current" }, deps);

  assert.equal(outputs[0].currentPlan, null);
  assert.equal(outputs[0].counts.currentPlan, 0);
  assert.equal(outputs[0].count, 0);
  assert.deepEqual(outputs[0].records, []);
});

test("deriveCurrentPlanFromPlans picks the plan whose date window contains today", () => {
  const derived = deriveCurrentPlanFromPlans(PLANS, PHASES, "2026-02-14", { memberId: 211199 });
  assert.equal(derived.id, 501);
  assert.equal(derived.currentPhase, "base");
  assert.equal(derived.phases.length, 1);

  assert.equal(deriveCurrentPlanFromPlans(PLANS, PHASES, "2026-05-01"), null);
  assert.equal(deriveCurrentPlanFromPlans([], [], TODAY), null);
  assert.equal(deriveCurrentPlanFromPlans(null, null, TODAY), null);
});

test("deriveCurrentPlanFromPlans treats window boundaries as inclusive", () => {
  assert.equal(deriveCurrentPlanFromPlans(PLANS, PHASES, "2026-07-06").id, 502);
  assert.equal(deriveCurrentPlanFromPlans(PLANS, PHASES, "2026-11-15").id, 502);
  assert.equal(deriveCurrentPlanFromPlans(PLANS, PHASES, "2026-11-16"), null);
});

test("deriveCurrentPlanFromPlans prefers the latest-starting plan when windows overlap", () => {
  const overlapping = [
    ...PLANS,
    { id: 503, name: "Ad hoc block", start: "2026-08-15T00:00:00", end: "2026-09-15T00:00:00", isAdHoc: true },
  ];
  assert.equal(deriveCurrentPlanFromPlans(overlapping, PHASES, TODAY).id, 503);
});

test("deriveCurrentPlanFromPlans falls back to date containment when phases lack customPlanId", () => {
  const phasesWithoutIds = PHASES.map(({ customPlanId, ...rest }) => rest);
  const derived = deriveCurrentPlanFromPlans(PLANS, phasesWithoutIds, TODAY);
  assert.equal(derived.id, 502);
  assert.deepEqual(derived.phases.map((phase) => phase.type), ["base", "build", "specialty"]);
  assert.equal(derived.currentPhase, "build");
});

test("derived current plan names the active phase for agents", () => {
  const derived = deriveCurrentPlanFromPlans(PLANS, PHASES, TODAY);
  assert.equal(derived.currentPhaseId, 3);
  assert.equal(derived.currentPhaseName, "Fondo Build");
  assert.equal(derived.currentPhase, "build");
});
