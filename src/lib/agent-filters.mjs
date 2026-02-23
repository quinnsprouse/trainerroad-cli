function toIsoDate(value) {
  if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function toIsoDateFromPlannedRecord(record) {
  return `${String(record.date.year).padStart(4, "0")}-${String(record.date.month).padStart(2, "0")}-${String(record.date.day).padStart(2, "0")}`;
}

function normalizeDateOnlyInput(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`);
  }
  return normalized;
}

function requireNumber(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function requirePositiveInteger(value, fallback) {
  const parsed = requireNumber(value, fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function splitCsv(value) {
  if (value == null || value === true) return [];
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function toLowerOrNull(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function getByPath(object, pathValue) {
  if (!pathValue) return undefined;
  const segments = String(pathValue)
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let cursor = object;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function projectRecordFields(record, fields) {
  const output = {};
  for (const field of fields) {
    const value = getByPath(record, field);
    output[field] = value === undefined ? null : value;
  }
  return output;
}

function resolveRecordDateOnly(record) {
  if (!record || typeof record !== "object") return null;
  if (typeof record.dateOnly === "string") return record.dateOnly;
  if (record.date && typeof record.date === "object" && Number.isFinite(record.date.year)) {
    return toIsoDateFromPlannedRecord(record);
  }
  if (typeof record.date === "string") return toIsoDate(record.date);
  if (typeof record.started === "string") return toIsoDate(record.started);
  if (typeof record.workoutDate === "string") return toIsoDate(record.workoutDate);
  return null;
}

function resolveRecordType(record) {
  if (!record || typeof record !== "object") return null;
  if (record.recordType != null) return record.recordType;
  if (record.type != null) return record.type;
  if (record.activityType != null) return record.activityType;
  if (record.typeId != null) return record.typeId;
  if (record.progressionId != null) return record.progressionId;
  return null;
}

function resolveRecordTss(record) {
  if (!record || typeof record !== "object") return null;
  const candidates = [
    record.tss,
    record.actualTss,
    record.plannedTssTotal,
    record.estimatedTss,
    record.Tss,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function resolveRecordText(record) {
  if (!record || typeof record !== "object") return "";
  const textParts = [
    record.name,
    record.title,
    record.planName,
    record.zoneLabel,
    record.zoneKey,
    record.typeLabel,
    record.workoutRecordName,
    record.recordType,
    record.type,
  ]
    .filter((value) => value != null)
    .map((value) => String(value));
  return textParts.join(" ").toLowerCase();
}

function compareNullableNumbers(a, b) {
  const left = Number.isFinite(a) ? a : null;
  const right = Number.isFinite(b) ? b : null;
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function parseAgentFilterConfig(flags) {
  const fromDate = flags.from ? normalizeDateOnlyInput(flags.from, null) : null;
  const toDate = flags.to ? normalizeDateOnlyInput(flags.to, null) : null;
  const minTss =
    flags["min-tss"] != null && flags["min-tss"] !== true ? Number(flags["min-tss"]) : null;
  const maxTss =
    flags["max-tss"] != null && flags["max-tss"] !== true ? Number(flags["max-tss"]) : null;
  const sort = toLowerOrNull(flags.sort);
  const contains = toLowerOrNull(flags.contains);
  const typeFilters = splitCsv(flags.type).map((value) => value.toLowerCase());
  const fields = splitCsv(flags.fields);
  const resultLimit = requirePositiveInteger(flags["result-limit"], null);
  return {
    fromDate,
    toDate,
    minTss: Number.isFinite(minTss) ? minTss : null,
    maxTss: Number.isFinite(maxTss) ? maxTss : null,
    sort,
    contains,
    typeFilters,
    fields,
    resultLimit,
  };
}

export function applyAgentRecordFilters(records, flags) {
  const config = parseAgentFilterConfig(flags);
  const input = Array.isArray(records) ? records : [];
  let output = [...input];

  if (config.fromDate || config.toDate) {
    output = output.filter((record) => {
      const dateOnly = resolveRecordDateOnly(record);
      if (!dateOnly) return false;
      if (config.fromDate && dateOnly < config.fromDate) return false;
      if (config.toDate && dateOnly > config.toDate) return false;
      return true;
    });
  }

  if (config.typeFilters.length > 0) {
    output = output.filter((record) => {
      const recordTypeRaw = resolveRecordType(record);
      if (recordTypeRaw == null) return false;
      const recordType = String(recordTypeRaw).toLowerCase();
      const numericType = Number(recordTypeRaw);
      return config.typeFilters.some((candidate) => {
        if (candidate === recordType) return true;
        const numericCandidate = Number(candidate);
        return (
          Number.isFinite(numericCandidate) &&
          Number.isFinite(numericType) &&
          numericCandidate === numericType
        );
      });
    });
  }

  if (config.contains) {
    output = output.filter((record) => resolveRecordText(record).includes(config.contains));
  }

  if (config.minTss != null || config.maxTss != null) {
    output = output.filter((record) => {
      const tss = resolveRecordTss(record);
      if (!Number.isFinite(tss)) return false;
      if (config.minTss != null && tss < config.minTss) return false;
      if (config.maxTss != null && tss > config.maxTss) return false;
      return true;
    });
  }

  switch (config.sort) {
    case "date":
      output.sort((a, b) => {
        const left = resolveRecordDateOnly(a) ?? "";
        const right = resolveRecordDateOnly(b) ?? "";
        return left.localeCompare(right);
      });
      break;
    case "date-desc":
      output.sort((a, b) => {
        const left = resolveRecordDateOnly(a) ?? "";
        const right = resolveRecordDateOnly(b) ?? "";
        return right.localeCompare(left);
      });
      break;
    case "tss":
      output.sort((a, b) => compareNullableNumbers(resolveRecordTss(a), resolveRecordTss(b)));
      break;
    case "tss-desc":
      output.sort((a, b) => compareNullableNumbers(resolveRecordTss(b), resolveRecordTss(a)));
      break;
    case "name":
      output.sort((a, b) => resolveRecordText(a).localeCompare(resolveRecordText(b)));
      break;
    case "name-desc":
      output.sort((a, b) => resolveRecordText(b).localeCompare(resolveRecordText(a)));
      break;
    default:
      break;
  }

  if (config.resultLimit != null) {
    output = output.slice(0, config.resultLimit);
  }

  if (config.fields.length > 0) {
    output = output.map((record) => projectRecordFields(record, config.fields));
  }

  const filterSummary = {
    from: config.fromDate,
    to: config.toDate,
    type: config.typeFilters,
    contains: config.contains,
    minTss: config.minTss,
    maxTss: config.maxTss,
    sort: config.sort,
    resultLimit: config.resultLimit,
    fields: config.fields,
    inputCount: input.length,
    outputCount: output.length,
  };

  return { records: output, filterSummary };
}

export function hasAgentRecordTransforms(flags) {
  return Boolean(
    flags.from ||
      flags.to ||
      flags.type ||
      flags.contains ||
      flags["min-tss"] ||
      flags["max-tss"] ||
      flags.sort ||
      flags["result-limit"] ||
      flags.fields,
  );
}

export function toRecordsOnlyPayload(payload) {
  return {
    mode: payload?.mode ?? null,
    generatedAt: payload?.generatedAt ?? new Date().toISOString(),
    command: payload?.command ?? null,
    query: payload?.query ?? null,
    filters: payload?.filters ?? null,
    member: payload?.member ?? null,
    count: Array.isArray(payload?.records) ? payload.records.length : payload?.count ?? 0,
    records: Array.isArray(payload?.records) ? payload.records : [],
    limitations: payload?.limitations ?? undefined,
  };
}
