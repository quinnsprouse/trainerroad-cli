import { Effect, Schema } from "effect"
import type { ParamSpec } from "../contract/contract.ts"
import { defineMutation, defineQuery } from "../contract/contract.ts"
import { CalendarDate } from "../domain/calendar.ts"
import { calendarFollowUp } from "../domain/follow-up.ts"
import { CollectionData, JsonObject, OperationPlan, QueryData } from "../domain/operation.ts"
import { Errors } from "../errors.ts"
import { OperationsReader, OperationsWriter } from "../services/operations.ts"

const flags = {
  sessionFile: {
    kind: "flag",
    type: "path",
    description: "Override the persisted session file path.",
  },
  target: {
    kind: "flag",
    type: "string",
    description: "Public TrainerRoad profile username to query.",
  },
  public: {
    kind: "flag",
    type: "boolean",
    description: "Force public-mode requests even when an authenticated session exists.",
  },
  full: {
    kind: "flag",
    type: "boolean",
    description: "Return fuller upstream payload data when the command supports it.",
  },
  tz: {
    kind: "flag",
    type: "string",
    description: "Override local-day bucketing (defaults to TR_TIMEZONE or system timezone).",
  },
  duration: {
    kind: "flag",
    type: "integer",
    description: "Requested workout duration in minutes.",
  },
  numSuggestions: {
    kind: "flag",
    type: "integer",
    description: "Maximum TrainNow suggestions to request.",
  },
  category: {
    kind: "flag",
    type: "string",
    description: "Command-specific category filter (for example easier, endurance, or outside).",
  },
  from: { kind: "flag", type: "string", description: "Inclusive lower date bound." },
  to: {
    kind: "flag",
    type: "string",
    description: "Inclusive upper date bound or move target date.",
  },
  type: { kind: "flag", type: "string", description: "Command-specific record type filter." },
  contains: { kind: "flag", type: "string", description: "Case-insensitive substring filter." },
  minTss: { kind: "flag", type: "string", description: "Minimum TSS threshold." },
  maxTss: { kind: "flag", type: "string", description: "Maximum TSS threshold." },
  sort: { kind: "flag", type: "string", description: "Command-specific sort mode." },
  resultLimit: {
    kind: "flag",
    type: "integer",
    description: "Limit records after filters are applied.",
  },
  view: {
    kind: "flag",
    type: "choice",
    description: "Plan view to return.",
    choices: ["current", "phases", "plans"],
  },
  date: { kind: "flag", type: "string", description: "Target calendar date." },
  details: {
    kind: "flag",
    type: "boolean",
    description: "Include additional workout/activity detail in the payload.",
  },
  days: { kind: "flag", type: "integer", description: "Relative day window size." },
  limit: {
    kind: "flag",
    type: "integer",
    description: "Upstream or record limit for the command.",
  },
  historyLimit: {
    kind: "flag",
    type: "integer",
    description: "Maximum FTP history entries to include.",
  },
  startDate: { kind: "flag", type: "string", description: "Personal records window start date." },
  endDate: { kind: "flag", type: "string", description: "Personal records window end date." },
  rowType: {
    kind: "flag",
    type: "choice",
    description: "TrainerRoad PR row type to query.",
    choices: ["100", "101"],
  },
  indoorOnly: {
    kind: "flag",
    type: "choice",
    description: "Restrict personal-record queries to indoor rides.",
    choices: ["true", "false"],
  },
  slot: {
    kind: "flag",
    type: "integer",
    description: "Reserved upstream query slot used by the power-records endpoint.",
  },
  search: { kind: "flag", type: "string", description: "Free-text workout search query." },
  zone: { kind: "flag", type: "string", description: "Workout zone name filter." },
  zoneId: { kind: "flag", type: "string", description: "Workout zone numeric identifier." },
  profile: { kind: "flag", type: "string", description: "Workout profile name filter." },
  profileId: { kind: "flag", type: "string", description: "Workout profile numeric identifier." },
  outside: {
    kind: "flag",
    type: "choice",
    description: "Filter or create the outside workout variant where supported.",
    choices: ["true", "false"],
  },
  hasInstructions: {
    kind: "flag",
    type: "choice",
    description: "Filter workouts by whether text instructions exist.",
    choices: ["true", "false"],
  },
  minDuration: { kind: "flag", type: "string", description: "Minimum workout duration." },
  maxDuration: { kind: "flag", type: "string", description: "Maximum workout duration." },
  minLevel: { kind: "flag", type: "string", description: "Minimum workout progression level." },
  maxLevel: { kind: "flag", type: "string", description: "Maximum workout progression level." },
  pageSize: { kind: "flag", type: "integer", description: "Upstream workout library page size." },
  targetDuration: {
    kind: "flag",
    type: "string",
    description: "Target duration used when ranking recommended workouts.",
  },
  targetTss: {
    kind: "flag",
    type: "string",
    description: "Target TSS used when ranking recommended workouts.",
  },
  targetLevel: {
    kind: "flag",
    type: "string",
    description: "Target progression level used when ranking recommended workouts.",
  },
  count: { kind: "flag", type: "integer", description: "Number of recommendations to return." },
  candidateLimit: {
    kind: "flag",
    type: "integer",
    description: "Maximum candidate workouts to score before ranking.",
  },
  id: {
    kind: "flag",
    type: "string",
    description: "Planned activity id from future; not a workout library id.",
  },
  includeChart: {
    kind: "flag",
    type: "choice",
    description: "Include workout chart/sample data in workout-details.",
    choices: ["true", "false"],
  },
  chartPointLimit: {
    kind: "flag",
    type: "integer",
    description: "Maximum chart points returned with --include-chart.",
  },
  workoutId: {
    kind: "flag",
    type: "integer",
    description: "TrainerRoad workout library identifier.",
  },
  alternateId: {
    kind: "flag",
    type: "integer",
    description: "Alternate workout ID to apply during replace-workout.",
  },
  updateDuration: {
    kind: "flag",
    type: "choice",
    description: "Let TrainerRoad update the duration during replace-workout.",
    choices: ["true", "false"],
  },
  mode: {
    kind: "flag",
    type: "choice",
    description: "Target workout delivery mode for switch-workout.",
    choices: ["inside", "outside"],
  },
  name: { kind: "flag", type: "string", description: "Event name shown on the calendar." },
  discipline: {
    kind: "flag",
    type: "string",
    description:
      "Event discipline: gravel, criterium, time-trial, gran-fondo, climbing-road-race, rolling-road-race, cyclocross, xc-olympic, xc-marathon, short-track, gravity, enduro, or a triathlon type; numeric ids accepted.",
  },
  priority: {
    kind: "flag",
    type: "choice",
    description: "Race priority. A drives the plan, C is a training race (default B).",
    choices: ["A", "B", "C"],
  },
  tss: {
    kind: "flag",
    type: "string",
    description: "Expected TSS for the event. Use this or --intensity.",
  },
  intensity: {
    kind: "flag",
    type: "string",
    description: "Expected intensity on TrainerRoad's 1-10 scale. Use this or --tss.",
  },
  notes: {
    kind: "flag",
    type: "string",
    description: "Free-text description stored with the event.",
  },
  title: {
    kind: "flag",
    type: "string",
    description: "Annotation title shown on the calendar. Defaults to the type name.",
  },
  colorId: {
    kind: "flag",
    type: "integer",
    description: "TrainerRoad annotation colour id (default 2).",
  },
} as const satisfies Record<string, ParamSpec>

