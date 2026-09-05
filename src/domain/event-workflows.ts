import { Schema } from "effect"
import { Errors } from "../errors.ts"
import { CalendarDate, Id } from "./calendar.ts"
import type { Flags, JsonObject } from "./operation.ts"
import {
  follow,
  get,
  identified,
  record,
  required,
  segment,
  send,
  value,
  type Workflow,
} from "./workflow.ts"

// Static callers: edit-event-flow.viewmodel-ctgny7iw.js (at, saveRaceImpl),
// save-requests-i1yrgybq.js (c), calendar.api-6rqftorl.js (w),
// athlete-data-e8vhbgx8.js (jt, xt, eventSaved). No live API validation.
const invalid = (message: string): never => {
  throw Errors.invalidData({
    message,
    fix: "read the event again; use TrainerRoad if its shape remains unsupported",
  })
}
const usage = (message: string): never => {
  throw Errors.invalidUsage({
    message,
    fix: "read describe --command edit-event for supported flags; use TrainerRoad for plan-attached changes beyond name/notes or multi-stage legs",
  })
}
const SingleEvent = Schema.Struct({
  id: Id,
  name: Schema.NonEmptyString,
  date: Schema.Struct({ year: Schema.Int, month: Schema.Int, day: Schema.Int }),
  timeOfDay: Schema.optional(Schema.NullOr(Schema.String)),
  durationInSeconds: Schema.Finite,
  discipline: Schema.Literals([0, 1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16]),
  racePriority: Schema.Literals([0, 1, 2, 3]),
  notes: Schema.optional(Schema.NullOr(Schema.String)),
  stressEstimateType: Schema.Literals([1, 2]),
  stressEstimateValue: Schema.Finite,
  customPlanId: Schema.NullOr(Id),
  manuallyCompleted: Schema.optional(Schema.NullOr(Schema.Boolean)),
})

const validateId = (input: Flags) => {
  const id = value(input, "id")
  segment(id)
  // The browser uses §§ to route group/leg IDs into the staged-event editor.
  if (id.includes("§§")) usage("triathlon and stage-race editing is not supported")
}
const disciplines: Readonly<Record<string, number>> = {
  "climbing-road-race": 0,
  "rolling-road-race": 1,
  "time-trial": 2,
  criterium: 3,
  "gran-fondo": 4,
  cyclocross: 5,
  "cross-country-olympic": 11,
  "cross-country-marathon": 12,
  "short-track": 13,
  gravity: 14,
  enduro: 15,
  gravel: 16,
}
const priorities: Readonly<Record<string, number>> = { a: 3, b: 2, c: 1 }
const selectedCode = (
  codes: Readonly<Record<string, number>>,
  input: Flags,
  key: string,
): number => {
  const code = codes[value(input, key)]
  return code === undefined ? usage(`unsupported ${key}`) : code
}
const validDate = (input: Flags, key: string): string => {
  const day = value(input, key)
  return Schema.is(CalendarDate)(day) ? day : usage(`${key} must be a real YYYY-MM-DD date`)
}
const windowArgs = (input: Flags, current: string): string[] => {
  const from = input.from === undefined ? current : validDate(input, "from")
  const to = input.to === undefined ? current : validDate(input, "to")
  return ["--from", from < current ? from : current, "--to", to > current ? to : current]
}
const selectEvent = (records: JsonObject, input: Flags): JsonObject => {
  const raw = identified(records.event, value(input, "id"))
  const membership = identified(records.membership, value(input, "id"))
  // Both reads are scoped to the authenticated member. The calendar DTO supplies
  // stageRaceId/isTriRace, absent from the single-event form model.
  if (membership.stageRaceId !== null || membership.isTriRace !== false)
    return invalid("event is grouped, triathlon, or lacks confirmed standalone membership")
  if (!Schema.is(SingleEvent)(raw)) return invalid("unsupported single-event fields")
  if (
    !Number.isFinite(raw.durationInSeconds) ||
    raw.durationInSeconds <= 0 ||
    !Number.isFinite(raw.stressEstimateValue) ||
    raw.stressEstimateValue < 0
  )
    return invalid("unsupported event duration or stress estimate")
  const date = `${String(raw.date.year).padStart(4, "0")}-${String(raw.date.month).padStart(2, "0")}-${String(raw.date.day).padStart(2, "0")}`
  if (!Schema.is(CalendarDate)(date)) return invalid("invalid event date")
  if (typeof raw.timeOfDay === "string" && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(raw.timeOfDay))
    return invalid("unsupported event start time")
  return {
    event: {
      id: raw.id,
      name: raw.name,
      date,
      ...(raw.timeOfDay === undefined ? {} : { time: raw.timeOfDay }),
      discipline: raw.discipline,
      duration: raw.durationInSeconds,
      notes: raw.notes ?? "",
      racePriority: raw.racePriority,
      stressEstimateType: raw.stressEstimateType,
      stressEstimateValue: raw.stressEstimateType === 1 ? null : raw.stressEstimateValue,
      tss: raw.stressEstimateType === 1 ? raw.stressEstimateValue : null,
      customPlanId: raw.customPlanId,
      manuallyCompleted: raw.manuallyCompleted ?? false,
    },
    membership: { id: raw.id, stageRaceId: null, isTriRace: false },
    ...(input.date === undefined ? {} : { overlappingARaces: records.overlappingARaces! }),
  }
}
const planGuidance = () => [
  {
    message:
      "Reapply or rebuild is a separate user decision. This edit never reapplies a plan. TrainerRoad may require Plan Builder; inspect it before any separate plan write.",
    args: ["guide", "get", "calendar-changes", "--json"],
  },
]
const discovery: NonNullable<Workflow["discover"]> = (session) =>
  follow("events", ["--full"], session, "choose a current standalone event id owned by this member")
