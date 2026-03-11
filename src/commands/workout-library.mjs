const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_LIMIT = 50;

const DURATION_BUCKETS = [
  { key: "lessThanFortyFive", min: 0, max: 44 },
  { key: "fortyFive", min: 45, max: 45 },
  { key: "oneHour", min: 60, max: 60 },
  { key: "oneHourFifteen", min: 75, max: 75 },
  { key: "oneHourThirty", min: 90, max: 90 },
  { key: "oneHourFortyFive", min: 105, max: 105 },
  { key: "twoHours", min: 120, max: 120 },
  { key: "twoHoursFifteen", min: 135, max: 135 },
  { key: "twoHoursThirty", min: 150, max: 150 },
  { key: "moreThanTwoHoursThirty", min: 151, max: Number.POSITIVE_INFINITY },
];

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

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

function toCatalog(profilesByZone) {
  const rows = Array.isArray(profilesByZone) ? profilesByZone : [];
  return rows.map((zone) => ({
    zoneId: zone.id ?? null,
    zoneName: zone.name ?? null,
    profiles: (Array.isArray(zone.workoutProfileOptions) ? zone.workoutProfileOptions : []).map((profile) => ({
      profileId: profile.id ?? null,
      profileName: profile.name ?? null,
      durations: Array.isArray(profile.durations) ? profile.durations : [],
    })),
  }));
}

function resolveIdsByNameOrId(kind, catalog, rawNames, rawIds, valueGetter) {
  const explicitIds = splitCsv(rawIds)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (explicitIds.length > 0) return explicitIds;

  const names = splitCsv(rawNames);
  if (names.length === 0) return [];

  const resolved = [];
  for (const name of names) {
    const normalized = name.toLowerCase();
    const exactMatches = catalog.filter((item) => {
      const label = String(valueGetter(item) ?? "").toLowerCase();
      return label === normalized;
    });
    const matches =
      exactMatches.length > 0
        ? exactMatches
        : catalog.filter((item) => {
            const label = String(valueGetter(item) ?? "").toLowerCase();
            return label.includes(normalized);
          });
    if (matches.length === 0) {
      throw new Error(`No ${kind} matched "${name}".`);
    }
    if (matches.length > 1) {
      const labels = matches.map((item) => valueGetter(item)).join(", ");
      throw new Error(`Ambiguous ${kind} "${name}". Matches: ${labels}`);
    }
    resolved.push(matches[0].id);
  }

  return resolved;
}

function buildDurationFilter(minDuration, maxDuration) {
  const out = Object.fromEntries(DURATION_BUCKETS.map((bucket) => [bucket.key, false]));
  if (minDuration == null && maxDuration == null) return out;

  for (const bucket of DURATION_BUCKETS) {
    const overlapsMin = minDuration == null || bucket.max >= minDuration;
    const overlapsMax = maxDuration == null || bucket.min <= maxDuration;
    if (overlapsMin && overlapsMax) out[bucket.key] = true;
  }
  return out;
}

