export async function commandFtp(flags, deps) {
  const { requirePositiveInteger, resolveQueryContext, normalizeFtpHistory, getLastItem } = deps

  const historyLimit = requirePositiveInteger(flags["history-limit"], 50)
  const context = await resolveQueryContext(flags)
  let historySource = context.publicTss ?? null

  if (context.mode === "private") {
    try {
      historySource = await context.client.getPublicTssByUsername(context.memberInfo.username)
    } catch {
      historySource = null
    }
  }

  const fullHistory = normalizeFtpHistory(
    historySource?.ftpRecordsDate ?? historySource?.FtpRecordsDate ?? [],
  )
  const records = historyLimit > 0 ? fullHistory.slice(-historyLimit) : fullHistory
  const latest = getLastItem(fullHistory)

  if (context.mode === "private") {
    const payload = {
      mode: "private",
      generatedAt: new Date().toISOString(),
      command: "ftp",
      member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
      currentFtp: context.memberInfo.ftp ?? latest?.value ?? null,
      ftpHistoryCount: fullHistory.length,
      query: { historyLimit },
      records,
    }

    return payload
  }

  const payload = {
    mode: "public",
    generatedAt: new Date().toISOString(),
    command: "ftp",
    member: { username: context.targetUsername },
    currentFtp: latest?.value ?? null,
    ftpHistoryCount: fullHistory.length,
    query: { historyLimit },
    records,
    limitations: [
      "Public mode can expose FTP history only when profile data is public.",
      "No AI FTP detection or private progression internals in public mode.",
    ],
  }

  return payload
}

export async function commandFtpPrediction(flags, deps) {
  const {
    resolveQueryContext,
    requirePrivateContext,
    toIsoDate,
    isoDateShift,
    normalizeFitnessThresholds,
    dateOnlyDiffDays,
    countPlannedWorkoutsInRange,
  } = deps

  const context = await resolveQueryContext(flags)
  requirePrivateContext(context, "ftp-prediction")

  const [eligibility, failureStatus, levels, timeline] = await Promise.all([
    context.client.getAiFtpEligibility(context.memberInfo.memberId, context.memberInfo.username),
    context.client.getAiFtpFailureStatus(context.memberInfo.memberId, context.memberInfo.username),
    context.client.getCareerLevels(context.memberInfo.memberId, context.memberInfo.username),
    context.client.getTimeline(context.memberInfo.memberId, context.memberInfo.username),
  ])

  const detection = eligibility?.additionalData?.detection ?? {}
  const projectedProgressionLevels = Array.isArray(detection?.projectedProgressionLevels)
    ? detection.projectedProgressionLevels
    : []
  const currentProgressionLevels = Array.isArray(detection?.currentProgressionLevels)
    ? detection.currentProgressionLevels
    : []
  const nextAiFtpAvailability = eligibility?.additionalData?.nextAiFtpAvailability ?? null
  const nextAiFtpAvailabilityDateOnly = nextAiFtpAvailability
    ? toIsoDate(nextAiFtpAvailability)
    : null
  const todayDateOnly = isoDateShift(0)
  const fitnessThresholds = normalizeFitnessThresholds(timeline?.fitnessThresholds ?? [])
  const currentFtpRaw = detection?.ftp ?? context.memberInfo.ftp ?? null
  const currentFtp = Number.isFinite(Number(currentFtpRaw)) ? Number(currentFtpRaw) : null

  let predictedThreshold = null
  if (nextAiFtpAvailabilityDateOnly) {
    const matching = fitnessThresholds.filter(
      (row) => row.dateOnly === nextAiFtpAvailabilityDateOnly,
    )
    if (matching.length > 0) predictedThreshold = matching[matching.length - 1]
  }
  if (!predictedThreshold) {
    const futureCandidates = fitnessThresholds.filter(
      (row) => row.dateOnly >= todayDateOnly && !row.isApplied,
    )
    if (futureCandidates.length > 0) predictedThreshold = futureCandidates[0]
  }

  const predictedFtp = predictedThreshold?.value ?? null
  const predictionDate = predictedThreshold?.date ?? nextAiFtpAvailability ?? null
  const predictionDateOnly = predictedThreshold?.dateOnly ?? nextAiFtpAvailabilityDateOnly ?? null
  const daysUntilPrediction =
    predictionDateOnly != null ? dateOnlyDiffDays(todayDateOnly, predictionDateOnly) : null
  const ftpDelta =
    Number.isFinite(currentFtp) && Number.isFinite(predictedFtp) ? predictedFtp - currentFtp : null
  const ftpDeltaPercent =
    ftpDelta != null && currentFtp && currentFtp !== 0
      ? Math.round((ftpDelta / currentFtp) * 100)
      : null
  const plannedWorkoutCount =
    predictionDateOnly != null
      ? countPlannedWorkoutsInRange(
          timeline?.plannedActivities ?? [],
          todayDateOnly,
          predictionDateOnly,
        )
      : null

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "ftp-prediction",
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    canUseAiFtp: Boolean(eligibility?.can),
    reasonCode: eligibility?.reason ?? null,
    modelVersion: eligibility?.modelVersion ?? detection?.modelVersion ?? null,
    detectionFtp: detection?.ftp ?? null,
    currentFtp,
    predictedFtp,
    predictionDate,
    predictionDateOnly,
    daysUntilPrediction,
    ftpDelta,
    ftpDeltaPercent,
    plannedWorkoutCount,
    nextAiFtpAvailability,
    nextAiFtpAvailabilityDateOnly,
    lastViewed: eligibility?.additionalData?.lastViewed ?? null,
    aiFailureStatus: failureStatus?.status ?? null,
    projectedProgressionLevels,
    currentProgressionLevels,
    levels: levels?.levels ?? {},
    levelsTimestamp: levels?.timestamp ?? null,
    predictionThresholdSource: predictedThreshold,
    futureFitnessThresholds: fitnessThresholds.filter((row) => row.dateOnly >= todayDateOnly),
    records: projectedProgressionLevels,
  }

  return payload
}
