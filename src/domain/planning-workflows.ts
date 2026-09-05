import { DateTime, Schema } from "effect"
import type { ParamSpec } from "../contract/contract.ts"
import { planToken } from "../contract/token.ts"
import { Errors } from "../errors.ts"
import { CalendarDate } from "./calendar.ts"
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

// Payload sources: use-annotation-flow-view-model-dfz907t1.js,
// calendar-mutation-manager-nhk9hkjm.js, calendar-k861i5ew.js,
// container.provider-dl1beg4n.js. Research is static, not server validation.
const invalid = (message: string): never => {
  throw Errors.invalidData({
    message,
    fix: "read the resource again; stop if its fields or identity are unknown",
  })
}
const usage = (message: string): never => {
  throw Errors.invalidUsage({ message, fix: "use the named flags shown by describe" })
}
const optional = (description: string): ParamSpec => ({ kind: "flag", type: "string", description })
const integer = (description: string): ParamSpec => ({ kind: "flag", type: "integer", description })
const date = (input: Flags, key: string): string => {
  const result = value(input, key)
  return Schema.is(CalendarDate)(result) ? result : usage(`${key} must be a real YYYY-MM-DD date`)
}
const dateParts = (input: Flags, key: string) => {
  const [year, month, day] = date(input, key).split("-").map(Number)
  return { year: year!, month: month!, day: day! }
}
const addDays = (start: string, days: number): string => {
  const result = DateTime.formatIsoDateUtc(
    DateTime.add(DateTime.makeUnsafe(`${start}T00:00:00Z`), { days }),
  )
  return Schema.is(CalendarDate)(result)
    ? result
    : usage("date range exceeds supported calendar dates")
}
const dateOf = (raw: Schema.Json | undefined): string => {
  if (typeof raw === "string") {
    const result = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?(?:Z|\+00:00)?)?$/.test(raw)
      ? raw.slice(0, 10)
      : ""
    if (Schema.is(CalendarDate)(result)) return result
    return invalid("unexpected calendar date")
  }
  const parts = record(raw)
  const { year, month, day } = parts
  if (
    typeof year !== "number" ||
    typeof month !== "number" ||
    typeof day !== "number" ||
    ![year, month, day].every(Number.isInteger)
  )
    return invalid("unexpected calendar date")
  const result = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  return Schema.is(CalendarDate)(result) ? result : invalid("unexpected calendar date")
}
const rows = (raw: Schema.Json | undefined): JsonObject[] => {
  if (!Array.isArray(raw)) return invalid("expected a TrainerRoad collection")
  return raw.map(record)
}
const exactRow = (raw: Schema.Json | undefined, id: string): JsonObject => {
  const matches = rows(raw).filter((item) => {
    if (typeof item.id !== "string" && typeof item.id !== "number")
      return invalid("collection item has no resource id")
    return String(item.id) === id
  })
  if (matches.length === 0)
    throw Errors.notFound({
      message: "resource is absent from the current collection",
      fix: "list resources and choose a current id",
    })
  if (matches.length !== 1) return invalid("duplicate resource identity")
  return identified(matches[0], id)
}
const annotationPath = (input: Flags) =>
  `/app/api/react-calendar/annotation/${segment(value(input, "id"))}`
const annotationState = (records: JsonObject, input: Flags): JsonObject => {
  const item = identified(records.annotation, value(input, "id"))
  if (
    typeof item.title !== "string" ||
    item.title.trim() === "" ||
    !(typeof item.text === "string" || item.text === null) ||
    typeof item.duration !== "number" ||
    !Number.isSafeInteger(item.duration) ||
    item.duration <= 0 ||
    item.duration % 86400 !== 0 ||
    typeof item.typeId !== "number" ||
    !Number.isInteger(item.typeId) ||
    typeof item.colorId !== "number" ||
    !Number.isInteger(item.colorId)
  )
    return invalid("annotation is missing editable fields")
  return { annotation: { ...item, date: dateOf(item.date) } }
}
const editableAnnotation = (before: JsonObject): JsonObject => {
  const item = record(before.annotation)
  if (![1, 2, 3, 4].includes(Number(item.typeId)))
    return invalid("this annotation type is managed by a plan or event")
  return item
}
const annotationDiscovery = (session: string) =>
  follow("annotations", ["--full"], session, "choose an annotation id from the calendar")
