import { compactAnnotationRecord } from "../lib/planning-normalizers.mjs"

export async function commandAnnotations(flags, deps) {
  const { resolveQueryContext, requirePrivateContext, applyAgentRecordFilters } = deps

  const context = await resolveQueryContext(flags)
  requirePrivateContext(context, "annotations")

  const fullRecords = Array.isArray(context.timeline?.annotations)
    ? context.timeline.annotations
    : []
  const baseRecords = flags.full
    ? fullRecords
    : fullRecords.map((record) => compactAnnotationRecord(record))
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(baseRecords, flags)

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "annotations",
    query: { full: Boolean(flags.full) },
    filters: filterSummary,
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    count: filteredRecords.length,
    records: filteredRecords,
  }

  return payload
}
