import { buildLevelsByZone } from "../lib/planning-normalizers.mjs";

export async function commandLevels(flags, deps) {
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
  requirePrivateContext(context, "levels");

  const [levelsPayload, eligibilityPayload] = await Promise.all([
    context.client.getCareerLevels(context.memberInfo.memberId, context.memberInfo.username),
    context.client.getAiFtpEligibility(context.memberInfo.memberId, context.memberInfo.username),
  ]);
  const records = buildLevelsByZone(levelsPayload, eligibilityPayload);
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags);

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "levels",
    filters: filterSummary,
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    levelsTimestamp: levelsPayload?.timestamp ?? null,
    aiModelVersion:
      eligibilityPayload?.modelVersion ??
      eligibilityPayload?.additionalData?.detection?.modelVersion ??
      null,
    count: filteredRecords.length,
    records: filteredRecords,
  };
  const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

  if (!isJsonMode(flags)) {
    await writeOutput(outputPayload, flags, (value) => {
      const lines = [`Progression levels (${value.count})`];
      if (hasAgentRecordTransforms(flags) || flags["records-only"]) {
        for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
        if (value.filters) lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
        return lines.join("\n");
      }
      for (const record of value.records) {
        lines.push(
          `- ${record.zoneLabel} | recent=${record.recentLevel ?? "n/a"} | aiCurrent=${record.aiCurrentDisplayLevel ?? "n/a"} | aiProjected=${record.aiProjectedDisplayLevel ?? "n/a"} | delta=${record.aiDelta ?? "n/a"}`,
        );
      }
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
}