const annotationNext: Workflow["next"] = (input, session, before) => {
  const item = record(before.annotation)
  const oldStart = dateOf(item.date)
  const oldEnd = addDays(oldStart, Number(item.duration) / 86400 - 1)
  const newStart =
    input.to !== undefined
      ? date(input, "to")
      : input.date !== undefined
        ? date(input, "date")
        : oldStart
  const newEnd = addDays(
    newStart,
    input.days === undefined ? Number(item.duration) / 86400 - 1 : Number(input.days) - 1,
  )
  return follow(
    "annotation-state",
    [
      "--id",
      value(input, "id"),
      "--from",
      oldStart < newStart ? oldStart : newStart,
      "--to",
      oldEnd > newEnd ? oldEnd : newEnd,
    ],
    session,
    "verify the annotation's saved fields before another write",
  )
}
const annotationTypes: Readonly<Record<string, number>> = {
  note: 1,
  illness: 2,
  injury: 3,
  "time-off": 4,
}
const editFields = ["title", "text", "date", "days", "colorId", "type"] as const
const annotationEdit: Workflow = {
  name: "edit-annotation",
  summary: "Edit named annotation fields, preserving its other editable values",
  guide: "calendar-changes",
  params: {
    id: required("Annotation id from annotations"),
    title: optional("Replacement title"),
    text: optional("Replacement notes; an empty string clears them"),
    date: optional("Replacement first day, YYYY-MM-DD"),
    days: integer("Inclusive duration in whole calendar days"),
    colorId: integer("Color id from annotation-colors for the target type"),
    type: {
      kind: "flag",
      type: "choice",
      choices: ["note", "illness", "injury", "time-off"],
      description: "Replacement annotation type; choose a matching color",
    },
  },
  example: "--id note-123 --title Recovery --days 2",
  validate: (input) => {
    if (!editFields.some((key) => input[key] !== undefined))
      usage("supply at least one annotation change")
    if (input.title !== undefined) value(input, "title")
    if (input.text !== undefined && typeof input.text !== "string") usage("text must be a string")
    if (input.date !== undefined) date(input, "date")
    if (
      input.days !== undefined &&
      (typeof input.days !== "number" ||
        !Number.isSafeInteger(input.days) ||
        input.days <= 0 ||
        !Number.isSafeInteger(input.days * 86400))
    )
      usage("days must be a positive whole number")
  },
  reads: (input) => ({
    annotation: get(annotationPath(input)),
    colors: get("/app/api/annotation-color"),
  }),
  select: (records, input) => ({
    ...annotationState(records, input),
    colors: rows(records.colors),
  }),
  write: (input, _, before) => {
    const item = editableAnnotation(before)
    const typeId = input.type === undefined ? item.typeId : annotationTypes[value(input, "type")]
    const colorId = input.colorId ?? item.colorId
    if (
      typeId === undefined ||
      !rows(before.colors).some(
        (color) => color.id === colorId && color.annotationTypeId === typeId,
      )
    )
      return invalid("annotation color does not belong to the selected type")
    const start = input.date === undefined ? dateOf(item.date) : date(input, "date")
    const duration = input.days === undefined ? item.duration : Number(input.days) * 86400
    addDays(start, Number(duration) / 86400 - 1)
    return send("PUT", `/app/api/calendar/annotations/${segment(value(input, "id"))}`, {
      colorId: colorId!,
      date: start,
      duration: duration!,
      text: input.text ?? item.text!,
      title: input.title ?? item.title!,
      typeId,
    })
  },
  next: annotationNext,
  discover: annotationDiscovery,
}

const customPlans = () => ({ plans: get("/app/api/plan-builder/current-custom-plans") })
const planSummary = (plan: JsonObject): JsonObject => ({
  ...Object.fromEntries(
    ["id", "name", "start", "end", "startDate", "endDate", "plannedActivityGroupId"].map((key) => [
      key,
      plan[key] ?? null,
    ]),
  ),
  stateFingerprint: planToken(plan),
})
const selectedPlan = (records: JsonObject, input: Flags): JsonObject => {
  const plan = exactRow(records.plans, value(input, "id"))
  if (typeof plan.name !== "string") return invalid("plan has no name")
  return { plan: planSummary(plan) }
}
const planDiscovery = (session: string) =>
  follow("custom-plans", [], session, "choose an editable custom plan id")
const planNext: Workflow["next"] = (input, session) =>
  follow(
    "custom-plan",
    ["--id", value(input, "id")],
    session,
    "verify the saved plan name and dates",
  )

const weekParams = { start: required("First day of the selected seven-day window, YYYY-MM-DD") }
const timelineRequest = (memberId: string | number, start: string, end: string) =>
  get(`/app/api/react-calendar/${segment(memberId)}/timeline?start=${start}&end=${end}`)
const calendarState = (raw: Schema.Json | undefined): JsonObject => {
  const timeline = record(raw)
  // Keep all five collections. Week copy can turn completed activities into
  // planned activities; events and annotations are context, not deletion targets.
  return Object.fromEntries(
    ["plannedActivities", "activities", "annotations", "events", "recurringActivities"].map(
      (key) => [key, rows(timeline[key])],
    ),
  )
}
const weekNext: Workflow["next"] = (input, session) =>
  follow(
    "calendar-week",
    ["--start", date(input, "start")],
    session,
    "inspect the requested week after the write",
  )
