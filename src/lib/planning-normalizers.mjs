import { normalizeTimeZone, toDateOnlyInTimeZone } from "./timezone.mjs";

const PROGRESSION_ZONE_META = {
  33: { zoneKey: "endurance", zoneLabel: "Endurance", sortOrder: 1 },
  16: { zoneKey: "tempo", zoneLabel: "Tempo", sortOrder: 2 },
  84: { zoneKey: "sweet-spot", zoneLabel: "Sweet Spot", sortOrder: 3 },
  83: { zoneKey: "threshold", zoneLabel: "Threshold", sortOrder: 4 },
  85: { zoneKey: "vo2-max", zoneLabel: "VO2 Max", sortOrder: 5 },
  79: { zoneKey: "anaerobic", zoneLabel: "Anaerobic", sortOrder: 6 },
};

const ANNOTATION_TYPE_LABELS = {
  1: "note",
  2: "time-off",
  3: "injury",
  4: "illness",
  9: "plan-marker",
};

function toIsoDateFromPlanned(item) {
  return `${String(item.date.year).padStart(4, "0")}-${String(item.date.month).padStart(2, "0")}-${String(item.date.day).padStart(2, "0")}`;
}

export function toIsoDate(value) {
  if (typeof value === "string" && value.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return (
    toDateOnlyInTimeZone(value, normalizeTimeZone(), { assumeUtcForOffsetlessDateTime: true }) ??
    new Date(value).toISOString().slice(0, 10)
  );
}

function toIsoDateFromCalendarDate(dateValue) {
  if (!dateValue) return null;
  const wrapped = { date: dateValue };
  try {
    return toIsoDateFromPlanned(wrapped);
  } catch {
    return null;
  }
}

export function compactEventRecord(record) {
  return {
    id: record?.id ?? null,
    name: record?.name ?? null,
    date: record?.date ?? null,
    dateOnly: toIsoDateFromCalendarDate(record?.date),
    timeOfDay: record?.timeOfDay ?? null,
    started: record?.started ?? null,
    racePriority: record?.racePriority ?? null,
    activityType: record?.activityType ?? null,
    activityEventType: record?.activityEventType ?? null,
    tss: record?.tss ?? null,
    activityTss: record?.activityTss ?? null,
    isTriathlonType: record?.isTriathlonType ?? null,
    manuallyCompleted: record?.manuallyCompleted ?? null,
  };
}

export function compactAnnotationRecord(record) {
  const dateOnly = toIsoDateFromCalendarDate(record?.date);
  const durationDays =
    Number.isFinite(Number(record?.duration)) ? Math.round(Number(record.duration) / 86_400) : null;
  const typeLabel = ANNOTATION_TYPE_LABELS[record?.typeId] ?? "unknown";
  return {
    id: record?.id ?? null,
    type: typeLabel,
    typeId: record?.typeId ?? null,
    typeLabel,
    recordType: typeLabel,
    date: record?.date ?? null,
    dateOnly,
    durationSeconds: record?.duration ?? null,
    durationDays,
    groupId: record?.groupId ?? null,
  };
}

export function compactWeightRecord(record) {
  return {
    id: record?.id ?? null,
    value: Number.isFinite(Number(record?.value)) ? Number(record.value) : null,
    units: record?.units ?? null,
    date: record?.date ?? null,
    dateOnly: record?.date ? toIsoDate(record.date) : null,
  };
}

export function compactPlanSummary(plan) {
  return {
    id: plan?.id ?? null,
    name: plan?.name ?? null,
    discipline: plan?.discipline ?? null,
    volume: plan?.volume ?? null,
    phase: plan?.phase ?? null,
    start: plan?.start ?? null,
    end: plan?.end ?? null,
    date: plan?.start ?? null,
    dateOnly: plan?.start ? toIsoDate(plan.start) : null,
    isAdHoc: plan?.isAdHoc ?? null,
    plannedActivityGroupId: plan?.plannedActivityGroupId ?? null,
  };
}

export function compactPlanPhase(phase) {
  return {
    id: phase?.id ?? null,
    customPlanId: phase?.customPlanId ?? null,
    type: phase?.type ?? null,
    volume: phase?.volume ?? null,
    planId: phase?.planId ?? null,
    planName: phase?.planName ?? null,
    start: phase?.start ?? null,
    end: phase?.end ?? null,
    date: phase?.start ?? null,
    dateOnly: phase?.start ? toIsoDate(phase.start) : null,
    isMasters: phase?.isMasters ?? null,
    isPolarized: phase?.isPolarized ?? null,
  };
}

export function compactCurrentPlan(plan) {
  if (!plan || typeof plan !== "object") return null;
  return {
    id: plan.id ?? null,
    name: plan.name ?? null,
    memberId: plan.memberId ?? null,
    discipline: plan.discipline ?? null,
    volume: plan.volume ?? null,
    start: plan.start ?? null,
    end: plan.end ?? null,
    date: plan.start ?? null,
    dateOnly: plan.start ? toIsoDate(plan.start) : null,
    canEdit: plan.canEdit ?? null,
    currentPhase: plan.currentPhase ?? null,
    currentPhaseStart: plan.currentPhaseStart ?? null,
    currentPhaseEnd: plan.currentPhaseEnd ?? null,
    plannedActivityGroupType: plan.plannedActivityGroupType ?? null,
    autoUpdateApplied: plan.autoUpdateApplied ?? null,
    phaseCount: Array.isArray(plan.phases) ? plan.phases.length : 0,
    phases: Array.isArray(plan.phases) ? plan.phases.map((phase) => compactPlanPhase(phase)) : [],
  };
}

export function buildLevelsByZone(levelsPayload, aiEligibilityPayload = null) {
  const rawLevels = levelsPayload?.levels ?? {};
  const detection = aiEligibilityPayload?.additionalData?.detection ?? {};
  const aiProjected = new Map(
    (Array.isArray(detection.projectedProgressionLevels) ? detection.projectedProgressionLevels : []).map(
      (item) => [Number(item.progressionId), item],
    ),
  );
  const aiCurrent = new Map(
    (Array.isArray(detection.currentProgressionLevels) ? detection.currentProgressionLevels : []).map(
      (item) => [Number(item.progressionId), item],
    ),
  );

  const records = Object.entries(rawLevels).map(([progressionIdRaw, value]) => {
    const progressionId = Number(progressionIdRaw);
    const zoneMeta = PROGRESSION_ZONE_META[progressionId] ?? {
      zoneKey: `progression-${progressionId}`,
      zoneLabel: `Progression ${progressionId}`,
      sortOrder: 1000 + progressionId,
    };
    const aiProjectedRecord = aiProjected.get(progressionId) ?? null;
    const aiCurrentRecord = aiCurrent.get(progressionId) ?? null;
    return {
      progressionId,
      type: zoneMeta.zoneKey,
      recordType: zoneMeta.zoneKey,
      zoneKey: zoneMeta.zoneKey,
      zoneLabel: zoneMeta.zoneLabel,
      sortOrder: zoneMeta.sortOrder,
      recentLevel: value?.recent ?? null,
      endpointPredictedLevel: value?.predicted ?? null,
      activityId: value?.activityId ?? null,
      changeDate: value?.changeEvent?.date ?? null,
      date: value?.changeEvent?.date ?? null,
      dateOnly: value?.changeEvent?.date ? toIsoDate(value.changeEvent.date) : null,
      changeReason: value?.changeEvent?.reason ?? null,
      changeFrom: value?.changeEvent?.level?.from ?? null,
      changeTo: value?.changeEvent?.level?.to ?? null,
      changeDelta: value?.changeEvent?.delta ?? null,
      aiCurrentDisplayLevel: aiCurrentRecord?.previousDisplayLevel ?? null,
      aiProjectedDisplayLevel: aiProjectedRecord?.displayFinalLevel ?? null,
      aiDelta:
        aiCurrentRecord && aiProjectedRecord
          ? aiProjectedRecord.displayFinalLevel - aiCurrentRecord.previousDisplayLevel
          : null,
    };
  });

  return records.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.progressionId - b.progressionId;
  });
}
