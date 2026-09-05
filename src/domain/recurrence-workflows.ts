import { Schema } from "effect"
import { planToken } from "../contract/token.ts"
import { Errors } from "../errors.ts"
import { CalendarDate, Id } from "./calendar.ts"
import type { Flags, JsonObject } from "./operation.ts"
import { follow, get, record, required, segment, send, value, type Workflow } from "./workflow.ts"

// calendar.api-6rqftorl.js returns occurrence arrays. Match them to the member's
// timeline before exposing details; a series id alone does not establish ownership.
const invalid = (message: string): never => {
  throw Errors.invalidData({
    message,
    fix: "refresh recurrence discovery; use TrainerRoad if the response remains unsupported",
  })
}
const date = (input: Flags, key: string): string => {
  const result = value(input, key)
  if (!Schema.is(CalendarDate)(result))
    throw Errors.invalidUsage({
      message: `${key} must be a real YYYY-MM-DD date`,
      fix: "provide an explicit calendar date window",
    })
  return result
}
const windowParams = {
  from: required("First day of the discovery window, YYYY-MM-DD"),
  to: required("Last day of the discovery window, YYYY-MM-DD"),
}
const validateWindow = (input: Flags) => {
  if (date(input, "from") > date(input, "to"))
    throw Errors.invalidUsage({
      message: "from must not be after to",
      fix: "provide an ordered date window",
    })
}
const dateOnly = (raw: Schema.Json | undefined): string => {
  let candidate: string
  if (typeof raw === "string") {
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(raw))
      return invalid("unsupported recurrence date")
    candidate = raw.slice(0, 10)
  } else {
    const parts = record(raw)
    if (
      typeof parts.year !== "number" ||
      typeof parts.month !== "number" ||
      typeof parts.day !== "number" ||
      ![parts.year, parts.month, parts.day].every(Number.isInteger)
    )
      return invalid("unsupported recurrence date parts")
    candidate = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
  }
  return Schema.is(CalendarDate)(candidate) ? candidate : invalid("invalid recurrence date")
}
const rows = (raw: Schema.Json | undefined): JsonObject[] => {
  if (!Array.isArray(raw)) return invalid("expected a recurrence collection")
  return raw.map(record)
}
const identity = (item: JsonObject) => {
  if (
    !Schema.is(Id)(item.id) ||
    typeof item.index !== "number" ||
    !Number.isSafeInteger(item.index) ||
    item.index < 0
  )
    return invalid("recurrence is missing its series id or occurrence index")
  if (String(item.id).includes("§§") || String(item.id) === "." || String(item.id) === "..")
    return invalid("expected a series id, not an occurrence id or path segment")
  return { id: item.id, index: item.index }
}
const pick = (item: JsonObject, keys: readonly string[]): JsonObject =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const field = item[key]
      if (field === undefined) return []
      if (
        field !== null &&
        typeof field !== "string" &&
        typeof field !== "boolean" &&
        !(typeof field === "number" && Number.isFinite(field))
      )
        return invalid(`unsupported recurrence ${key}`)
      return [[key, field]]
    }),
  )
const inWindow = (day: string, input: Flags) =>
  day >= date(input, "from") && day <= date(input, "to")
const timeline = (raw: Schema.Json | undefined, input: Flags): JsonObject[] => {
  const seen = new Set<string>()
  return rows(record(raw).recurringActivities)
    .map((item) => {
      const key = identity(item)
      const hash = JSON.stringify([String(key.id), key.index])
      if (seen.has(hash)) return invalid("duplicate recurrence occurrence identity")
      seen.add(hash)
      return {
        ...key,
        date: dateOnly(item.date),
        ...pick(item, [
          "timeOfDay",
          "tss",
          "type",
          "eventType",
          "openType",
          "manuallyCompleted",
          "wasRevealed",
        ]),
      }
    })
    .filter((item) => inWindow(item.date, input))
}
const readTimeline = (input: Flags, memberId: string | number) =>
  get(
    `/app/api/react-calendar/${segment(memberId)}/timeline?start=${date(input, "from")}&end=${date(input, "to")}`,
  )
