import test from "node:test";
import assert from "node:assert/strict";
import { TrainerRoadClient } from "../src/trainerroad-client.mjs";
import { commandPlan } from "../src/commands/plan.mjs";

const MEMBER_INFO = { memberId: 211199, username: "quinnsprouse" };

function createNotFound(path) {
  const error = new Error(`Request failed: 404 Not Found for ${path} -> `);
  error.status = 404;
  error.path = path;
  return error;
}

function createPlanDeps(client, { todayDateOnly = "2026-09-02" } = {}) {
  const outputs = [];
  return {
    outputs,
    deps: {
      timeZone: "UTC",
      dateOnlyNow: () => todayDateOnly,
      async resolveQueryContext() {
        return {
          mode: "private",
          client,
          memberInfo: MEMBER_INFO,
        };
      },
      requirePrivateContext(context, command) {
        if (context.mode !== "private") {
          throw new Error(`${command} requires private authenticated mode.`);
        }
      },
      applyAgentRecordFilters(records) {
        return {
          records,
          filterSummary: {
            inputCount: records.length,
            outputCount: records.length,
          },
        };
      },
      toRecordsOnlyPayload(payload) {
        return payload.records;
      },
      isJsonMode() {
        return true;
      },
      async writeOutput(payload) {
        outputs.push(payload);
      },
      hasAgentRecordTransforms() {
        return false;
      },
    },
  };
}

function assertPlanBuilderArgs(memberId, username) {
  assert.equal(memberId, MEMBER_INFO.memberId);
  assert.equal(username, MEMBER_INFO.username);
}

test("client plan-builder methods put memberId in paths and username in referer", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new TrainerRoadClient();

    await client.getAllUserPlans(MEMBER_INFO.memberId, MEMBER_INFO.username);
    await client.getPlanPhases(MEMBER_INFO.memberId, MEMBER_INFO.username);
    await client.getCurrentCustomPlan(MEMBER_INFO.memberId, MEMBER_INFO.username);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    [
      "/app/api/plan-builder/211199/all-user-plans",
      "/app/api/plan-builder/211199/plan-phases",
      "/app/api/plan-builder/current-custom-plan/211199",
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.headers.get("referer"), "https://www.trainerroad.com/app/career/quinnsprouse");
    assert.doesNotMatch(new URL(call.url).pathname, /quinnsprouse/);
  }
});

test("plan view plans survives current-custom-plan 404 and still returns plans", async () => {
  const client = {
    async getCurrentCustomPlan(memberId, username) {
      assertPlanBuilderArgs(memberId, username);
      throw createNotFound("/app/api/plan-builder/current-custom-plan/211199");
    },
    async getAllUserPlans(memberId, username) {
      assertPlanBuilderArgs(memberId, username);
      return [
        {
          id: 1,
          name: "Black Fork 2025",
          start: "2025-01-07T00:00:00",
          end: "2025-07-27T00:00:00",
        },
      ];
    },
    async getPlanPhases(memberId, username) {
      assertPlanBuilderArgs(memberId, username);
      return [];
    },
  };
  const { deps, outputs } = createPlanDeps(client);

  await commandPlan({ view: "plans", json: true }, deps);

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].counts.plans, 1);
  assert.equal(outputs[0].counts.currentPlan, 0);
  assert.equal(outputs[0].currentPlan, null);
  assert.deepEqual(outputs[0].records, outputs[0].plans);
  assert.equal(outputs[0].records[0].name, "Black Fork 2025");
});

test("plan view current derives current plan and phase when dedicated endpoint is absent", async () => {
  const client = {
    async getCurrentCustomPlan(memberId, username) {
      assertPlanBuilderArgs(memberId, username);
      throw createNotFound("/app/api/plan-builder/current-custom-plan/211199");
    },
    async getAllUserPlans(memberId, username) {
      assertPlanBuilderArgs(memberId, username);
      return [
        {
          id: 10,
          name: "Black Fork 2025",
          start: "2025-01-07T00:00:00",
          end: "2025-07-27T00:00:00",
        },
        {
          id: 20,
          name: "Gravel - Increasing FTP",
          discipline: "Road",
          volume: "Mid Volume",
          start: "2026-05-31T00:00:00",
          end: "2026-12-27T00:00:00",
        },
      ];
    },
    async getPlanPhases(memberId, username) {
      assertPlanBuilderArgs(memberId, username);
      return [
        {
          id: 200,
          customPlanId: 20,
          planName: "Sustained Power Build",
          start: "2026-08-17T00:00:00",
          end: "2026-10-11T00:00:00",
          volume: "Mid Volume",
        },
      ];
    },
  };
  const { deps, outputs } = createPlanDeps(client);

  await commandPlan({ view: "current", json: true }, deps);

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].counts.currentPlan, 1);
  assert.equal(outputs[0].currentPlan.name, "Gravel - Increasing FTP");
  assert.equal(outputs[0].currentPlan.memberId, 211199);
  assert.equal(outputs[0].currentPlan.currentPhase, "Sustained Power Build");
  assert.equal(outputs[0].currentPlan.currentPhaseStart, "2026-08-17T00:00:00");
  assert.equal(outputs[0].currentPlan.currentPhaseEnd, "2026-10-11T00:00:00");
  assert.equal(outputs[0].currentPlan.phaseCount, 1);
  assert.deepEqual(outputs[0].records, [outputs[0].currentPlan]);
});
