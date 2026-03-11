const ALTERNATE_CATEGORIES = new Set(["similar", "easier", "harder", "longer", "shorter"]);
const SWITCH_MODES = new Set(["inside", "outside"]);

function requireFlag(flags, name) {
  const value = flags[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required flag --${name}.`);
  }
  return value;
}

function toIsoDateFromApiDate(date) {
  if (!date || typeof date !== "object") return null;
  const year = String(date.year ?? "").padStart(4, "0");
  const month = String(date.month ?? "").padStart(2, "0");
  const day = String(date.day ?? "").padStart(2, "0");
  if (!year.trim() || !month.trim() || !day.trim()) return null;
  return `${year}-${month}-${day}`;
}

function summarizePlannedActivity(activity) {
  if (!activity || typeof activity !== "object") return null;
  const workout = activity.workout ?? null;
  return {
    plannedActivityId: activity.id ?? null,
    date: toIsoDateFromApiDate(activity.date),
    timeOfDay: activity.timeOfDay ?? null,
    workoutId: workout?.id ?? null,
    workoutName: workout?.name ?? activity.name ?? null,
    isOutside: workout?.isOutside ?? null,
    durationMinutes:
      workout?.duration ??
      (Number.isFinite(Number(activity.durationInSeconds))
        ? Math.round(Number(activity.durationInSeconds) / 60)
        : null),
    tss: activity.tss ?? workout?.tss ?? null,
    canMove: activity.canMove ?? null,
    recommendationReason: activity.recommendationReason ?? null,
  };
}

function summarizeAlternateWorkout(workout) {
  if (!workout || typeof workout !== "object") return null;
  return {
    workoutId: workout.id ?? null,
    workoutName: workout.workoutName ?? workout.name ?? null,
    durationMinutes: workout.duration ?? null,
    tss: workout.tss ?? null,
    intensityFactor: workout.intensityFactor ?? null,
    prescribedLevel: workout.prescribedLevel ?? null,
    isOutside: workout.isOutside ?? null,
    hasOutsideEquivalent: workout.hasOutsideEquivalent ?? null,
    zoneId: workout.zoneId ?? null,
    profileId: workout.profileId ?? null,
  };
}

async function requirePrivateMember(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  let memberInfo;
  try {
    memberInfo = await client.getMemberInfo();
  } catch {
    throw new Error(
      "This command requires private authenticated mode. Login first with trainerroad-cli login.",
    );
  }
  return { client, memberInfo };
}

async function fetchBeforeAfter(flags, deps, mutate) {
  const { client, memberInfo } = await requirePrivateMember(flags, deps);
  const plannedActivityId = String(requireFlag(flags, "id"));
  const before = await client.getPlannedActivity(plannedActivityId, memberInfo.username);
  const mutation = await mutate({ client, memberInfo, plannedActivityId, before });
  const after = await client.getPlannedActivity(plannedActivityId, memberInfo.username);
  return { client, memberInfo, plannedActivityId, before, after, mutation };
}

export async function commandWorkoutAlternates(flags, deps) {
  const { isJsonMode, writeOutput } = deps;
  const category = String(flags.category ?? "similar").toLowerCase();
  if (!ALTERNATE_CATEGORIES.has(category)) {
    throw new Error(
      `Invalid --category "${category}". Expected one of: ${Array.from(ALTERNATE_CATEGORIES).join(", ")}.`,
    );
  }

  const { client, memberInfo } = await requirePrivateMember(flags, deps);
  const plannedActivityId = String(requireFlag(flags, "id"));
  const plannedActivity = await client.getPlannedActivity(plannedActivityId, memberInfo.username);
  const alternates = await client.getPlannedActivityAlternates(
    plannedActivityId,
    category,
    memberInfo.username,
  );
  const records = (Array.isArray(alternates?.workouts) ? alternates.workouts : [])
    .map((item) => summarizeAlternateWorkout(item))
    .filter(Boolean);

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "workout-alternates",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { plannedActivityId, category },
    plannedActivity: summarizePlannedActivity(plannedActivity),
    count: records.length,
    records,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `Alternates (${value.count}) for ${value.plannedActivity?.workoutName ?? "workout"} [category=${value.query.category}]`,
      ];
      for (const item of value.records) {
        lines.push(
          `- ${item.workoutName ?? "(untitled)"} | workoutId=${item.workoutId} | duration=${item.durationMinutes ?? "?"}m | tss=${item.tss ?? "?"} | outside=${item.isOutside === null ? "?" : item.isOutside}`,
        );
      }
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandMoveWorkout(flags, deps) {
  const { isJsonMode, writeOutput } = deps;
  const newDate = String(requireFlag(flags, "to"));
  const { memberInfo, plannedActivityId, before, after, mutation } = await fetchBeforeAfter(
    flags,
    deps,
    async ({ client, memberInfo, plannedActivityId }) =>
      client.movePlannedActivity(plannedActivityId, newDate, memberInfo.username),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "move-workout",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { plannedActivityId, to: newDate },
    before: summarizePlannedActivity(before),
    after: summarizePlannedActivity(after),
    mutation,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      return `Moved ${value.after?.workoutName ?? "workout"} | plannedActivityId=${value.query.plannedActivityId} | ${value.before?.date ?? "?"} -> ${value.after?.date ?? "?"}`;
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandReplaceWorkout(flags, deps) {
  const { isJsonMode, toBoolean, writeOutput } = deps;
  const alternateWorkoutId = Number(requireFlag(flags, "alternate-id"));
  if (!Number.isFinite(alternateWorkoutId)) {
    throw new Error(`Invalid --alternate-id "${flags["alternate-id"]}". Expected a numeric workout ID.`);
  }
  const updateDuration = toBoolean(flags["update-duration"], false);

  const { memberInfo, plannedActivityId, before, after, mutation } = await fetchBeforeAfter(
    flags,
    deps,
    async ({ client, memberInfo, plannedActivityId }) =>
      client.replacePlannedActivityWithAlternate(plannedActivityId, alternateWorkoutId, {
        updateDuration,
        usernameForReferer: memberInfo.username,
      }),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "replace-workout",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { plannedActivityId, alternateWorkoutId, updateDuration },
    before: summarizePlannedActivity(before),
    after: summarizePlannedActivity(after),
    mutation: summarizePlannedActivity(mutation),
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      return `Replaced workout | plannedActivityId=${value.query.plannedActivityId} | ${value.before?.workoutName ?? "?"} -> ${value.after?.workoutName ?? "?"}`;
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandSwitchWorkout(flags, deps) {
  const { isJsonMode, writeOutput } = deps;
  const mode = String(requireFlag(flags, "mode")).toLowerCase();
  if (!SWITCH_MODES.has(mode)) {
    throw new Error(`Invalid --mode "${mode}". Expected one of: ${Array.from(SWITCH_MODES).join(", ")}.`);
  }

  const { memberInfo, plannedActivityId, before, after, mutation } = await fetchBeforeAfter(
    flags,
    deps,
    async ({ client, memberInfo, plannedActivityId }) =>
      client.switchPlannedActivityMode(plannedActivityId, mode, memberInfo.username),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "switch-workout",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { plannedActivityId, mode },
    before: summarizePlannedActivity(before),
    after: summarizePlannedActivity(after),
    mutation: summarizePlannedActivity(mutation),
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      return `Switched workout | plannedActivityId=${value.query.plannedActivityId} | outside=${value.before?.isOutside} -> ${value.after?.isOutside}`;
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}
