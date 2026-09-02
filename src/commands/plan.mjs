import {
  compactCurrentPlan,
  compactPlanPhase,
  compactPlanSummary,
  toIsoDate,
} from "../lib/planning-normalizers.mjs";
import { dateOnlyNowInTimeZone } from "../lib/timezone.mjs";

function isNotFoundError(error) {
  if (error?.status === 404) return true;
  return /^Request failed: 404\b/.test(String(error?.message ?? error ?? ""));
}

async function getOptionalCurrentCustomPlan(client, memberId, username) {
  try {
    return await client.getCurrentCustomPlan(memberId, username);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function dateOnlyOrNull(value) {
  if (!value) return null;
  try {
    return toIsoDate(value);
  } catch {
    return null;
  }
}

function containsDate(record, dateOnly) {
  const startDate = dateOnlyOrNull(record?.start);
  const endDate = dateOnlyOrNull(record?.end);
  if (!startDate || !endDate) return false;
  return startDate <= dateOnly && dateOnly <= endDate;
}

function sameId(left, right) {
  if (left == null || right == null) return false;
  return String(left) === String(right);
}

function phaseName(phase) {
  return phase?.planName ?? phase?.type ?? null;
}

function phasesForPlan(phases, planId) {
  return phases.filter((phase) => sameId(phase.customPlanId, planId));
}

function deriveCurrentPlanFromDatedData({ plans, phases, memberId, todayDateOnly }) {
  const currentPlan = plans.find((plan) => containsDate(plan, todayDateOnly)) ?? null;
  const currentPhase = phases.find((phase) => containsDate(phase, todayDateOnly)) ?? null;

  if (currentPlan) {
    const matchingPhases = phasesForPlan(phases, currentPlan.id);
    const selectedPhase =
      matchingPhases.find((phase) => containsDate(phase, todayDateOnly)) ?? currentPhase;
    return {
      id: currentPlan.id ?? null,
      name: currentPlan.name ?? null,
      memberId: memberId ?? null,
      discipline: currentPlan.discipline ?? null,
      volume: currentPlan.volume ?? null,
      start: currentPlan.start ?? null,
      end: currentPlan.end ?? null,
      date: currentPlan.start ?? null,
      dateOnly: currentPlan.dateOnly ?? null,
      canEdit: null,
      currentPhase: phaseName(selectedPhase),
      currentPhaseStart: selectedPhase?.start ?? null,
      currentPhaseEnd: selectedPhase?.end ?? null,
      plannedActivityGroupType: null,
      autoUpdateApplied: null,
      phaseCount: matchingPhases.length,
      phases: matchingPhases,
    };
  }

  if (currentPhase) {
    const matchingPhases = phasesForPlan(phases, currentPhase.customPlanId);
    return {
      id: currentPhase.customPlanId ?? currentPhase.planId ?? null,
      name: phaseName(currentPhase),
      memberId: memberId ?? null,
      discipline: null,
      volume: currentPhase.volume ?? null,
      start: currentPhase.start ?? null,
      end: currentPhase.end ?? null,
      date: currentPhase.start ?? null,
      dateOnly: currentPhase.dateOnly ?? null,
      canEdit: null,
      currentPhase: phaseName(currentPhase),
      currentPhaseStart: currentPhase.start ?? null,
      currentPhaseEnd: currentPhase.end ?? null,
      plannedActivityGroupType: null,
      autoUpdateApplied: null,
      phaseCount: matchingPhases.length || 1,
      phases: matchingPhases.length > 0 ? matchingPhases : [currentPhase],
    };
  }

  return null;
}

export async function commandPlan(flags, deps) {
  const {
    timeZone,
    dateOnlyNow,
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

  const { memberId, username } = context.memberInfo;
  const [currentPlanRaw, allPlansRaw, phasesRaw] = await Promise.all([
    getOptionalCurrentCustomPlan(context.client, memberId, username),
    context.client.getAllUserPlans(memberId, username),
    context.client.getPlanPhases(memberId, username),
  ]);
  const plans = (Array.isArray(allPlansRaw) ? allPlansRaw : []).map((item) => compactPlanSummary(item));
  const phases = (Array.isArray(phasesRaw) ? phasesRaw : []).map((item) => compactPlanPhase(item));
  const todayDateOnly =
    typeof dateOnlyNow === "function" ? dateOnlyNow() : dateOnlyNowInTimeZone(timeZone);
  const currentPlan =
    compactCurrentPlan(currentPlanRaw) ??
    deriveCurrentPlanFromDatedData({ plans, phases, memberId, todayDateOnly });

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
