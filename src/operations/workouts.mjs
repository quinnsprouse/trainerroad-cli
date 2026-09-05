function addLocalTimeSummary(record, summarizeActivityTime) {
  if (!record || typeof record !== "object" || typeof summarizeActivityTime !== "function") {
    return record
  }
  const summary = summarizeActivityTime(record.started, record.durationInSeconds)
  if (!summary) return record
  return { ...record, ...summary }
}

function addLocalTimeSummaryList(records, summarizeActivityTime) {
  const rows = Array.isArray(records) ? records : []
  return rows.map((record) => addLocalTimeSummary(record, summarizeActivityTime))
}

export async function commandFuture(flags, deps) {
  const {
    requireNumber,
    normalizeDateOnlyInput,
    isoDateShift,
    resolveQueryContext,
    filterFuturePlanned,
    applyAgentRecordFilters,
    sortByDateAsc,
  } = deps

  const days = requireNumber(flags.days, 60)
  const fromDate = normalizeDateOnlyInput(flags.from, isoDateShift(0))
  const toDate = normalizeDateOnlyInput(flags.to, isoDateShift(days))
  if (toDate < fromDate) {
    throw new Error(`Invalid range: --to (${toDate}) is before --from (${fromDate}).`)
  }

  const context = await resolveQueryContext(flags)
  if (context.mode === "private") {
    const subset = filterFuturePlanned(context.timeline.plannedActivities, fromDate, toDate)
    let records = subset
    if (flags.details) {
      records = await context.client.getPlannedActivitiesByIds(
        context.memberInfo.memberId,
        context.memberInfo.username,
        subset.map((item) => item.id),
      )
    }
    const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, {
      sort: "date",
      ...flags,
    })

    const payload = {
      mode: "private",
      generatedAt: new Date().toISOString(),
      command: "future",
      query: { fromDate, toDate, days, details: Boolean(flags.details) },
      filters: filterSummary,
      member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
      count: filteredRecords.length,
      records: filteredRecords,
    }

    return payload
  }

  const records = sortByDateAsc(
    context.publicDays.filter(
      (day) => day.date >= fromDate && day.date <= toDate && day.plannedTssTotal > 0,
    ),
  )
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags)
  const payload = {
    mode: "public",
    generatedAt: new Date().toISOString(),
    command: "future",
    query: { fromDate, toDate, days, details: Boolean(flags.details) },
    filters: filterSummary,
    member: { username: context.targetUsername },
    count: filteredRecords.length,
    records: filteredRecords,
    limitations: [
      "Public mode returns day-level planned TSS only.",
      "Detailed workout names/durations are unavailable in public mode.",
    ],
  }

  return payload
}

export async function commandPast(flags, deps) {
  const {
    requireNumber,
    normalizeDateOnlyInput,
    isoDateShift,
    resolveQueryContext,
    filterPastActivities,
    applyAgentRecordFilters,
    sortByDateDesc,
    summarizeActivityTime,
  } = deps

  const days = requireNumber(flags.days, 60)
  const limit = requireNumber(flags.limit, 30)
  const fromDate = normalizeDateOnlyInput(flags.from, isoDateShift(-days))
  const toDate = normalizeDateOnlyInput(flags.to, isoDateShift(0))
  if (toDate < fromDate) {
    throw new Error(`Invalid range: --to (${toDate}) is before --from (${fromDate}).`)
  }

  const context = await resolveQueryContext(flags)
  if (context.mode === "private") {
    const filtered = filterPastActivities(context.timeline.activities, fromDate, toDate).slice(
      0,
      limit,
    )
    if (!flags.details) {
      const recordsWithLocalTime = addLocalTimeSummaryList(filtered, summarizeActivityTime)
      const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(
        recordsWithLocalTime,
        flags,
      )
      const payload = {
        mode: "private",
        generatedAt: new Date().toISOString(),
        command: "past",
        query: { fromDate, toDate, days, limit, details: false },
        filters: filterSummary,
        member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
        count: filteredRecords.length,
        records: filteredRecords,
      }

      return payload
    }

    const ids = filtered.map((item) => item.id)
    const details = await context.client.getActivitiesByIds(
      context.memberInfo.memberId,
      context.memberInfo.username,
      ids,
    )
    const personalRecords = await context.client.getPersonalRecordsByActivityIds(
      context.memberInfo.memberId,
      context.memberInfo.username,
      ids,
    )
    const detailRecords = details.map((item) => ({
      ...item,
      personalRecordCount: Array.isArray(personalRecords[item.id])
        ? personalRecords[item.id].length
        : 0,
    }))
    const detailRecordsWithLocalTime = addLocalTimeSummaryList(detailRecords, summarizeActivityTime)
    const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(
      detailRecordsWithLocalTime,
      flags,
    )
    const payload = {
      mode: "private",
      generatedAt: new Date().toISOString(),
      command: "past",
      query: { fromDate, toDate, days, limit, details: true },
      filters: filterSummary,
      member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
      count: filteredRecords.length,
      records: filteredRecords,
      personalRecords,
    }

    return payload
  }

  const records = sortByDateDesc(
    context.publicDays.filter(
      (day) => day.date >= fromDate && day.date <= toDate && (day.hasRides || day.tss > 0),
    ),
  ).slice(0, limit)
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags)
  const payload = {
    mode: "public",
    generatedAt: new Date().toISOString(),
    command: "past",
    query: { fromDate, toDate, days, limit, details: Boolean(flags.details) },
    filters: filterSummary,
    member: { username: context.targetUsername },
    count: filteredRecords.length,
    records: filteredRecords,
    limitations: [
      "Public mode returns day-level historical load signals only.",
      "Detailed completed workout records are unavailable in public mode.",
    ],
  }

  return payload
}