const windowArgs = (input: Flags) => ["--from", date(input, "from"), "--to", date(input, "to")]
const guidance = () => [
  {
    message:
      "Recurrence edits are not supported here. In TrainerRoad, explicitly choose one occurrence or this and future occurrences; edits may split the series or require multiple writes.",
    args: ["guide", "get", "recurrence-changes", "--json"],
  },
]
const Frequency = Schema.Struct({
  isCustom: Schema.Boolean,
  type: Schema.Literals([0, 1, 2]),
  interval: Schema.Int,
  weekDays: Schema.Int,
  excludedIndices: Schema.Array(Schema.Int),
})
const definition = (raw: Schema.Json | undefined, id: string): JsonObject => {
  const item = record(raw)
  if (!Schema.is(Id)(item.id) || String(item.id) !== id)
    return invalid("recurrence definition belongs to a different series")
  const f = item.frequency
  if (
    !Schema.is(Frequency)(f) ||
    f.interval < 1 ||
    f.weekDays < 0 ||
    f.weekDays > 127 ||
    f.excludedIndices.some((index) => index < 0)
  )
    return invalid("unsupported recurrence frequency")
  let endCriteria: JsonObject | null = null
  if (item.endCriteria != null) {
    const end = record(item.endCriteria)
    endCriteria = {}
    if (end.date != null) endCriteria = { ...endCriteria, date: dateOnly(end.date) }
    if (end.maxRecurrences != null) {
      if (
        typeof end.maxRecurrences !== "number" ||
        !Number.isSafeInteger(end.maxRecurrences) ||
        end.maxRecurrences < 1
      )
        return invalid("unsupported recurrence count")
      endCriteria = { ...endCriteria, maxRecurrences: end.maxRecurrences }
    }
  }
  return {
    id: item.id,
    startDate: dateOnly(item.startDate),
    frequency: {
      isCustom: f.isCustom,
      type: f.type,
      interval: f.interval,
      weekDays: f.weekDays,
      excludedIndices: [...f.excludedIndices],
    },
    endCriteria,
  }
}

const recurrenceReads: readonly Workflow[] = [
  {
    name: "recurring-activities",
    summary: "Discover member-owned recurrence series IDs and occurrence indices in a date window",
    guide: "recurrence-changes",
    params: windowParams,
    example: "--from 2026-09-07 --to 2026-09-14",
    validate: validateWindow,
    reads: (input, member) => ({ timeline: readTimeline(input, member.memberId) }),
    select: (records, input) => ({
      occurrences: timeline(records.timeline, input),
      scope: "selected-window-only",
      coverage: "timeline-recurrence-entries-only",
    }),
    next: (input, session, before) => {
      const ids = [...new Set(rows(before.occurrences).map((item) => String(identity(item).id)))]
      return [
        ...ids
          .slice(0, 2)
          .flatMap((id) =>
            follow(
              "recurrence-state",
              ["--id", id, ...windowArgs(input)],
              session,
              `inspect series ${id} in the same date window`,
            ),
          ),
        ...guidance(),
      ]
    },
  },
  {
    name: "recurrence-state",
    summary: "Read recurrence occurrence details after matching the member's calendar window",
    guide: "recurrence-changes",
    params: {
      id: required("Series ID from recurring-activities, not a composite occurrence ID"),
      ...windowParams,
    },
    example: "--id series-123 --from 2026-09-07 --to 2026-09-14",
    validate: (input) => {
      validateWindow(input)
      const id = value(input, "id")
      segment(id)
      if (id.includes("§§"))
        throw Errors.invalidUsage({
          message: "use the series id, not a composite occurrence id",
          fix: "run recurring-activities with the same date window",
        })
    },
    reads: (input, member) => ({
      timeline: readTimeline(input, member.memberId),
      series: get(`/app/api/react-calendar/recurring-activities/${segment(value(input, "id"))}`),
    }),
    select: (records, input) => {
      const id = value(input, "id")
      const members = timeline(records.timeline, input).filter(
        (item) => String(identity(item).id) === id,
      )
      if (members.length === 0)
        throw Errors.notFound({
          message: "series is absent from this member's selected calendar window",
          fix: "rediscover series IDs or choose a window containing an occurrence",
        })
      const series = rows(records.series)
      const seen = new Set<number>()
      const occurrences = series.flatMap((item) => {
        const key = identity(item)
        if (String(key.id) !== id || seen.has(key.index))
          return invalid("foreign or duplicate recurrence occurrence")
        seen.add(key.index)
        const member = members.find((candidate) => candidate.index === key.index)
        if (!member) return []
        const activity = record(item.activity)
        const day = dateOnly(activity.date)
        if (day !== member.date)
          return invalid("recurrence date disagrees with the member's calendar; refresh both reads")
        return [
          {
            ...key,
            definition: definition(item.definition, id),
            activity: {
              date: day,
              ...pick(activity, [
                "name",
                "notes",
                "durationInSeconds",
                "distance",
                "actualDistance",
                "activityType",
                "timeOfDay",
                "tss",
                "stressEstimateType",
                "stressEstimateValue",
                "openType",
                "manuallyCompleted",
                "revealStatus",
              ]),
              ...(activity.workout == null
                ? {}
                : { workout: pick(record(activity.workout), ["id", "name"]) }),
            },
          },
        ]
      })
      if (occurrences.length !== members.length)
        return invalid("series details omit occurrences present in the member's calendar")
      return { occurrences, scope: "selected-window-only", writesSupported: false }
    },
    next: (input, session) => [
      ...follow(
        "recurring-activities",
        windowArgs(input),
        session,
        "refresh recurrence discovery in the same window",
      ),
      ...guidance(),
    ],
  },
]

