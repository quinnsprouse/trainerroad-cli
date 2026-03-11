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

const CATEGORY_NAME_MAP = {
  climbing: "Climbing",
  endurance: "Endurance",
  attacking: "Attacking",
};

function normalizeCategoryName(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return CATEGORY_NAME_MAP[normalized] ?? null;
}

function summarizeWorkoutInfo(info) {
  if (!info || typeof info !== "object") return null;
  return {
    workoutId: info.id ?? null,
    workoutName: info.name ?? null,
    duration: info.duration ?? null,
    durationMinutes:
      Number.isFinite(Number(info.durationInSeconds)) ? Math.round(Number(info.durationInSeconds) / 60) : null,
    tss: info.tss ?? null,
    intensityFactor: info.intensityFactor ?? null,
    energyKj: info.kj ?? null,
    zoneId: info.progressionId ?? null,
    progressionLevel: info.progressionLevel ?? null,
    workoutDifficultyRating: info.workoutDifficultyRating ?? null,
    isOutside: info.isOutside ?? null,
    profileId: info.profileId ?? null,
    imageUrl: info.picUrl ?? null,
  };
}

function summarizeSuggestion(categoryName, suggestion, workoutInfo) {
  return {
    category: categoryName,
    source: suggestion?.source ?? null,
    workoutId: suggestion?.workoutId ?? workoutInfo?.workoutId ?? null,
    ...workoutInfo,
    predictionMetrics: suggestion?.predictionMetrics ?? {},
  };
}

function flattenSuggestions(suggestions, workoutInfoById, categoryFilter = null) {
  const categories = suggestions && typeof suggestions === "object" ? Object.entries(suggestions) : [];
  const rows = [];
  for (const [categoryName, items] of categories) {
    if (categoryFilter && categoryName !== categoryFilter) continue;
    for (const item of Array.isArray(items) ? items : []) {
      rows.push(
        summarizeSuggestion(
          categoryName,
          item,
          workoutInfoById.get(Number(item?.workoutId)) ?? null,
        ),
      );
    }
  }
  return rows;
}

async function requirePrivateMember(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  try {
    const memberInfo = await client.getMemberInfo();
    return { client, memberInfo };
  } catch {
    throw new Error("train-now requires private authenticated mode. Login first with trainerroad-cli login.");
  }
}

export async function commandTrainNow(flags, deps) {
  const { isJsonMode, requirePositiveInteger, writeOutput } = deps;
  const { client, memberInfo } = await requirePrivateMember(flags, deps);

  const duration = requirePositiveInteger(flags.duration, 60);
  const numSuggestions = requirePositiveInteger(flags["num-suggestions"], 10);
  const categoryFilter = flags.category ? normalizeCategoryName(flags.category) : null;
  if (flags.category && !categoryFilter) {
    throw new Error('Invalid --category. Expected one of: climbing, endurance, attacking.');
  }

  const [status, suggestionsPayload] = await Promise.all([
    client.getTrainNowStatus(memberInfo.username),
    client.getTrainNowSuggestions({ duration, numSuggestions }, memberInfo.username),
  ]);

  const suggestionIds = Array.from(
    new Set(
      Object.values(suggestionsPayload?.suggestions ?? {})
        .flatMap((items) => (Array.isArray(items) ? items : []))
        .map((item) => Number(item?.workoutId))
        .filter((value) => Number.isFinite(value)),
    ),
  );
  const workoutInfo = await client.getWorkoutInformation(suggestionIds, memberInfo.username);
  const workoutInfoById = new Map(
    (Array.isArray(workoutInfo) ? workoutInfo : [])
      .map((item) => [Number(item?.id), summarizeWorkoutInfo(item)])
      .filter(([id]) => Number.isFinite(id)),
  );

  const records = flattenSuggestions(suggestionsPayload?.suggestions, workoutInfoById, categoryFilter);
  const payload = {
    generatedAt: new Date().toISOString(),
    command: "train-now",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { duration, numSuggestions, category: categoryFilter },
    status,
    recommendedCategory: suggestionsPayload?.recommendedCategory ?? null,
    hasRpePredictionServiceFailure: Boolean(suggestionsPayload?.hasRpePredictionServiceFailure),
    count: records.length,
    records,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `TrainNow suggestions (${value.count}) duration=${value.query.duration}m`,
      ];
      for (const item of value.records) {
        lines.push(
          `- [${item.category}] ${item.workoutName ?? "(untitled)"} | workoutId=${item.workoutId} | duration=${item.durationMinutes ?? "?"}m | tss=${item.tss ?? "?"} | level=${item.progressionLevel ?? "?"}`,
        );
      }
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}
