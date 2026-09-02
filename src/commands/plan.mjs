import {
  compactCurrentPlan,
  compactPlanPhase,
  compactPlanSummary,
  deriveCurrentPlanFromPlans,
  toIsoDate,
} from "../lib/planning-normalizers.mjs";
import { isHttpStatus } from "../trainerroad-client.mjs";
import { dateOnlyNowInTimeZone } from "../lib/timezone.mjs";

// TrainerRoad's current-custom-plan endpoint is not reliably available (it 404s for members
// who build plans through the newer plan-builder flow). Treat a 404 as "no explicit current
// plan" and fall back to deriving it from all-user-plans + plan-phases.
async function fetchCurrentCustomPlanOrNull(client, memberId, username) {
  try {
    return await client.getCurrentCustomPlan(memberId, username);
  } catch (error) {
    if (isHttpStatus(error, 404)) return null;
    throw error;
  }
}

export async function commandPlan(flags, deps) {
  const {
    resolveQueryContext,
    requirePrivateContext,
    applyAgentRecordFilters,
    toRecordsOnlyPayload,
    isJsonMode,
    writeOutput,
    hasAgentRecordTransforms,
  } = deps;

  const context = await resolveQueryContext(flags);
  requirePrivateContext(context, "plan");

  const view = String(flags.view ?? "phases").toLowerCase();
  const validViews = new Set(["current", "phases", "plans"]);
  if (!validViews.has(view)) {
    throw new Error(`Invalid --view "${view}". Expected one of: current, phases, plans.`);
  }

  // plan-builder endpoints are keyed by the numeric memberId; the username only belongs in the referer.
  const { memberId, username } = context.memberInfo;
  const [explicitCurrentPlanRaw, allPlansRaw, phasesRaw] = await Promise.all([
    fetchCurrentCustomPlanOrNull(context.client, memberId, username),
    context.client.getAllUserPlans(memberId, username),
    context.client.getPlanPhases(memberId, username),
  ]);
  const todayDateOnly = deps.todayDateOnly ?? dateOnlyNowInTimeZone(flags.tz ?? null);
  const currentPlanRaw =
    explicitCurrentPlanRaw ??
    deriveCurrentPlanFromPlans(allPlansRaw, phasesRaw, todayDateOnly, { memberId });
  const currentPlan = compactCurrentPlan(currentPlanRaw);
  const plans = (Array.isArray(allPlansRaw) ? allPlansRaw : []).map((item) => compactPlanSummary(item));
  const phases = (Array.isArray(phasesRaw) ? phasesRaw : []).map((item) => compactPlanPhase(item));

  const viewRecords =
    view === "current" ? (currentPlan ? [currentPlan] : []) : view === "plans" ? plans : phases;
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(viewRecords, flags);

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "plan",
    query: { view, full: Boolean(flags.full) },
    filters: filterSummary,
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    counts: {
      plans: plans.length,
      phases: phases.length,
      currentPlan: currentPlan ? 1 : 0,
    },
    currentPlan,
    plans: flags.full || view === "plans" ? plans : undefined,
    phases: flags.full || view === "phases" ? phases : undefined,
    count: filteredRecords.length,
    records: filteredRecords,
  };
  const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

  if (!isJsonMode(flags)) {
    await writeOutput(outputPayload, flags, (value) => {
      const lines = [
        `Plan view=${value.query?.view ?? view} records=${value.count}`,
      ];
      if (hasAgentRecordTransforms(flags) || flags["records-only"]) {
        for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
        if (value.filters) lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
        return lines.join("\n");
      }
      for (const item of value.records) {
        lines.push(
          `- ${item.name ?? item.planName ?? "(unnamed)"} ${item.dateOnly ?? "(no-date)"} -> ${item.end ? toIsoDate(item.end) : "n/a"}`,
        );
      }
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
}