// Tn/Cn in calendar-mutation-manager-nhk9hkjm.js delete through calendar-recurrence.
// Its materialized match uses hydrated plannedActivity.recurrenceId, never groupId.
// calendar.api-6rqftorl.js x returns an array for the member + ids-header batch.
const tailParams = {
  id: required("Series ID from recurring-activities"),
  index: {
    kind: "flag",
    type: "integer",
    required: true,
    description: "Exact occurrence index at --from",
  } as const,
  from: required("Anchor occurrence date and first day of the observation window, YYYY-MM-DD"),
  verifyThrough: required("Last day of the observation window, YYYY-MM-DD"),
}
const tailWindow = (input: Flags): Flags => ({
  from: date(input, "from"),
  to: date(input, "verifyThrough"),
})
const validateTail = (input: Flags) => {
  validateWindow(tailWindow(input))
  const id = value(input, "id")
  segment(id)
  if (
    id.includes("§§") ||
    typeof input.index !== "number" ||
    !Number.isSafeInteger(input.index) ||
    input.index < 0
  )
    throw Errors.invalidUsage({
      message: "provide a series ID and nonnegative occurrence index",
      fix: "discover the series and choose its exact occurrence date and index",
    })
}
const batchId = (raw: Schema.Json | undefined): string => {
  if (!Schema.is(Id)(raw) || (typeof raw === "number" && !Number.isSafeInteger(raw)))
    return invalid("planned activity has no usable id")
  const id = String(raw)
  if (/[^\x21-\x7e]|,/.test(id) || id.length > 8192)
    return invalid("planned activity id cannot be sent in an ids header")
  return id
}
const plannedStubs = (records: JsonObject, input: Flags): JsonObject[] => {
  const seen = new Set<string>()
  return rows(record(records.timeline).plannedActivities)
    .map((item) => {
      const id = batchId(item.id)
      if (seen.has(id)) return invalid("duplicate planned activity in member timeline")
      seen.add(id)
      if (typeof item.manuallyCompleted !== "boolean")
        return invalid("planned completion state is missing")
      return {
        ...pick(item, ["title", "tss", "actualTss", "type", "manuallyCompleted"]),
        id,
        date: dateOnly(item.date),
      }
    })
    .filter((item) => inWindow(item.date, tailWindow(input)))
}
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const plannedBatches = (records: JsonObject, input: Flags): JsonObject[][] => {
  const sorted = plannedStubs(records, input).toSorted((a, b) =>
    compareText(batchId(a.id), batchId(b.id)),
  )
  const batches: JsonObject[][] = []
  let current: JsonObject[] = []
  let length = 0
  for (const item of sorted) {
    const size = batchId(item.id).length
    if (current.length === 100 || length + size + (current.length ? 1 : 0) > 8192) {
      batches.push(current)
      current = []
      length = 0
    }
    length += size + (current.length ? 1 : 0)
    current.push(item)
  }
  if (current.length) batches.push(current)
  return batches
}
const hydrateTail: NonNullable<Workflow["hydrate"]> = (records, input, member) =>
  Object.fromEntries(
    plannedBatches(records, input).map((batch, index) => [
      `tailPlanned${index}`,
      get(
        `/app/api/react-calendar/${segment(member.memberId)}/planned-activities`,
        batch.map((item) => batchId(item.id)),
      ),
    ]),
  )
