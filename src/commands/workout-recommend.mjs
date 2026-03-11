import { queryWorkoutLibrary } from "./workout-library.mjs";

async function requirePrivateMember(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  try {
    const memberInfo = await client.getMemberInfo();
    return { client, memberInfo };
  } catch {
    throw new Error(
      "workout-recommend requires private authenticated mode. Login first with trainerroad-cli login.",
    );
  }
}

function numericOrNull(value, deps) {
  if (value == null) return null;
  return deps.requireNumber(value, null);
}

function deriveTarget(explicit, min, max) {
  if (explicit != null) return explicit;
  if (min != null && max != null) return (min + max) / 2;
  return null;
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "string" || typeof right === "string") {
    return String(left).localeCompare(String(right));
  }
  return Number(left) - Number(right);
}

function scoreWorkout(item, targets) {
  let score = 0;
  const reasons = [];

  if (targets.level != null && item.progressionLevel != null) {
    const delta = Math.abs(item.progressionLevel - targets.level);
    score += delta * 10;
    reasons.push({ metric: "level", target: targets.level, actual: item.progressionLevel, delta });
  }

  if (targets.duration != null && item.durationMinutes != null) {
    const delta = Math.abs(item.durationMinutes - targets.duration);
    score += delta / 5;
    reasons.push({ metric: "duration", target: targets.duration, actual: item.durationMinutes, delta });
  }

  if (targets.tss != null && item.tss != null) {
    const delta = Math.abs(item.tss - targets.tss);
    score += delta / 10;
    reasons.push({ metric: "tss", target: targets.tss, actual: item.tss, delta });
  }

  if (targets.searchText) {
    const text = String(item.workoutName ?? "").toLowerCase();
    const query = String(targets.searchText).toLowerCase();
    if (text === query) score -= 2;
    else if (text.includes(query)) score -= 1;
  }

  if (item.hasInstructions) score -= 0.15;
  if (item.isOutside === false) score -= 0.05;

  return { score, reasons };
}

export async function commandWorkoutRecommend(flags, deps) {
  const { isJsonMode, requirePositiveInteger, requireNumber, toBoolean, writeOutput } = deps;
  const { client, memberInfo } = await requirePrivateMember(flags, deps);

  const count = requirePositiveInteger(flags.count, 5);
  const candidateLimit = requirePositiveInteger(flags["candidate-limit"], 100);
  const minDuration = numericOrNull(flags["min-duration"], deps);
  const maxDuration = numericOrNull(flags["max-duration"], deps);
  const minTss = numericOrNull(flags["min-tss"], deps);
  const maxTss = numericOrNull(flags["max-tss"], deps);
  const minLevel = numericOrNull(flags["min-level"], deps);
  const maxLevel = numericOrNull(flags["max-level"], deps);
  const targetDuration = deriveTarget(numericOrNull(flags["target-duration"], deps), minDuration, maxDuration);
  const targetTss = deriveTarget(numericOrNull(flags["target-tss"], deps), minTss, maxTss);
  const targetLevel = deriveTarget(numericOrNull(flags["target-level"], deps), minLevel, maxLevel);
  const searchText = String(flags.search ?? "").trim();

  const library = await queryWorkoutLibrary(client, memberInfo, {
    searchText,
    zone: flags.zone,
    zoneId: flags["zone-id"],
    profile: flags.profile,
    profileId: flags["profile-id"],
    outside: flags.outside == null ? null : toBoolean(flags.outside, false),
    hasInstructions:
      flags["has-instructions"] == null ? null : toBoolean(flags["has-instructions"], false),
    minDuration,
    maxDuration,
    minTss,
    maxTss,
    minLevel,
    maxLevel,
    sort: String(flags.sort ?? "level"),
    limit: candidateLimit,
    pageSize: requirePositiveInteger(flags["page-size"], 50),
  });

  const targets = {
    duration: targetDuration,
    tss: targetTss,
    level: targetLevel,
    searchText,
  };

  const recommendations = library.records
    .map((item) => {
      const ranking = scoreWorkout(item, targets);
      return { ...item, recommendationScore: ranking.score, rationale: ranking.reasons };
    })
    .sort(
      (a, b) =>
        compareValues(a.recommendationScore, b.recommendationScore) ||
        compareValues(a.progressionLevel, b.progressionLevel) ||
        compareValues(a.durationMinutes, b.durationMinutes) ||
        compareValues(a.workoutName, b.workoutName),
    )
    .slice(0, count);

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "workout-recommend",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: {
      searchText,
      zone: flags.zone ?? null,
      zoneId: flags["zone-id"] ?? null,
      profile: flags.profile ?? null,
      profileId: flags["profile-id"] ?? null,
      outside: flags.outside ?? null,
      hasInstructions: flags["has-instructions"] ?? null,
      minDuration,
      maxDuration,
      minTss,
      maxTss,
      minLevel,
      maxLevel,
      targetDuration,
      targetTss,
      targetLevel,
      count,
      candidateLimit,
    },
    fetch: library.fetch,
    recommendationCount: recommendations.length,
    records: recommendations,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `Workout recommendations (${value.recommendationCount}) candidates=${value.fetch.fetchedCount}/${value.fetch.serverTotalCount ?? "?"}`,
      ];
      for (const item of value.records) {
        lines.push(
          `- ${item.workoutName ?? "(untitled)"} | workoutId=${item.workoutId} | score=${item.recommendationScore.toFixed(2)} | level=${item.progressionLevel ?? "?"} | duration=${item.durationMinutes ?? "?"}m | tss=${item.tss ?? "?"}`,
        );
      }
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}
