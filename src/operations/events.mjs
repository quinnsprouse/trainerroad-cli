import { compactEventRecord } from "../lib/planning-normalizers.mjs"

export async function commandEvents(flags, deps) {
  const { resolveQueryContext, requirePrivateContext, applyAgentRecordFilters } = deps

  const context = await resolveQueryContext(flags)
  requirePrivateContext(context, "events")

  const fullRecords = Array.isArray(context.timeline?.events) ? context.timeline.events : []
  const baseRecords = flags.full
    ? fullRecords
    : fullRecords.map((record) => compactEventRecord(record))
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(baseRecords, flags)

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "events",
    query: { full: Boolean(flags.full) },
    filters: filterSummary,
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    count: filteredRecords.length,
    records: filteredRecords,
  }

  return payload
}