const hydratedPlanned = (records: JsonObject, input: Flags): JsonObject[] => {
  const batches = plannedBatches(records, input)
  const result: JsonObject[] = []
  for (const [batch, stubs] of batches.entries()) {
    const expected = new Map(stubs.map((item) => [batchId(item.id), item]))
    for (const item of rows(records[`tailPlanned${batch}`])) {
      const id = batchId(item.id)
      const stub = expected.get(id)
      if (!stub) return invalid("hydration returned a foreign, duplicate or wrong-batch planned id")
      expected.delete(id)
      if (dateOnly(item.date) !== stub.date || item.manuallyCompleted !== stub.manuallyCompleted)
        return invalid(
          "planned activity changed between timeline and hydration; reread before writing",
        )
      if (item.recurrenceId !== null && !Schema.is(Id)(item.recurrenceId))
        return invalid("hydrated planned activity lacks explicit recurrence linkage")
      if (typeof item.name !== "string") return invalid("hydrated planned activity lacks its name")
      result.push({
        id,
        date: stub.date,
        name: item.name,
        recurrenceId: item.recurrenceId,
        ...pick(item, [
          "recurrenceIndex",
          "manuallyCompleted",
          "tss",
          "actualTss",
          "durationInSeconds",
          "notes",
          "activityType",
        ]),
        stateFingerprint: planToken(item),
      })
    }
    if (expected.size > 0)
      return invalid("hydration omitted member planned activities; linkage coverage is incomplete")
  }
  return result.toSorted((a, b) => compareText(batchId(a.id), batchId(b.id)))
}
const tailState = (records: JsonObject, input: Flags): JsonObject => {
  const id = value(input, "id")
  const planned = hydratedPlanned(records, input)
  const completedIds = new Set<string>()
  const completed = rows(record(records.timeline).activities)
    .map((item) => {
      const activityId = batchId(item.id)
      if (completedIds.has(activityId) || typeof item.started !== "string")
        return invalid("invalid completed-activity snapshot")
      completedIds.add(activityId)
      return {
        ...pick(item, [
          "started",
          "type",
          "tss",
          "plannedTss",
          "eventType",
          "excludeFromTrainingStress",
          "isOutside",
        ]),
        id: activityId,
        stateFingerprint: planToken(item),
      }
    })
    .toSorted((a, b) => compareText(a.id, b.id))
  return {
    seriesId: id,
    occurrenceIndex: input.index!,
    previewWindow: {
      from: date(input, "from"),
      through: date(input, "verifyThrough"),
      partial: true,
    },
    occurrences: timeline(records.timeline, tailWindow(input))
      .filter((item) => String(identity(item).id) === id)
      .toSorted((a, b) => identity(a).index - identity(b).index),
    linkedPlannedActivities: planned.filter(
      (item) => Schema.is(Id)(item.recurrenceId) && String(item.recurrenceId) === id,
    ),
    inspectedPlannedActivities: planned,
    completedPlannedSnapshots: planned.filter((item) => item.manuallyCompleted === true),
    completedActivitySnapshots: completed,
    verification:
      "window-observation-only; compare snapshots; no preservation or whole-tail completion claim",
  }
}
const tailArgs = (input: Flags) => [
  "--id",
  value(input, "id"),
  "--index",
  String(input.index),
  "--from",
  date(input, "from"),
  "--verify-through",
  date(input, "verifyThrough"),
]
const tailNext: Workflow["next"] = (input, session) => [
  ...follow(
    "recurrence-tail-state",
    tailArgs(input),
    session,
    "reread recurrence, linked materialized activities and completed snapshots in the same partial window",
  ),
  ...follow(
    "adaptation-status",
    ["--from", date(input, "from"), "--to", date(input, "verifyThrough")],
    session,
    "check recalculation; once settled, repeat recurrence-tail-state and compare snapshots",
  ),
  {
    message:
      "Deletion has NO END. This and uncompleted future activities beyond the verification window are in scope; do not infer preservation from submission.",
    args: ["guide", "get", "recurrence-changes", "--json"],
  },
]

