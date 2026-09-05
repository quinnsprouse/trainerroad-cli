import { Schema } from "effect"
import { CalendarDate } from "./calendar.ts"
import { Errors } from "../errors.ts"
import {
  follow,
  get,
  identified,
  record,
  required,
  choice,
  segment,
  send,
  value,
  type Workflow,
} from "./workflow.ts"

const plannedPath = (id: string) => `/app/api/calendar/plannedactivities/${segment(id)}`
const storedDate = (raw: Schema.Json | undefined): string => {
  const date = record(raw)
  if (
    typeof date.year !== "number" ||
    typeof date.month !== "number" ||
    typeof date.day !== "number"
  )
    throw Errors.invalidData({
      message: "planned activity has no valid date",
      fix: "stop and check the activity response before changing it",
    })
  const result = `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`
  if (!Schema.is(CalendarDate)(result))
    throw Errors.invalidData({
      message: "planned activity date is invalid",
      fix: "inspect the calendar in TrainerRoad before changing this activity",
    })
  return result
}
const plannedState = (
  records: Parameters<NonNullable<Workflow["select"]>>[0],
  input: Parameters<NonNullable<Workflow["select"]>>[1],
) => {
  const activity = identified(records.activity, value(input, "id"))
  const selected = Object.fromEntries(
    [
      "id",
      "name",
      "date",
      "activityType",
      "workoutId",
      "manuallyCompleted",
      "adaptationLocked",
      "recommendationReason",
      "isAdaptedOverride",
      "values",
      "syncState",
      "canMove",
    ].map((key) => [key, activity[key] ?? null]),
  )
  const workout = activity.workout == null ? null : record(activity.workout)
  selected.workout =
    workout === null
      ? null
      : Object.fromEntries(["id", "name", "isOutside"].map((key) => [key, workout[key] ?? null]))
  return { activity: selected, date: storedDate(activity.date) }
}
const id = required("Planned activity id from future, not a workout library id")

export const calendarWorkflows: readonly Workflow[] = [
  {
    name: "planned-activity",
    summary: "Read the current scheduled activity, including completion and adaptation state",
    params: { id },
    example: "--id planned-123",
    guide: "calendar-changes",
    reads: (input) => ({ activity: get(plannedPath(value(input, "id"))) }),
    select: plannedState,
    discover: (session) =>
      follow("future", ["--details"], session, "select a planned activity id from the calendar"),
    next: (_, session, records) =>
      follow(
        "adaptation-status",
        ["--from", storedDate(record(records.activity).date)],
        session,
        "check whether calendar recalculation has settled for the affected date window",
      ),
  },
  ...[
    {
      name: "skip-workout",
      summary: "Skip a planned activity",
      suffix: "skip",
      method: "PUT" as const,
      params: { id },
      example: "--id planned-123",
      body: () => null,
    },
    {
      name: "pin-workout",
      summary: "Set whether a planned workout is pinned against adaptation",
      suffix: "pin",
      method: "PUT" as const,
      params: { id, pinned: choice("Explicit target pin state", ["true", "false"]) },
      example: "--id planned-123 --pinned true",
      body: (input: Parameters<Workflow["reads"]>[0]) => ({
        pinned: value(input, "pinned") === "true",
      }),
    },
    {
      name: "complete-workout",
      summary: "Set manual completion of a planned activity without uploading a ride",
      suffix: "mark-manually-complete",
      method: "POST" as const,
      params: { id, completed: choice("Explicit target completion state", ["true", "false"]) },
      example: "--id planned-123 --completed true",
      body: (input: Parameters<Workflow["reads"]>[0]) => ({
        completed: value(input, "completed") === "true",
      }),
    },
  ].map(
    (item): Workflow => ({
      name: item.name,
      summary: item.summary,
      params: item.params,
      example: item.example,
      guide: "calendar-changes",
      reads: (input) => ({ activity: get(plannedPath(value(input, "id"))) }),
      select: plannedState,
      discover: (session) =>
        follow("future", ["--details"], session, "select a planned activity id from the calendar"),
      write: (input) =>
        send(item.method, `${plannedPath(value(input, "id"))}/${item.suffix}`, item.body(input)),
      next: (input, session) =>
        follow(
          "planned-activity",
          ["--id", value(input, "id")],
          session,
          "verify the requested activity state before another write",
        ),
    }),
  ),
  {
    name: "adaptation-status",
    summary: "Read TrainerRoad's pending calendar recalculation status",
    params: {
      from: {
        kind: "flag",
        type: "string",
        description:
          "First affected date, YYYY-MM-DD; preserved in the calendar verification nudge",
      },
      to: {
        kind: "flag",
        type: "string",
        description: "Last affected date, YYYY-MM-DD; preserved in the calendar verification nudge",
      },
    },
    example: "",
    guide: "calendar-changes",
    validate: (input) => {
      for (const key of ["from", "to"]) if (input[key] !== undefined) dateValue(input, key)
      if (typeof input.from === "string" && typeof input.to === "string" && input.from > input.to)
        throw Errors.invalidUsage({
          message: "from is after to",
          fix: "use an ordered date window",
        })
    },
    reads: (_, member) => ({
      progress: get(`/app/api/calendar/${segment(member.memberId)}/ff-progress`),
    }),
    select: (records) => {
      const progress = record(records.progress)
      if (typeof progress.pending !== "boolean")
        throw Errors.invalidData({
          message: "recalculation status has no pending flag",
          fix: "do not assume adaptation is complete; inspect TrainerRoad before another calendar change",
        })
      return {
        progress,
        state: progress.failed === true ? "failed" : progress.pending ? "pending" : "settled",
      }
    },
    next: (input, session, records) => {
      const dates = ["from", "to"].flatMap((key) =>
        typeof input[key] === "string" ? [`--${key}`, input[key]] : [],
      )
      return records.state === "pending"
        ? follow(
            "adaptation-status",
            dates,
            session,
            "recalculation is pending; wait before checking again, do not resubmit the mutation",
          )
        : follow(
            "future",
            [...dates, "--details"],
            session,
            records.state === "failed"
              ? "recalculation failed; inspect the calendar and resolve in TrainerRoad before another write"
              : "inspect the resulting workout choices and dates",
          )
    },
  },
]

export const dateValue = (input: Parameters<Workflow["reads"]>[0], key: string) => {
  const date = value(input, key)
  if (!Schema.is(CalendarDate)(date))
    throw Errors.invalidUsage({
      message: `invalid ${key} date`,
      fix: "provide a real date in YYYY-MM-DD format",
    })
  const [year, month, day] = date.split("-").map(Number)
  return { year: year!, month: month!, day: day! }
}
