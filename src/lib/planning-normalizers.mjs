import { normalizeTimeZone, toDateOnlyInTimeZone } from "./timezone.mjs";

const PROGRESSION_ZONE_META = {
  33: { zoneKey: "endurance", zoneLabel: "Endurance", sortOrder: 1 },
  16: { zoneKey: "tempo", zoneLabel: "Tempo", sortOrder: 2 },
  84: { zoneKey: "sweet-spot", zoneLabel: "Sweet Spot", sortOrder: 3 },
  83: { zoneKey: "threshold", zoneLabel: "Threshold", sortOrder: 4 },
  85: { zoneKey: "vo2-max", zoneLabel: "VO2 Max", sortOrder: 5 },
  79: { zoneKey: "anaerobic", zoneLabel: "Anaerobic", sortOrder: 6 },
};

// From the web app's enum, checked against real annotations on 2026-09-02 (typeId 2 "Wisdom Teeth",
// typeId 4 "Hiking Out West"). Earlier releases had 2 and 4 swapped.
export const ANNOTATION_TYPE_LABELS = {
  1: "note",
  2: "illness",
  3: "injury",
  4: "time-off",
  5: "stage-race",
  6: "custom-plan-start",
  7: "custom-plan-week",
  8: "custom-plan-block",
  9: "plan-start",
  10: "plan-week",
};

// Names an agent can pass to add-annotation --type. Only the four user-editable types.
export const ANNOTATION_TYPE_IDS = {
  note: 1,
  illness: 2,
  sick: 2,
  injury: 3,
  "time-off": 4,
};

function endDateOnlyFrom(startDateOnly, durationSeconds) {
  if (!startDateOnly || !Number.isFinite(Number(durationSeconds))) return startDateOnly ?? null;
  const days = Math.max(1, Math.round(Number(durationSeconds) / 86_400));
  const [year, month, day] = startDateOnly.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days - 1)).toISOString().slice(0, 10);
}

// Shape of GET /app/api/react-calendar/annotation/{id}: the timeline row plus title, text, colour.
export function compactAnnotationDetail(record) {
  const dateOnly = toIsoDateFromCalendarDate(record?.date);
  const durationSeconds = record?.duration ?? null;
  const typeLabel = ANNOTATION_TYPE_LABELS[record?.typeId] ?? `type-${record?.typeId ?? "unknown"}`;
  return {
    id: record?.id ?? null,
    type: typeLabel,
    typeId: record?.typeId ?? null,
    typeLabel,
    title: record?.title ?? null,
    text: record?.text ?? null,
    date: record?.date ?? null,
    dateOnly,
    endDateOnly: endDateOnlyFrom(dateOnly, durationSeconds),
    durationSeconds,
    durationDays: Number.isFinite(Number(durationSeconds)) ? Math.round(Number(durationSeconds) / 86_400) : null,
    timeOfDay: record?.timeOfDay ?? null,
    colorId: record?.colorId ?? null,
    colorHex: record?.colorHex ?? null,
    plannedActivityGroupId: record?.plannedActivityGroupId ?? null,
  };
}

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
    currentPhaseId: plan.currentPhaseId ?? null,
    currentPhaseName: plan.currentPhaseName ?? null,
    currentPhaseStart: plan.currentPhaseStart ?? null,
    currentPhaseEnd: plan.currentPhaseEnd ?? null,
    plannedActivityGroupType: plan.plannedActivityGroupType ?? null,
    autoUpdateApplied: plan.autoUpdateApplied ?? null,
    phaseCount: Array.isArray(plan.phases) ? plan.phases.length : 0,
    phases: Array.isArray(plan.phases) ? plan.phases.map((phase) => compactPlanPhase(phase)) : [],
    source: plan.source ?? "current-custom-plan",
  };
}

function dateWindowContains(start, end, dateOnly) {
  if (!dateOnly) return false;
  const startDateOnly = start ? toIsoDate(start) : null;
  const endDateOnly = end ? toIsoDate(end) : null;
  if (!startDateOnly || !endDateOnly) return false;
  return startDateOnly <= dateOnly && dateOnly <= endDateOnly;
}

// Phases carry the plan's id. When they don't, fall back to phases that sit inside the plan window.
function phaseBelongsToPlan(phase, plan) {
  if (phase?.customPlanId != null && plan?.id != null) {
    return String(phase.customPlanId) === String(plan.id);
  }
  const phaseStart = phase?.start ? toIsoDate(phase.start) : null;
  const phaseEnd = phase?.end ? toIsoDate(phase.end) : null;
  return dateWindowContains(plan?.start, plan?.end, phaseStart) && dateWindowContains(plan?.start, plan?.end, phaseEnd);
}

// Replacement for the retired current-custom-plan endpoint: the plan whose window contains today,
// with its phases attached. Returns a raw-shaped plan for compactCurrentPlan, or null.
export function deriveCurrentPlanFromPlans(plans, phases, todayDateOnly, { memberId = null } = {}) {
  const planList = Array.isArray(plans) ? plans : [];
  const phaseList = Array.isArray(phases) ? phases : [];
  const activePlans = planList
    .filter((plan) => dateWindowContains(plan?.start, plan?.end, todayDateOnly))
    .sort((a, b) => toIsoDate(b.start).localeCompare(toIsoDate(a.start)));
  const plan = activePlans[0];
  if (!plan) return null;

  const planPhases = phaseList
    .filter((phase) => phaseBelongsToPlan(phase, plan))
    .sort((a, b) => (a?.start && b?.start ? toIsoDate(a.start).localeCompare(toIsoDate(b.start)) : 0));
  const currentPhase =
    planPhases.find((phase) => dateWindowContains(phase?.start, phase?.end, todayDateOnly)) ?? null;

  return {
    id: plan.id ?? null,
    name: plan.name ?? null,
    memberId: plan.memberId ?? memberId,
    discipline: plan.discipline ?? null,
    volume: plan.volume ?? null,
    start: plan.start ?? null,
    end: plan.end ?? null,
    canEdit: plan.canEdit ?? null,
    currentPhase: currentPhase?.type ?? plan.phase ?? null,
    currentPhaseId: currentPhase?.id ?? null,
    currentPhaseName: currentPhase?.planName ?? null,
    currentPhaseStart: currentPhase?.start ?? null,
    currentPhaseEnd: currentPhase?.end ?? null,
    plannedActivityGroupType: plan.plannedActivityGroupType ?? null,
    autoUpdateApplied: plan.autoUpdateApplied ?? null,
    phases: planPhases,
    source: "all-user-plans",
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
