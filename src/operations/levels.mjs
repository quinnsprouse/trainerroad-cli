import { buildLevelsByZone } from "../lib/planning-normalizers.mjs"

export async function commandLevels(flags, deps) {
  const { resolveQueryContext, requirePrivateContext, applyAgentRecordFilters } = deps

  const context = await resolveQueryContext(flags)
  requirePrivateContext(context, "levels")

  const [levelsPayload, eligibilityPayload] = await Promise.all([
    context.client.getCareerLevels(context.memberInfo.memberId, context.memberInfo.username),
    context.client.getAiFtpEligibility(context.memberInfo.memberId, context.memberInfo.username),
  ])
  const records = buildLevelsByZone(levelsPayload, eligibilityPayload)
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags)

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
  }

  return payload
}