export const recurrenceWorkflows: readonly Workflow[] = [
  ...recurrenceReads,
  {
    name: "recurrence-tail-state",
    summary:
      "Observe a recurrence tail, materialized activities and completed snapshots; an empty tail is valid",
    guide: "recurrence-changes",
    params: tailParams,
    validate: validateTail,
    example: "--id series-123 --index 0 --from 2026-09-07 --verify-through 2026-09-14",
    reads: (input, member) => ({ timeline: readTimeline(tailWindow(input), member.memberId) }),
    hydrate: hydrateTail,
    select: tailState,
    next: (input, session) => [
      ...follow(
        "adaptation-status",
        ["--from", date(input, "from"), "--to", date(input, "verifyThrough")],
        session,
        "check recalculation; this query reports observations, not deletion success",
      ),
      ...follow(
        "recurrence-tail-state",
        tailArgs(input),
        session,
        "after recalculation settles, reread this window and compare with the confirmed snapshots",
      ),
    ],
  },
  {
    name: "delete-recurrence-tail",
    summary:
      "Delete this and uncompleted future activities with NO END, including beyond the partial preview window",
    guide: "recurrence-changes",
    params: {
      ...tailParams,
      from: required("Occurrence date; delete this and uncompleted future activities with NO END"),
      verifyThrough: required(
        "Last preview/verification date; deletion also affects future activities beyond this date",
      ),
    },
    validate: validateTail,
    example: "--id series-123 --index 0 --from 2026-09-07 --verify-through 2026-09-14",
    reads: (input, member) => ({
      timeline: readTimeline(tailWindow(input), member.memberId),
      series: get(`/app/api/react-calendar/recurring-activities/${segment(value(input, "id"))}`),
    }),
    hydrate: hydrateTail,
    select: (records, input) => {
      const select = recurrenceReads.find(
        (workflow) => workflow.name === "recurrence-state",
      )?.select
      if (!select) return invalid("recurrence metadata reader is unavailable")
      const details = select(records, { ...input, to: date(input, "verifyThrough") })
      const occurrences = rows(details.occurrences).toSorted(
        (a, b) => identity(a).index - identity(b).index,
      )
      const anchors = occurrences.filter(
        (item) => item.index === input.index && record(item.activity).date === date(input, "from"),
      )
      if (anchors.length !== 1)
        throw Errors.invalidUsage({
          message: "from and index must identify one full-metadata member recurrence occurrence",
          fix: "read recurrence-state; materialized-only anchors and arbitrary cutoff dates are not supported",
        })
      return {
        ...tailState(records, input),
        anchor: anchors[0]!,
        occurrenceDetails: occurrences,
        seriesFingerprint: planToken(
          rows(records.series).toSorted((a, b) => identity(a).index - identity(b).index),
        ),
        deletionScope: {
          from: date(input, "from"),
          end: null,
          noEnd: true,
          affectsBeyondPreviewWindow: true,
          intent: "this-and-uncompleted-future-activities",
          warning:
            "Cannot be undone. verify-through limits reads only, NEVER deletion. Completed-activity preservation is not verified by submission.",
        },
      }
    },
    write: (input) =>
      send(
        "DELETE",
        `/app/api/calendar-recurrence/${segment(value(input, "id"))}?from=${date(input, "from")}`,
      ),
    next: tailNext,
  },
]