const weekMutation = (operation: "copy" | "move"): Workflow => ({
  name: `${operation}-week`,
  summary: `${operation === "copy" ? "Copy" : "Move"} a seven-day calendar window of activities`,
  guide: "calendar-changes",
  params: { ...weekParams, to: required("First day of the destination window, YYYY-MM-DD") },
  example: "--start 2026-09-07 --to 2026-09-14",
  validate: (input) => {
    date(input, "start")
    date(input, "to")
    if (operation === "move" && input.start === input.to)
      usage("source and destination must differ")
  },
  reads: (input, member) => ({
    source: timelineRequest(
      member.memberId,
      date(input, "start"),
      addDays(date(input, "start"), 6),
    ),
    destination: timelineRequest(member.memberId, date(input, "to"), addDays(date(input, "to"), 6)),
  }),
  select: (records) => ({
    source: calendarState(records.source),
    destination: calendarState(records.destination),
  }),
  write: (input) =>
    send("POST", `/app/api/react-calendar/week/${operation}`, {
      oldDate: dateParts(input, "start"),
      newDate: dateParts(input, "to"),
      days: 6,
    }),
  next: (input, session) => [
    ...follow(
      "calendar-week",
      ["--start", date(input, "to")],
      session,
      "verify the destination week",
    ),
    ...weekNext(input, session, {}),
  ],
})

// Exported separately so integration can replace the earlier reapply-plan spec
// instead of registering two commands with the same name.
export const reapplyPlanWorkflow: Workflow = {
  name: "reapply-plan",
  summary: "Reapply a plan around an event verified to belong to that plan",
  guide: "calendar-changes",
  params: {
    planId: required("Plan id from plan --view plans"),
    eventId: required("Single event or event-leg id belonging to that plan"),
  },
  example: "--plan-id plan-123 --event-id event-123",
  reads: (input, member) => ({
    plans: get(`/app/api/plan-builder/${segment(member.memberId)}/all-user-plans`),
    event: get(
      `/app/api/react-calendar/${segment(member.memberId)}/single-event/${segment(value(input, "eventId"))}`,
    ),
  }),
  select: (records, input) => {
    const plan = exactRow(records.plans, value(input, "planId"))
    const event = identified(records.event, value(input, "eventId"))
    if (
      (typeof event.customPlanId !== "number" && typeof event.customPlanId !== "string") ||
      String(event.customPlanId) !== value(input, "planId")
    )
      return invalid("event does not identify the selected plan")
    if (typeof plan.name !== "string" || typeof event.name !== "string")
      return invalid("plan or event is missing its name")
    return { plan: planSummary(plan), event }
  },
  write: (input) =>
    send(
      "PUT",
      `/app/api/calendar/plans/plan/${segment(value(input, "planId"))}/reapply-plan?eventId=${segment(value(input, "eventId"))}`,
    ),
  next: (input, session) => [
    ...follow("adaptation-status", [], session, "wait for recalculation to settle"),
    ...follow(
      "plan",
      ["--view", "plans", "--full"],
      session,
      `verify plan ${value(input, "planId")} after recalculation`,
    ),
  ],
  discover: (session) => [
    ...follow("plan", ["--view", "plans"], session, "choose the plan id"),
    ...follow("events", ["--full"], session, "choose a single event id belonging to that plan"),
  ],
}

