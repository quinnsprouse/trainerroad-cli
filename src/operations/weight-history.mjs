import { compactWeightRecord } from "../lib/planning-normalizers.mjs"

export async function commandWeightHistory(flags, deps) {
  const { resolveQueryContext, requirePrivateContext, applyAgentRecordFilters } = deps

  const context = await resolveQueryContext(flags)
  requirePrivateContext(context, "weight-history")

  const raw = await context.client.getWeightHistory(
    context.memberInfo.memberId,
    context.memberInfo.username,
  )
  const records = (Array.isArray(raw) ? raw : []).map((record) => compactWeightRecord(record))
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags)

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "weight-history",
    filters: filterSummary,
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    count: filteredRecords.length,
    records: filteredRecords,
  }

  return payload
}
