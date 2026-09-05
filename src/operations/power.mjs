export async function commandPowerRanking(flags, deps) {
  const { resolveQueryContext, requirePrivateContext } = deps
  const context = await resolveQueryContext(flags)
  requirePrivateContext(context, "power-ranking")

  const records = await context.client.getPowerRanking(
    context.memberInfo.memberId,
    context.memberInfo.username,
  )
  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "power-ranking",
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    count: records.length,
    records,
  }

  return payload
}

export async function commandPowerRecords(flags, deps) {
  const {
    resolveQueryContext,
    requirePrivateContext,
    normalizeDateOnlyInput,
    isoDateShift,
    requirePositiveInteger,
    toBoolean,
    compactPersonalRecord,
  } = deps
  const context = await resolveQueryContext(flags)
  requirePrivateContext(context, "power-records")

  const startDate = normalizeDateOnlyInput(flags["start-date"], "2013-05-10")
  const endDate = normalizeDateOnlyInput(flags["end-date"], isoDateShift(0))
  const rowType = requirePositiveInteger(flags["row-type"], 101)
  const indoorOnly = toBoolean(flags["indoor-only"], false)
  const slot = requirePositiveInteger(flags.slot, 1)
  const limit = requirePositiveInteger(flags.limit, 25)
  const full = toBoolean(flags.full, false)

  const raw = await context.client.getPersonalRecordsForDateRange(
    context.memberInfo.memberId,
    context.memberInfo.username,
    { startDate, endDate, rowType, indoorOnly, slot },
  )

  const allRecords = Array.isArray(raw?.results?.[0]?.personalRecords)
    ? raw.results[0].personalRecords
    : []
  const wattsOf = (item) => item?.watts ?? item?.Watts ?? 0
  const rankedByWatts = [...allRecords].sort((a, b) => wattsOf(b) - wattsOf(a))
  const selectedRaw = full ? allRecords : rankedByWatts.slice(0, limit)
  const records = full ? selectedRaw : selectedRaw.map((item) => compactPersonalRecord(item))

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "power-records",
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    query: { startDate, endDate, rowType, indoorOnly, slot, limit, full },
    totalRecords: allRecords.length,
    count: records.length,
    records,
    results: full ? (raw?.results ?? []) : undefined,
  }

  return payload
}