export const planningWorkflows: readonly Workflow[] = [
  {
    name: "annotation-state",
    summary: "Read one annotation's current editable fields",
    guide: "calendar-changes",
    params: {
      id: required("Annotation id from annotations"),
      from: optional("First affected date, retained for recalculation verification"),
      to: optional("Last affected date, retained for recalculation verification"),
    },
    example: "--id note-123",
    validate: (input) => {
      if (input.from !== undefined) date(input, "from")
      if (input.to !== undefined) date(input, "to")
      if (typeof input.from === "string" && typeof input.to === "string" && input.from > input.to)
        usage("from must not be after to")
    },
    reads: (input) => ({ annotation: get(annotationPath(input)) }),
    select: annotationState,
    next: (input, session, records) => {
      const item = record(records.annotation)
      const start = dateOf(item.date)
      return follow(
        "adaptation-status",
        [
          "--from",
          input.from === undefined ? start : date(input, "from"),
          "--to",
          input.to === undefined
            ? addDays(start, Number(item.duration) / 86400 - 1)
            : date(input, "to"),
        ],
        session,
        "check recalculation in the annotation's date range",
      )
    },
    discover: annotationDiscovery,
  },
  {
    name: "annotation-colors",
    summary: "List annotation color ids and their annotation type ids",
    guide: "calendar-changes",
    params: {},
    example: "",
    reads: () => ({ colors: get("/app/api/annotation-color") }),
    select: (records) => ({ colors: rows(records.colors) }),
    next: () => [],
  },
  annotationEdit,
  {
    name: "move-annotation",
    summary: "Move a user annotation while preserving its duration and content",
    guide: "calendar-changes",
    params: {
      id: required("Annotation id from annotations"),
      to: required("Destination first day, YYYY-MM-DD"),
    },
    example: "--id note-123 --to 2026-09-14",
    validate: (input) => {
      date(input, "to")
    },
    reads: (input) => ({ annotation: get(annotationPath(input)) }),
    select: annotationState,
    write: (input, _, before) => {
      const item = editableAnnotation(before)
      const oldDate = dateOf(item.date),
        newDate = date(input, "to")
      if (oldDate === newDate) usage("annotation is already on the requested day")
      addDays(newDate, Number(item.duration) / 86400 - 1)
      return send("PUT", `/app/api/calendar/annotations/${segment(value(input, "id"))}/move`, {
        oldDate,
        newDate,
      })
    },
    next: annotationNext,
    discover: annotationDiscovery,
  },
  {
    name: "custom-plans",
    summary: "List current custom plans eligible for the plan editor",
    guide: "calendar-changes",
    params: {},
    example: "",
    reads: customPlans,
    select: (records) => ({ plans: rows(records.plans).map(planSummary) }),
    next: () => [],
  },
  {
    name: "custom-plan",
    summary: "Read the current summary of one editable custom plan",
    guide: "calendar-changes",
    params: { id: required("Plan id from custom-plans") },
    example: "--id plan-123",
    reads: customPlans,
    select: selectedPlan,
    next: () => [],
    discover: planDiscovery,
  },
  {
    name: "rename-plan",
    summary: "Rename an existing custom plan",
    guide: "calendar-changes",
    params: { id: required("Plan id from custom-plans"), name: required("Replacement plan name") },
    example: "--id plan-123 --name Autumn",
    reads: customPlans,
    select: selectedPlan,
    write: (input) =>
      send("POST", `/app/api/plan-builder/custom-plan/${segment(value(input, "id"))}`, {
        updatedName: value(input, "name").trim(),
      }),
    next: planNext,
    discover: planDiscovery,
  },
  {
    name: "calendar-week",
    summary: "Read all calendar collections for an explicit seven-day window",
    guide: "calendar-changes",
    params: weekParams,
    example: "--start 2026-09-07",
    reads: (input, member) => ({
      calendar: timelineRequest(
        member.memberId,
        date(input, "start"),
        addDays(date(input, "start"), 6),
      ),
    }),
    select: (records) => ({ calendar: calendarState(records.calendar) }),
    next: (input, session) =>
      follow(
        "adaptation-status",
        ["--from", date(input, "start"), "--to", addDays(date(input, "start"), 6)],
        session,
        "check whether recalculation has settled for this week",
      ),
  },
  weekMutation("copy"),
  weekMutation("move"),
  {
    name: "delete-week",
    summary:
      "Delete planned activities not marked manually complete in a range of up to seven days",
    guide: "calendar-changes",
    params: {
      ...weekParams,
      end: required("Inclusive final day, YYYY-MM-DD; at most six days after start"),
    },
    example: "--start 2026-09-07 --end 2026-09-13",
    validate: (input) => {
      const start = date(input, "start"),
        end = date(input, "end")
      if (end < start || end > addDays(start, 6))
        usage("deletion range must contain one to seven days")
    },
    reads: (input, member) => ({
      calendar: timelineRequest(member.memberId, date(input, "start"), date(input, "end")),
    }),
    select: (records, input) => {
      const calendar = calendarState(records.calendar)
      const planned = rows(calendar.plannedActivities).filter((item) => {
        if (typeof item.id !== "string" && typeof item.id !== "number")
          return invalid("planned activity has no id")
        if (typeof item.manuallyCompleted !== "boolean")
          return invalid("planned activity has unknown manual completion state")
        const day = dateOf(item.date)
        return day >= date(input, "start") && day <= date(input, "end")
      })
      return {
        start: date(input, "start"),
        end: date(input, "end"),
        calendar,
        expectedDeletions: planned.filter((item) => item.manuallyCompleted === false),
        preservedManuallyCompleted: planned.filter((item) => item.manuallyCompleted === true),
      }
    },
    write: (input) =>
      send(
        "DELETE",
        `/app/api/react-calendar/week/delete?startDate=${date(input, "start")}&endDate=${date(input, "end")}`,
      ),
    next: weekNext,
  },
]
