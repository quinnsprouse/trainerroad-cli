import { compactAnnotationRecord } from "../lib/planning-normalizers.mjs";

export async function commandAnnotations(flags, deps) {
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
  requirePrivateContext(context, "annotations");

  const fullRecords = Array.isArray(context.timeline?.annotations)
    ? context.timeline.annotations
    : [];
  const baseRecords = flags.full ? fullRecords : fullRecords.map((record) => compactAnnotationRecord(record));
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(baseRecords, flags);

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "annotations",
    query: { full: Boolean(flags.full) },
    filters: filterSummary,
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    count: filteredRecords.length,
    records: filteredRecords,
  };
  const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

  if (!isJsonMode(flags)) {
    await writeOutput(outputPayload, flags, (value) => {
      const lines = [`Annotations (${value.count})`];
      if (hasAgentRecordTransforms(flags) || flags["records-only"] || flags.full) {
        for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
        if (value.filters) lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
        return lines.join("\n");
      }
      for (const annotation of value.records) {
        lines.push(
          `- ${annotation.dateOnly ?? "(unknown-date)"} type=${annotation.typeLabel ?? annotation.typeId} durationDays=${annotation.durationDays ?? "n/a"}`,
        );
      }
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
}
