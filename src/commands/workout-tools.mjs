function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeWorkout(workout) {
  if (!workout || typeof workout !== "object") return null;
  return {
    workoutId: workout.id ?? null,
    workoutName: workout.workoutName ?? workout.name ?? null,
    zoneId: workout.progressionId ?? workout.progression?.id ?? null,
    zoneName: workout.progression?.text ?? null,
    profileId: workout.profileId ?? null,
    profileName: workout.profileName ?? null,
    durationMinutes: workout.duration ?? null,
    tss: workout.tss ?? null,
    intensityFactor: workout.intensityFactor ?? null,
    averageFtpPercent: workout.averageFtpPercent ?? null,
    progressionLevel: workout.progressionLevel ?? null,
    workoutDifficultyRating: workout.workoutDifficultyRating ?? null,
    workoutTypeId: workout.workoutTypeId ?? null,
    workoutLabelId: workout.workoutLabelId ?? null,
    isOutside: workout.isOutside ?? null,
    hasInstructions: workout.hasInstructions ?? null,
    firstPublishDate: workout.firstPublishDate ?? null,
    indoorAlternativeId: workout.indoorAlternativeId ?? null,
    energyKj: workout.kj ?? null,
    goal: stripHtml(workout.goalDescription),
    description: stripHtml(workout.workoutDescription),
  };
}

function summarizePlannedActivity(activity) {
  if (!activity || typeof activity !== "object") return null;
  const workout = activity.workout ?? null;
  const date = activity.date
    ? `${String(activity.date.year).padStart(4, "0")}-${String(activity.date.month).padStart(2, "0")}-${String(activity.date.day).padStart(2, "0")}`
    : null;
  return {
    plannedActivityId: activity.id ?? null,
    date,
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
    recommendationReason: activity.recommendationReason ?? null,
    modified: activity.modified ?? null,
  };
}

function summarizeLevels(levelsPayload) {
  return {
    workoutLevels: Array.isArray(levelsPayload?.workoutLevels) ? levelsPayload.workoutLevels : [],
    athleteLevels:
      levelsPayload && typeof levelsPayload.athleteLevels === "object" ? levelsPayload.athleteLevels : {},
  };
}