export function summarizeWorkout(workout) {
  if (!workout || typeof workout !== "object") return null;
  return {
    workoutId: workout.id ?? null,
    workoutName: workout.workoutName ?? workout.name ?? null,
    zoneId: workout.progressionId ?? workout.zoneId ?? workout.progression?.id ?? null,
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

function matchesNumberRange(value, min, max) {
  if (!Number.isFinite(Number(value))) return false;
  const numeric = Number(value);
  if (min != null && numeric < min) return false;
  if (max != null && numeric > max) return false;
  return true;
}

function applyLocalFilters(records, query) {
  return records.filter((item) => {
    if (query.outside != null && item.isOutside !== query.outside) return false;
    if (query.hasInstructions != null && item.hasInstructions !== query.hasInstructions) return false;
    if (query.minDuration != null || query.maxDuration != null) {
      if (!matchesNumberRange(item.durationMinutes, query.minDuration, query.maxDuration)) return false;
    }
    if (query.minTss != null || query.maxTss != null) {
      if (!matchesNumberRange(item.tss, query.minTss, query.maxTss)) return false;
    }
    if (query.minLevel != null || query.maxLevel != null) {
      if (!matchesNumberRange(item.progressionLevel, query.minLevel, query.maxLevel)) return false;
    }
    return true;
  });
}

function compareValues(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "string" || typeof right === "string") {
    return String(left).localeCompare(String(right));
  }
  return Number(left) - Number(right);
}

function sortRecords(records, sort) {
  const mode = String(sort ?? "level").toLowerCase();
  const mapping = {
    name: ["workoutName", false],
    "name-desc": ["workoutName", true],
    duration: ["durationMinutes", false],
    "duration-desc": ["durationMinutes", true],
    tss: ["tss", false],
    "tss-desc": ["tss", true],
    level: ["progressionLevel", false],
    "level-desc": ["progressionLevel", true],
  };
  const [field, desc] = mapping[mode] ?? mapping.level;
  return [...records].sort((a, b) => {
    const result = compareValues(a[field], b[field]);
    return desc ? -result : result;
  });
}

function buildServerPredicate({
  pageNumber,
  pageSize,
  sortProperty,
  isDescending,
  searchText,
  zoneIds,
  profileIds,
  outside,
  hasInstructions,
  minDuration,
  maxDuration,
}) {
  return {
    pageNumber,
    pageSize,
    isDescending,
    sortProperty,
    allProfiles: { profileIds: [] },
    custom: { yup: false, nope: false, memberAccessId: 0 },
    durations: buildDurationFilter(minDuration, maxDuration),
    favorite: { yup: false, nope: false, favoriteWorkoutIds: [] },
    progressions: {
      profileIds,
      progressionIds: zoneIds,
      progressionLevels: [],
      adaptiveTrainingVersion: 1000,
      workoutTypeIds: [],
    },
    restrictToTeams: false,
    teamIds: [],
    teamOptions: [],
    workoutDifficultyRatings: {
      productive: false,
      stretch: false,
      breakthrough: false,
      notRecommended: false,
      achievable: false,
      recovery: false,
      adaptiveTrainingVersion: 1000,
    },
    workoutInstructions: {
      yup: hasInstructions === true,
      nope: hasInstructions === false,
    },
    workoutLabels: { workoutLabelIds: [] },
    workoutTags: { workoutTagIds: [] },
    workoutTypes: {
      raceSimulation: false,
      standard: false,
      test: false,
      video: false,
      warmup: false,
      outside: outside === true,
    },
    zoneOptions: [],
    searchText,
  };
}

async function requirePrivateMember(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  try {
    const memberInfo = await client.getMemberInfo();
    return { client, memberInfo };
  } catch {
    throw new Error(
      "workout-library requires private authenticated mode. Login first with trainerroad-cli login.",
    );
  }
}

export async function queryWorkoutLibrary(
  client,
  memberInfo,
  {
    searchText = "",
    zone = null,
    zoneId = null,
    profile = null,
    profileId = null,
    outside = null,
    hasInstructions = null,
    minDuration = null,
    maxDuration = null,
    minTss = null,
    maxTss = null,
    minLevel = null,
    maxLevel = null,
    sort = "level",
    limit = DEFAULT_LIMIT,
    pageSize = DEFAULT_PAGE_SIZE,
  } = {},
) {
  const profilesByZone = await client.getWorkoutProfilesByZone(memberInfo.username);
  const catalog = toCatalog(profilesByZone);
  const flatZones = catalog.map((zone) => ({ id: zone.zoneId, name: zone.zoneName }));
  const flatProfiles = catalog.flatMap((zone) =>
    zone.profiles.map((profile) => ({
      id: profile.profileId,
      name: profile.profileName,
      zoneId: zone.zoneId,
      zoneName: zone.zoneName,
    })),
  );

  const zoneIds = resolveIdsByNameOrId("zone", flatZones, zone, zoneId, (item) => item.name);
  const profileCatalog =
    zoneIds.length > 0 ? flatProfiles.filter((item) => zoneIds.includes(item.zoneId)) : flatProfiles;
  const profileIds = resolveIdsByNameOrId(
    "profile",
    profileCatalog,
    profile,
    profileId,
    (item) => item.name,
  );

  const normalizedSearchText = String(searchText ?? "").trim();
  const serverSortMode = sort === "name" || sort === "name-desc" ? "name" : "progressionLevel";
  const isDescending = sort.endsWith("-desc");
  const normalizedPageSize = Math.min(100, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
  const normalizedLimit = Math.max(1, Number(limit) || DEFAULT_LIMIT);

  let pageNumber = 0;
  let serverTotalCount = null;
  let fetchedRecords = [];
  let pagesFetched = 0;
  const localFilterQuery = {
    outside,
    hasInstructions,
    minDuration,
    maxDuration,
    minTss,
    maxTss,
    minLevel,
    maxLevel,
  };

  while (true) {
    const predicate = buildServerPredicate({
      pageNumber,
      pageSize: normalizedPageSize,
      sortProperty: serverSortMode,
      isDescending,
      searchText: normalizedSearchText,
      zoneIds,
      profileIds,
      outside,
      hasInstructions,
      minDuration,
      maxDuration,
    });
    const payload = await client.searchWorkoutLibrary(predicate, memberInfo.username);
    const rawWorkouts = Array.isArray(payload?.workouts) ? payload.workouts : [];
    const summarized = rawWorkouts.map((item) => summarizeWorkout(item)).filter(Boolean);
    fetchedRecords.push(...summarized);
    pagesFetched += 1;

    const totalCount = Number(payload?.predicate?.totalCount);
    if (Number.isFinite(totalCount)) serverTotalCount = totalCount;
    if (applyLocalFilters(fetchedRecords, localFilterQuery).length >= normalizedLimit) break;
    if (rawWorkouts.length < normalizedPageSize) break;
    if (serverTotalCount != null && (pageNumber + 1) * normalizedPageSize >= serverTotalCount) break;
    pageNumber += 1;
  }

  const filtered = sortRecords(
    applyLocalFilters(fetchedRecords, localFilterQuery),
    sort,
  ).slice(0, normalizedLimit);

  return {
    query: {
      searchText: normalizedSearchText,
      zoneIds,
      profileIds,
      outside,
      hasInstructions,
      minDuration,
      maxDuration,
      minTss,
      maxTss,
      minLevel,
      maxLevel,
      sort,
      limit: normalizedLimit,
      pageSize: normalizedPageSize,
    },
    fetch: {
      pagesFetched,
      fetchedCount: fetchedRecords.length,
      serverTotalCount,
    },
    catalog,
    records: filtered,
  };
}

export async function commandWorkoutLibrary(flags, deps) {
  const {
    isJsonMode,
    requirePositiveInteger,
    requireNumber,
    toBoolean,
    writeOutput,
  } = deps;

  const { client, memberInfo } = await requirePrivateMember(flags, deps);
  const library = await queryWorkoutLibrary(client, memberInfo, {
    searchText: flags.search,
    zone: flags.zone,
    zoneId: flags["zone-id"],
    profile: flags.profile,
    profileId: flags["profile-id"],
    outside: flags.outside == null ? null : toBoolean(flags.outside, false),
    hasInstructions:
      flags["has-instructions"] == null ? null : toBoolean(flags["has-instructions"], false),
    minDuration: flags["min-duration"] == null ? null : requireNumber(flags["min-duration"], null),
    maxDuration: flags["max-duration"] == null ? null : requireNumber(flags["max-duration"], null),
    minTss: flags["min-tss"] == null ? null : requireNumber(flags["min-tss"], null),
    maxTss: flags["max-tss"] == null ? null : requireNumber(flags["max-tss"], null),
    minLevel: flags["min-level"] == null ? null : requireNumber(flags["min-level"], null),
    maxLevel: flags["max-level"] == null ? null : requireNumber(flags["max-level"], null),
    sort: String(flags.sort ?? "level"),
    limit: requirePositiveInteger(flags.limit, DEFAULT_LIMIT),
    pageSize: requirePositiveInteger(flags["page-size"], DEFAULT_PAGE_SIZE),
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "workout-library",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    ...library,
    count: library.records.length,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `Workout library (${value.count}) search="${value.query.searchText}" fetched=${value.fetch.fetchedCount}/${value.fetch.serverTotalCount ?? "?"}`,
      ];
      for (const item of value.records) {
        lines.push(
          `- ${item.workoutName ?? "(untitled)"} | workoutId=${item.workoutId} | zone=${item.zoneName ?? item.zoneId ?? "?"} | profile=${item.profileName ?? item.profileId ?? "?"} | duration=${item.durationMinutes ?? "?"}m | level=${item.progressionLevel ?? "?"} | tss=${item.tss ?? "?"} | outside=${item.isOutside}`,
        );
      }
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}