const errors = [
  "invalid_usage",
  "invalid_data",
  "invalid_config",
  "auth_failure",
  "not_found",
  "service_unavailable",
  "cannot_write",
  "stale_confirmation",
] as const
const decodeRows = Schema.decodeUnknownSync(CollectionData)
const dateFlags = new Set(["date", "from", "to", "start-date", "end-date"])
const numericFlags = new Set([
  "min-tss",
  "max-tss",
  "min-level",
  "max-level",
  "target-level",
  "target-tss",
  "min-duration",
  "max-duration",
  "target-duration",
  "tss",
  "intensity",
])

const inputFlags = Effect.fn("inputFlags")(function* (
  input: Readonly<Record<string, string | number | boolean | undefined>>,
) {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined)
      result[key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase())] = value
  }
  for (const [key, value] of Object.entries(result)) {
    if (dateFlags.has(key))
      yield* Schema.decodeUnknownEffect(CalendarDate)(value).pipe(
        Effect.mapError(() =>
          Errors.invalidUsage({
            message: "invalid date for --" + key,
            fix: "use a real calendar date in YYYY-MM-DD format",
          }),
        ),
      )
    if (typeof value === "number" && (!Number.isInteger(value) || value < 1))
      return yield* Errors.invalidUsage({
        message: "--" + key + " must be a positive integer",
        fix: "provide an integer greater than zero",
      })
    if (
      numericFlags.has(key) &&
      (String(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0)
    )
      return yield* Errors.invalidUsage({
        message: "--" + key + " must be a nonnegative number",
        fix: "provide a finite nonnegative number",
      })
  }
  for (const [start, end] of [
    ["from", "to"],
    ["start-date", "end-date"],
    ["date", "end-date"],
  ] as const) {
    if (
      result[start] !== undefined &&
      result[end] !== undefined &&
      String(result[start]) > String(result[end])
    )
      return yield* Errors.invalidUsage({
        message: "--" + start + " must not be after --" + end,
        fix: "provide an ordered date range",
      })
  }
  if (
    result.intensity !== undefined &&
    (Number(result.intensity) < 1 || Number(result.intensity) > 10)
  )
    return yield* Errors.invalidUsage({
      message: "intensity must be between 1 and 10",
      fix: "provide --intensity 1 to 10, or use --tss",
    })
  if (result.intensity !== undefined && result.tss !== undefined)
    return yield* Errors.invalidUsage({
      message: "provide either tss or intensity, not both",
      fix: "choose one event stress estimate",
    })
  return result
})

