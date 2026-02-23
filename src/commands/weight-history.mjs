import { compactWeightRecord } from "../lib/planning-normalizers.mjs";

export async function commandWeightHistory(flags, deps) {
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
  requirePrivateContext(context, "weight-history");

  const raw = await context.client.getWeightHistory(
    context.memberInfo.memberId,
    context.memberInfo.username,
  );
  const records = (Array.isArray(raw) ? raw : []).map((record) => compactWeightRecord(record));
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags);

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "weight-history",
    filters: filterSummary,
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    count: filteredRecords.length,
    records: filteredRecords,
  };
  const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

  if (!isJsonMode(flags)) {
    await writeOutput(outputPayload, flags, (value) => {
      const lines = [`Weight history (${value.count})`];
      if (hasAgentRecordTransforms(flags) || flags["records-only"]) {
        for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
        if (value.filters) lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
        return lines.join("\n");
      }
      for (const record of value.records) {
        lines.push(`- ${record.dateOnly ?? "(unknown-date)"} ${record.value ?? "n/a"} (units=${record.units ?? "n/a"})`);
      }
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
}