function summarizeChart(chartData, pointLimit = 200) {
  const rawPoints = Array.isArray(chartData?.courseData) ? chartData.courseData : [];
  const pointsUseMilliseconds =
    rawPoints.length > 1 && Number(rawPoints[1]?.seconds) >= 1000 && Number(rawPoints[1]?.seconds) % 1000 === 0;
  const points = rawPoints.map((point) => ({
    ...point,
    seconds:
      pointsUseMilliseconds && Number.isFinite(Number(point?.seconds))
        ? Number(point.seconds) / 1000
        : point?.seconds ?? null,
  }));
  let minPercent = null;
  let maxPercent = null;
  let durationSeconds = 0;
  for (const point of points) {
    const ftpPercent = Number(point?.ftpPercent);
    if (Number.isFinite(ftpPercent)) {
      minPercent = minPercent == null ? ftpPercent : Math.min(minPercent, ftpPercent);
      maxPercent = maxPercent == null ? ftpPercent : Math.max(maxPercent, ftpPercent);
    }
    const seconds = Number(point?.seconds);
    if (Number.isFinite(seconds)) durationSeconds = Math.max(durationSeconds, seconds);
  }
  return {
    pointCount: points.length,
    durationSeconds,
    minFtpPercent: minPercent,
    maxFtpPercent: maxPercent,
    points: points.slice(0, pointLimit),
  };
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required flag --${name}.`);
  }
  return value;
}

async function requirePrivateMember(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  try {
    const memberInfo = await client.getMemberInfo();
    return { client, memberInfo };
  } catch {
    throw new Error(
      "This command requires private authenticated mode. Login first with trainerroad-cli login.",
    );
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function findPlannedWorkoutOnDate(client, memberInfo, dateIso, workoutId) {
  const timeline = await client.getTimeline(memberInfo.memberId, memberInfo.username);
  const candidateIds = (Array.isArray(timeline?.plannedActivities) ? timeline.plannedActivities : [])
    .filter((item) => {
      const date = item?.date;
      const asIso = date
        ? `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`
        : null;
      return asIso === dateIso;
    })
    .map((item) => item.id)
    .filter(Boolean);

  if (candidateIds.length === 0) return null;
  const details = await client.getPlannedActivitiesByIds(
    memberInfo.memberId,
    memberInfo.username,
    candidateIds,
  );
  const matches = details.filter((item) => Number(item?.workout?.id) === Number(workoutId));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => String(b.modified ?? "").localeCompare(String(a.modified ?? "")))[0];
}

async function listPlannedWorkoutsOnDate(client, memberInfo, dateIso) {
  const timeline = await client.getTimeline(memberInfo.memberId, memberInfo.username);
  const candidateIds = (Array.isArray(timeline?.plannedActivities) ? timeline.plannedActivities : [])
    .filter((item) => {
      const date = item?.date;
      const asIso = date
        ? `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`
        : null;
      return asIso === dateIso;
    })
    .map((item) => item.id)
    .filter(Boolean);

  if (candidateIds.length === 0) return [];
  return client.getPlannedActivitiesByIds(memberInfo.memberId, memberInfo.username, candidateIds);
}

export async function commandWorkoutDetails(flags, deps) {
  const { isJsonMode, requirePositiveInteger, toBoolean, writeOutput } = deps;
  const workoutId = Number(requireFlag(flags, "id"));
  if (!Number.isFinite(workoutId)) {
    throw new Error(`Invalid --id "${flags.id}". Expected a numeric workout ID.`);
  }

  const includeChart = toBoolean(flags["include-chart"], false);
  const chartPointLimit = requirePositiveInteger(flags["chart-point-limit"], 200);
  const { client, memberInfo } = await requirePrivateMember(flags, deps);

  const [byIdRows, summaryPayload, levelsPayload, chartData] = await Promise.all([
    client.getWorkoutsByIds([workoutId], memberInfo.username),
    client.getWorkoutSummary(workoutId, memberInfo.username),
    client.getWorkoutLevels(workoutId, memberInfo.username),
    includeChart ? client.getWorkoutChartData(workoutId, memberInfo.username) : Promise.resolve(null),
  ]);

  const byIdWorkout = Array.isArray(byIdRows) && byIdRows.length > 0 ? byIdRows[0] : null;
  const summaryWorkout = summaryPayload?.summary ?? null;
  const workout = summarizeWorkout(summaryWorkout ?? byIdWorkout);
  const payload = {
    generatedAt: new Date().toISOString(),
    command: "workout-details",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { workoutId, includeChart, chartPointLimit },
    workout,
    levels: summarizeLevels(levelsPayload),
    chart: includeChart ? summarizeChart(chartData, chartPointLimit) : undefined,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `${value.workout?.workoutName ?? "Workout"} | workoutId=${value.query.workoutId} | zone=${value.workout?.zoneName ?? value.workout?.zoneId ?? "?"} | profile=${value.workout?.profileName ?? value.workout?.profileId ?? "?"}`,
        `duration=${value.workout?.durationMinutes ?? "?"}m | tss=${value.workout?.tss ?? "?"} | if=${value.workout?.intensityFactor ?? "?"} | level=${value.workout?.progressionLevel ?? "?"} | outside=${value.workout?.isOutside}`,
      ];
      if (value.chart) {
        lines.push(
          `chart: points=${value.chart.pointCount} duration=${value.chart.durationSeconds}s ftp%=${value.chart.minFtpPercent ?? "?"}-${value.chart.maxFtpPercent ?? "?"}`,
        );
      }
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandAddWorkout(flags, deps) {
  const { isJsonMode, toBoolean, writeOutput } = deps;
  const workoutId = Number(requireFlag(flags, "workout-id"));
  const dateIso = String(requireFlag(flags, "date"));
  if (!Number.isFinite(workoutId)) {
    throw new Error(`Invalid --workout-id "${flags["workout-id"]}". Expected a numeric workout ID.`);
  }

  const outside = toBoolean(flags.outside, false);
  const { client, memberInfo } = await requirePrivateMember(flags, deps);
  const workoutRows = await client.getWorkoutsByIds([workoutId], memberInfo.username);
  const workout = summarizeWorkout(Array.isArray(workoutRows) ? workoutRows[0] : null);
  if (!workout) {
    throw new Error(`Workout ${workoutId} was not found in the library.`);
  }

  const attempts = await client.tryAddWorkoutToCalendar(workoutId, dateIso, {
    outside,
    usernameForReferer: memberInfo.username,
  });

  let created = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    created = await findPlannedWorkoutOnDate(client, memberInfo, dateIso, workoutId);
    if (created) break;
    await sleep(750);
  }

  if (!created) {
    throw new Error(
      `TrainerRoad did not expose a confirmed added workout for ${dateIso}. Attempts: ${JSON.stringify(attempts)}`,
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "add-workout",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { workoutId, date: dateIso, outside },
    workout,
    created: summarizePlannedActivity(created),
    attempts,
    warnings: attempts.some((item) => !item.ok)
      ? [
          "TrainerRoad returned one or more non-2xx responses during add-workout, but the workout was observed on the calendar after reconciliation.",
        ]
      : [],
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const warning = value.warnings.length > 0 ? " | warning=server-status-mismatch" : "";
      return `Added ${value.workout?.workoutName ?? "workout"} to ${value.query.date} | plannedActivityId=${value.created?.plannedActivityId}${warning}`;
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandCopyWorkout(flags, deps) {
  const { isJsonMode, writeOutput } = deps;
  const sourcePlannedActivityId = String(requireFlag(flags, "id"));
  const targetDate = String(requireFlag(flags, "date"));
  const { client, memberInfo } = await requirePrivateMember(flags, deps);
  const source = await client.getPlannedActivity(sourcePlannedActivityId, memberInfo.username);
  const beforeTarget = await listPlannedWorkoutsOnDate(client, memberInfo, targetDate);
  const beforeIds = new Set(beforeTarget.map((item) => item.id));

  const mutation = await client.copyPlannedActivity(sourcePlannedActivityId, targetDate, memberInfo.username);

  let created = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const afterTarget = await listPlannedWorkoutsOnDate(client, memberInfo, targetDate);
    created = afterTarget.find(
      (item) =>
        !beforeIds.has(item.id) &&
        Number(item?.workout?.id) === Number(source?.workout?.id),
    );
    if (created) break;
    await sleep(500);
  }

  if (!created) {
    throw new Error(
      `Copy completed but no new planned workout was found on ${targetDate} for source ${sourcePlannedActivityId}.`,
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "copy-workout",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { sourcePlannedActivityId, date: targetDate },
    source: summarizePlannedActivity(source),
    created: summarizePlannedActivity(created),
    mutation,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      return `Copied ${value.source?.workoutName ?? "workout"} to ${value.query.date} | plannedActivityId=${value.created?.plannedActivityId}`;
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}