const shared = {
  guide: "calendar-changes" as const,
  reads: (input, member) => ({
    event: get(
      `/app/api/react-calendar/${segment(member.memberId)}/single-event/${segment(value(input, "id"))}`,
    ),
    membership: get(
      `/app/api/calendar/${segment(member.memberId)}/events/${segment(value(input, "id"))}`,
    ),
  }),
  select: selectEvent,
  discover: discovery,
} satisfies Pick<Workflow, "guide" | "reads" | "select" | "discover">

export const eventWorkflows: readonly Workflow[] = [
  {
    ...shared,
    name: "event-state",
    summary: "Read a member-owned standalone event and its preserved edit fields",
    params: {
      id: required("Standalone event id from events --full"),
      from: { kind: "flag", type: "string", description: "Earlier affected date for verification" },
      to: { kind: "flag", type: "string", description: "Later affected date for verification" },
    },
    example: "--id event-123",
    validate: (input) => {
      validateId(input)
      for (const key of ["from", "to"]) if (input[key] !== undefined) validDate(input, key)
      if (typeof input.from === "string" && typeof input.to === "string" && input.from > input.to)
        usage("from is after to")
    },
    next: (input, session, before) => {
      const event = record(before.event)
      if (typeof event.date !== "string") return invalid("event date is missing")
      return [
        ...follow(
          "adaptation-status",
          windowArgs(input, event.date),
          session,
          "check adaptation status for this event date",
        ),
        ...planGuidance(),
      ]
    },
  },
  {
    ...shared,
    name: "edit-event",
    summary: "Edit named standalone event fields; plan-attached events allow only name and notes",
    params: {
      id: required("Standalone event id from events --full"),
      name: { kind: "flag", type: "string", description: "New nonempty event name" },
      notes: {
        kind: "flag",
        type: "string",
        description: "New notes; an empty string clears them",
      },
      durationSeconds: {
        kind: "flag",
        type: "integer",
        description: "Positive duration in seconds; only for events without a plan",
      },
      tss: {
        kind: "flag",
        type: "integer",
        description: "Positive custom TSS; only for events without a plan",
      },
      date: { kind: "flag", type: "string", description: "New date, YYYY-MM-DD; no plan attached" },
      time: {
        kind: "flag",
        type: "string",
        description: "Local start HH:mm in 15-minute steps; no plan attached",
      },
      clearTime: {
        kind: "flag",
        type: "boolean",
        description: "Remove the start time; no plan attached",
      },
      racePriority: {
        kind: "flag",
        type: "choice",
        choices: ["a", "b", "c"],
        description: "User-selected priority; A requires explicit --date for a race-spacing check",
      },
      discipline: {
        kind: "flag",
        type: "choice",
        choices: [
          "climbing-road-race",
          "rolling-road-race",
          "time-trial",
          "criterium",
          "gran-fondo",
          "cyclocross",
          "cross-country-olympic",
          "cross-country-marathon",
          "short-track",
          "gravity",
          "enduro",
          "gravel",
        ],
        description: "Replacement standalone cycling discipline; no plan attached",
      },
    },
    example: "--id event-123 --name Autumn",
    validate: (input) => {
      validateId(input)
      if (
        [
          input.name,
          input.notes,
          input.durationSeconds,
          input.tss,
          input.date,
          input.time,
          input.clearTime === true ? true : undefined,
          input.racePriority,
          input.discipline,
        ].every((item) => item === undefined)
      )
        usage("at least one named change is required")
      if (input.name !== undefined) value(input, "name")
      if (input.notes !== undefined && typeof input.notes !== "string") usage("notes must be text")
      if (input.date !== undefined) validDate(input, "date")
      if (
        input.time !== undefined &&
        !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(value(input, "time"))
      )
        usage("time must be HH:mm in 15-minute steps")
      if (input.time !== undefined && input.clearTime === true)
        usage("time and clear-time are mutually exclusive")
      if (input.racePriority === "a" && input.date === undefined)
        usage("A priority requires --date, including an unchanged date, for a race-spacing check")
      for (const key of ["durationSeconds", "tss"]) {
        const number = input[key]
        if (
          number !== undefined &&
          (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0)
        )
          usage(`${key} must be a positive safe integer`)
      }
    },
    reads: (input, member) => ({
      ...shared.reads(input, member),
      ...(input.date === undefined
        ? {}
        : {
            overlappingARaces: get(
              `/app/api/react-calendar/${segment(member.memberId)}/has-overlapping-a-races?date=${validDate(input, "date")}&raceId=${segment(value(input, "id"))}`,
            ),
          }),
    }),
    select: (records, input) => {
      if (input.date !== undefined && typeof records.overlappingARaces !== "boolean")
        return invalid("race-spacing response must be a boolean")
      return selectEvent(records, input)
    },
    write: (input, _member, before) => {
      const event = record(before.event)
      if (
        event.customPlanId !== null &&
        [
          input.durationSeconds,
          input.tss,
          input.date,
          input.time,
          input.racePriority,
          input.discipline,
          input.clearTime === true ? true : undefined,
        ].some((item) => item !== undefined)
      )
        usage(
          "plan-attached events support name and notes only; other changes require a separate rebuild decision in TrainerRoad",
        )
      // selectEvent constructs only the recovered wire fields plus resource id.
      const { id: _id, ...preserved } = event
      const body: JsonObject = {
        ...preserved,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.durationSeconds === undefined ? {} : { duration: input.durationSeconds }),
        ...(input.tss === undefined
          ? {}
          : { tss: input.tss, stressEstimateType: 1, stressEstimateValue: null }),
        ...(input.date === undefined ? {} : { date: validDate(input, "date") }),
        ...(input.time === undefined ? {} : { time: `${value(input, "time")}:00` }),
        ...(input.clearTime === true ? { time: null } : {}),
        ...(input.racePriority === undefined
          ? {}
          : {
              racePriority: selectedCode(priorities, input, "racePriority"),
            }),
        ...(input.discipline === undefined
          ? {}
          : {
              discipline: selectedCode(disciplines, input, "discipline"),
            }),
      }
      if (body.racePriority === 3 && input.date !== undefined && before.overlappingARaces !== false)
        usage(
          "TrainerRoad reports an overlapping A race; choose a different date or priority with the user",
        )
      if (Object.keys(body).every((key) => body[key] === preserved[key]))
        usage("the requested event values are already saved")
      return send(
        "PUT",
        `/app/api/calendar/plannedactivities/${segment(value(input, "id"))}/event`,
        body,
      )
    },
    next: (input, session, before) => {
      const previousDate = record(before.event).date
      if (typeof previousDate !== "string") return invalid("event date is missing")
      return [
        ...follow(
          "event-state",
          [
            "--id",
            value(input, "id"),
            ...(input.date === undefined
              ? []
              : windowArgs(
                  {
                    from: previousDate,
                    to: previousDate,
                  },
                  validDate(input, "date"),
                )),
          ],
          session,
          "read the saved event and compare its fields before considering any separate plan action",
        ),
        ...planGuidance(),
      ]
    },
  },
]
