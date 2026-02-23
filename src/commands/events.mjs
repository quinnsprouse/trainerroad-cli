import { compactEventRecord } from "../lib/planning-normalizers.mjs";

export async function commandEvents(flags, deps) {
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
  requirePrivateContext(context, "events");

  const fullRecords = Array.isArray(context.timeline?.events) ? context.timeline.events : [];
  const baseRecords = flags.full ? fullRecords : fullRecords.map((record) => compactEventRecord(record));
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(baseRecords, flags);

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "events",
    query: { full: Boolean(flags.full) },
    filters: filterSummary,
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    count: filteredRecords.length,
    records: filteredRecords,
  };
  const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

  if (!isJsonMode(flags)) {
    await writeOutput(outputPayload, flags, (value) => {
      const lines = [`Events (${value.count})`];
      if (hasAgentRecordTransforms(flags) || flags["records-only"] || flags.full) {
        for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
        if (value.filters) lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
        return lines.join("\n");
      }
      for (const event of value.records) {
        const when = event.dateOnly ?? event.started ?? "(unknown-date)";
        lines.push(
          `- ${when} ${event.name ?? "(unnamed-event)"} | priority=${event.racePriority ?? "n/a"} | tss=${event.tss ?? "n/a"}`,
        );
      }
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
}
