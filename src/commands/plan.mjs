import {
  compactCurrentPlan,
  compactPlanPhase,
  compactPlanSummary,
  toIsoDate,
} from "../lib/planning-normalizers.mjs";

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

  const [currentPlanRaw, allPlansRaw, phasesRaw] = await Promise.all([
    context.client.getCurrentCustomPlan(context.memberInfo.username),
    context.client.getAllUserPlans(context.memberInfo.username),
    context.client.getPlanPhases(context.memberInfo.username),
  ]);
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
    currentPlan: flags.full || view === "current" ? currentPlan : compactCurrentPlan(currentPlanRaw),
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