export async function commandToday(flags, deps) {
  const {
    normalizeDateOnlyInput,
    isoDateShift,
    resolveQueryContext,
    filterFuturePlanned,
    filterPastActivities,
    applyAgentRecordFilters,
    summarizeActivityTime,
  } = deps

  const today = normalizeDateOnlyInput(flags.date, isoDateShift(0))
  const context = await resolveQueryContext(flags)

  if (context.mode === "private") {
    const plannedToday = filterFuturePlanned(context.timeline.plannedActivities, today, today)
    const activitiesToday = filterPastActivities(context.timeline.activities, today, today)
    let plannedRecords = plannedToday
    let activityRecords = activitiesToday
    let personalRecords = {}

    if (flags.details) {
      plannedRecords = await context.client.getPlannedActivitiesByIds(
        context.memberInfo.memberId,
        context.memberInfo.username,
        plannedToday.map((item) => item.id),
      )
      activityRecords = await context.client.getActivitiesByIds(
        context.memberInfo.memberId,
        context.memberInfo.username,
        activitiesToday.map((item) => item.id),
      )
      personalRecords = await context.client.getPersonalRecordsByActivityIds(
        context.memberInfo.memberId,
        context.memberInfo.username,
        activitiesToday.map((item) => item.id),
      )
    }

    const completedWithLocalTime = addLocalTimeSummaryList(activityRecords, summarizeActivityTime)
    const records = [
      ...plannedRecords.map((item) => ({ recordType: "planned", ...item })),
      ...completedWithLocalTime.map((item) => ({
        recordType: "completed",
        ...item,
        personalRecordCount: Array.isArray(personalRecords[item.id])
          ? personalRecords[item.id].length
          : 0,
      })),
    ]
    const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags)

    const payload = {
      mode: "private",
      generatedAt: new Date().toISOString(),
      command: "today",
      query: { date: today, details: Boolean(flags.details) },
      filters: filterSummary,
      member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
      counts: { planned: plannedRecords.length, completed: completedWithLocalTime.length },
      planned: plannedRecords,
      completed: completedWithLocalTime,
      personalRecords,
      count: filteredRecords.length,
      records: filteredRecords,
    }

    return payload
  }

  const day = context.publicDays.find((item) => item.date === today) ?? null
  const records = day ? [day] : []
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags)
  const payload = {
    mode: "public",
    generatedAt: new Date().toISOString(),
    command: "today",
    query: { date: today, details: Boolean(flags.details) },
    filters: filterSummary,
    member: { username: context.targetUsername },
    counts: { days: day ? 1 : 0 },
    day,
    count: filteredRecords.length,
    records: filteredRecords,
    limitations: [
      "Public mode provides day-level load/plan signal only.",
      "No workout-level detail without authentication.",
    ],
  }

  return payload
}