interface Definition {
  readonly name: string
  readonly summary: string
  readonly example?: string
  readonly params: Record<string, ParamSpec>
}
const queryCommand = (definition: Definition, fields?: readonly [string, ...string[]]) =>
  defineQuery({
    ...definition,
    stability: "stable",
    dataSchema: fields === undefined ? QueryData : CollectionData,
    domainErrorCodes: errors,
    guides: ["session-and-ids"] as const,
    examples: [
      {
        command: `trainerroad-cli ${definition.name}${definition.example ? " " + definition.example : ""} --json`,
        description: definition.summary,
      },
    ],
    handler: Effect.fn("query.handler")(function* (input) {
      const selected = yield* inputFlags(input)
      const reader = yield* OperationsReader
      const raw = yield* reader.query(definition.name, selected)
      if (fields === undefined)
        return yield* Schema.decodeUnknownEffect(QueryData)(raw).pipe(
          Effect.mapError(() =>
            Errors.invalidData({
              message: "unexpected command result",
              fix: "check the response schema before using this data",
            }),
          ),
        )
      const data = yield* Schema.decodeUnknownEffect(CollectionData)(raw).pipe(
        Effect.mapError(() =>
          Errors.invalidData({
            message: "unexpected collection result",
            fix: "check the response schema before using this data",
          }),
        ),
      )
      return {
        ...data,
        items: data.items.map((row) => ({
          ...Object.fromEntries(fields.map((field) => [field, row[field] ?? null])),
          source: row,
        })),
      }
    }),
    ...(fields === undefined
      ? {}
      : {
          collection: {
            fields: [...fields, "source"],
            items: (data: unknown) => decodeRows(data).items,
          },
        }),
  })
const mutationCommand = (definition: Definition, idempotent: boolean) =>
  defineMutation({
    ...definition,
    stability: "stable",
    planSchema: OperationPlan,
    dataSchema: JsonObject,
    idempotency: { kind: idempotent ? ("always" as const) : ("none" as const) },
    domainErrorCodes: errors,
    guides: ["calendar-changes", "session-and-ids"] as const,
    examples: [
      {
        command: `trainerroad-cli ${definition.name} ${definition.example} --dry-run --json`,
        description: "Preview the change without writing",
      },
    ],
    plan: Effect.fn("mutation.plan")(function* (input) {
      const selected = yield* inputFlags(input)
      const reader = yield* OperationsReader
      return yield* reader.plan(definition.name, selected)
    }),
    apply: Effect.fn("mutation.apply")(function* (plan) {
      const writer = yield* OperationsWriter
      const data = yield* writer.apply(plan)
      return yield* Schema.decodeUnknownEffect(JsonObject)(data).pipe(
        Effect.mapError(() =>
          Errors.cannotWrite({
            message: "write response could not be decoded",
            fix: "read the calendar before retrying",
          }),
        ),
      )
    }),
    next: ({ plan }) => calendarFollowUp(plan),
  })

export const operationContracts = [
  queryCommand({
    name: "timeline",
    summary: "Get profile summary (private full timeline or public TSS-derived summary)",
    params: {
      sessionFile: flags.sessionFile,
      target: flags.target,
      public: flags.public,
      full: flags.full,
      tz: flags.tz,
    },
  }),
  queryCommand(
    {
      name: "train-now",
      summary:
        "Fetch TrainerRoad AI suggested workouts (TrainNow) for a target duration (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        duration: flags.duration,
        numSuggestions: flags.numSuggestions,
        category: flags.category,
        tz: flags.tz,
      },
    },
    [
      "workoutId",
      "workoutName",
      "category",
      "durationMinutes",
      "tss",
      "intensityFactor",
      "progressionLevel",
    ],
  ),
  queryCommand(
    {
      name: "events",
      summary: "Show calendar events/races from timeline (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        from: flags.from,
        to: flags.to,
        type: flags.type,
        contains: flags.contains,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        sort: flags.sort,
        resultLimit: flags.resultLimit,
        full: flags.full,
        tz: flags.tz,
      },
    },
    ["id", "dateOnly", "name", "type", "tss", "racePriority"],
  ),
  queryCommand(
    {
      name: "annotations",
      summary: "Show timeline annotations (time off, notes, illness/injury markers) (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        from: flags.from,
        to: flags.to,
        type: flags.type,
        contains: flags.contains,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        sort: flags.sort,
        resultLimit: flags.resultLimit,
        full: flags.full,
        tz: flags.tz,
      },
    },
    ["id", "dateOnly", "endDateOnly", "title", "text", "typeId", "typeLabel", "durationDays"],
  ),
  queryCommand(
    {
      name: "levels",
      summary: "Show progression levels by zone (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        from: flags.from,
        to: flags.to,
        type: flags.type,
        contains: flags.contains,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        sort: flags.sort,
        resultLimit: flags.resultLimit,
        tz: flags.tz,
      },
    },
    [
      "zoneKey",
      "zoneLabel",
      "progressionId",
      "recentLevel",
      "aiCurrentDisplayLevel",
      "aiProjectedDisplayLevel",
      "aiDelta",
    ],
  ),
  queryCommand(
    {
      name: "plan",
      summary: "Show training plan data (current plan, phases, or all plans) (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        from: flags.from,
        to: flags.to,
        type: flags.type,
        contains: flags.contains,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        sort: flags.sort,
        resultLimit: flags.resultLimit,
        view: flags.view,
        full: flags.full,
        tz: flags.tz,
      },
    },
    ["id", "name", "startDate", "endDate", "planName", "phaseType"],
  ),
  queryCommand(
    {
      name: "weight-history",
      summary: "Show historical body-weight entries (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        from: flags.from,
        to: flags.to,
        type: flags.type,
        contains: flags.contains,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        sort: flags.sort,
        resultLimit: flags.resultLimit,
        tz: flags.tz,
      },
    },
    ["id", "dateOnly", "value", "units"],
  ),
  queryCommand(
    {
      name: "today",
      summary: "Show today's planned/completed activity for private or public profile mode",
      params: {
        sessionFile: flags.sessionFile,
        target: flags.target,
        public: flags.public,
        from: flags.from,
        to: flags.to,
        type: flags.type,
        contains: flags.contains,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        sort: flags.sort,
        resultLimit: flags.resultLimit,
        date: flags.date,
        details: flags.details,
        tz: flags.tz,
      },
    },
    ["id", "date", "started", "name", "tss", "type", "recordType"],
  ),
  queryCommand(
    {
      name: "future",
      summary: "Show future plan data for private or public profile mode",
      params: {
        sessionFile: flags.sessionFile,
        target: flags.target,
        public: flags.public,
        from: flags.from,
        to: flags.to,
        type: flags.type,
        contains: flags.contains,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        sort: flags.sort,
        resultLimit: flags.resultLimit,
        days: flags.days,
        details: flags.details,
        tz: flags.tz,
      },
    },
    ["id", "date", "type", "tss", "workoutId", "name", "durationInSeconds", "workout"],
  ),
  queryCommand(
    {
      name: "past",
      summary: "Show past activity data for private or public profile mode",
      params: {
        sessionFile: flags.sessionFile,
        target: flags.target,
        public: flags.public,
        from: flags.from,
        to: flags.to,
        type: flags.type,
        contains: flags.contains,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        sort: flags.sort,
        resultLimit: flags.resultLimit,
        days: flags.days,
        limit: flags.limit,
        details: flags.details,
        tz: flags.tz,
      },
    },
    ["id", "started", "name", "tss", "durationInSeconds", "recordType"],
  ),
  queryCommand(
    {
      name: "ftp",
      summary: "Show FTP snapshot and FTP history (private or public mode)",
      params: {
        sessionFile: flags.sessionFile,
        target: flags.target,
        public: flags.public,
        historyLimit: flags.historyLimit,
        tz: flags.tz,
      },
    },
    ["date", "dateOnly", "value"],
  ),
  queryCommand(
    {
      name: "ftp-prediction",
      summary: "Show AI FTP detection eligibility/status and progression impact (private mode)",
      params: { sessionFile: flags.sessionFile, tz: flags.tz },
    },
    ["progressionId", "previousDisplayLevel", "displayFinalLevel"],
  ),
  queryCommand(
    {
      name: "power-ranking",
      summary: "Show best-power percentile ranking by duration (private mode)",
      params: { sessionFile: flags.sessionFile, tz: flags.tz },
    },
    ["duration", "wattsRanking", "wattsPerKgRanking"],
  ),
  queryCommand(
    {
      name: "power-records",
      summary: "Show date-range personal power records from TrainerRoad PR endpoint (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        startDate: flags.startDate,
        endDate: flags.endDate,
        rowType: flags.rowType,
        indoorOnly: flags.indoorOnly,
        slot: flags.slot,
        limit: flags.limit,
        full: flags.full,
        tz: flags.tz,
      },
    },
    ["seconds", "watts", "workoutDate", "workoutGuid", "workoutRecordName"],
  ),
  queryCommand(
    {
      name: "workout-library",
      summary: "Search the TrainerRoad workout library with agent-friendly filters (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        search: flags.search,
        zone: flags.zone,
        zoneId: flags.zoneId,
        profile: flags.profile,
        profileId: flags.profileId,
        outside: flags.outside,
        hasInstructions: flags.hasInstructions,
        minDuration: flags.minDuration,
        maxDuration: flags.maxDuration,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        minLevel: flags.minLevel,
        maxLevel: flags.maxLevel,
        sort: flags.sort,
        limit: flags.limit,
        pageSize: flags.pageSize,
        tz: flags.tz,
      },
    },
    [
      "workoutId",
      "workoutName",
      "durationMinutes",
      "tss",
      "intensityFactor",
      "progressionLevel",
      "isOutside",
      "zoneId",
      "profileId",
    ],
  ),
  queryCommand(
    {
      name: "workout-recommend",
      summary:
        "Recommend library workouts by ranking candidates against target duration/level/TSS (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        search: flags.search,
        zone: flags.zone,
        zoneId: flags.zoneId,
        profile: flags.profile,
        profileId: flags.profileId,
        outside: flags.outside,
        hasInstructions: flags.hasInstructions,
        minDuration: flags.minDuration,
        maxDuration: flags.maxDuration,
        minTss: flags.minTss,
        maxTss: flags.maxTss,
        minLevel: flags.minLevel,
        maxLevel: flags.maxLevel,
        targetDuration: flags.targetDuration,
        targetTss: flags.targetTss,
        targetLevel: flags.targetLevel,
        count: flags.count,
        candidateLimit: flags.candidateLimit,
        pageSize: flags.pageSize,
        sort: flags.sort,
        tz: flags.tz,
      },
    },
    [
      "workoutId",
      "workoutName",
      "durationMinutes",
      "tss",
      "intensityFactor",
      "progressionLevel",
      "isOutside",
      "score",
    ],
  ),
  queryCommand({
    name: "workout-details",
    example: "--id 88",
    summary: "Fetch detailed workout-library metadata for a workout ID (private mode)",
    params: {
      sessionFile: flags.sessionFile,
      id: { ...flags.workoutId, required: true },
      includeChart: flags.includeChart,
      chartPointLimit: flags.chartPointLimit,
      tz: flags.tz,
    },
  }),
  mutationCommand(
    {
      name: "add-workout",
      example: "--workout-id 88 --date 2026-09-12",
      summary:
        "Add a library workout on a target date and verify its calendar record (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        workoutId: { ...flags.workoutId, required: true },
        date: { ...flags.date, required: true },
        outside: flags.outside,
        tz: flags.tz,
      },
    },
    false,
  ),
  mutationCommand(
    {
      name: "copy-workout",
      example: "--id planned-1 --date 2026-09-12",
      summary: "Copy an existing planned workout to another date (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        id: { ...flags.id, required: true },
        date: { ...flags.date, required: true },
        tz: flags.tz,
      },
    },
    false,
  ),
  queryCommand(
    {
      name: "workout-alternates",
      example: "--id planned-1",
      summary: "List alternate workout options for a planned workout (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        id: { ...flags.id, required: true },
        category: flags.category,
        tz: flags.tz,
      },
    },
    [
      "workoutId",
      "workoutName",
      "durationMinutes",
      "tss",
      "intensityFactor",
      "prescribedLevel",
      "isOutside",
    ],
  ),
  mutationCommand(
    {
      name: "replace-workout",
      example: "--id planned-1 --alternate-id 99",
      summary: "Replace a planned workout with a specific alternate workout ID (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        id: { ...flags.id, required: true },
        alternateId: { ...flags.alternateId, required: true },
        updateDuration: flags.updateDuration,
        tz: flags.tz,
      },
    },
    true,
  ),
  mutationCommand(
    {
      name: "switch-workout",
      example: "--id planned-1 --mode outside",
      summary: "Switch a planned workout between inside and outside variants (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        id: { ...flags.id, required: true },
        mode: { ...flags.mode, required: true },
        tz: flags.tz,
      },
    },
    true,
  ),
  mutationCommand(
    {
      name: "add-event",
      example: "--name Fixture --date 2026-09-12 --discipline gravel --duration 60 --tss 50",
      summary:
        "Add a race or event to the calendar with discipline, priority, duration, and a TSS or intensity estimate. Remove it later with remove-workou",
      params: {
        sessionFile: flags.sessionFile,
        name: { ...flags.name, required: true },
        date: { ...flags.date, required: true },
        discipline: { ...flags.discipline, required: true },
        priority: flags.priority,
        duration: { ...flags.duration, required: true },
        tss: flags.tss,
        intensity: flags.intensity,
        notes: flags.notes,
        full: flags.full,
        tz: flags.tz,
      },
    },
    false,
  ),
  mutationCommand(
    {
      name: "remove-workout",
      example: "--id planned-1",
      summary:
        "Remove a planned workout or event from the calendar by planned-activity id. TrainerRoad may rebuild the plan around the gap (private mode)",
      params: { sessionFile: flags.sessionFile, id: { ...flags.id, required: true }, tz: flags.tz },
    },
    true,
  ),
  queryCommand({
    name: "annotation-details",
    example: "--id note-1",
    summary: "Fetch one calendar annotation with its title and notes (private mode)",
    params: {
      sessionFile: flags.sessionFile,
      id: {
        ...flags.id,
        required: true,
        description: "Annotation id from annotations; not a planned activity id.",
      },
      full: flags.full,
      tz: flags.tz,
    },
  }),
  mutationCommand(
    {
      name: "add-annotation",
      example: "--type time-off --date 2026-09-12",
      summary:
        "Add a calendar annotation: time off, illness, injury, or a note. Multi-day via --days or --end-date. TrainerRoad may adapt nearby workouts (",
      params: {
        sessionFile: flags.sessionFile,
        type: { ...flags.type, required: true },
        date: { ...flags.date, required: true },
        days: flags.days,
        endDate: flags.endDate,
        title: flags.title,
        notes: flags.notes,
        colorId: flags.colorId,
        tz: flags.tz,
      },
    },
    false,
  ),
  mutationCommand(
    {
      name: "remove-annotation",
      example: "--id note-1",
      summary: "Remove a calendar annotation by id. No-op if it is already gone (private mode)",
      params: {
        sessionFile: flags.sessionFile,
        id: {
          ...flags.id,
          required: true,
          description: "Annotation id from annotations; not a planned activity id.",
        },
        tz: flags.tz,
      },
    },
    true,
  ),
]
