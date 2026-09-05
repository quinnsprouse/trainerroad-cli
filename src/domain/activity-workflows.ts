import { Errors } from "../errors.ts"
import {
  follow,
  get,
  identified,
  required,
  segment,
  send,
  value,
  record,
  type Workflow,
} from "./workflow.ts"

const activityPath = (id: string) => `/app/api/activities/${segment(id)}`
const params = {
  id: required("Completed activity id from past, not a planned activity or library workout id"),
}
const select: NonNullable<Workflow["select"]> = (records, input) => {
  const activity = identified(records.activity, value(input, "id"))
  return {
    activity: Object.fromEntries(
      [
        "id",
        "memberName",
        "name",
        "notes",
        "started",
        "type",
        "workoutId",
        "matchedActivity",
        "syncModels",
      ].map((key) => [key, activity[key] ?? null]),
    ),
  }
}
const reads: Workflow["reads"] = (input) => ({ activity: get(activityPath(value(input, "id"))) })
const discover = (session: string) =>
  follow("past", ["--details"], session, "select the completed activity id from ride history")

export const activityWorkflows: readonly Workflow[] = [
  {
    name: "activity-details",
    summary: "Read a completed activity's notes, association, and provider sync state",
    params,
    example: "--id 12345",
    guide: "session-and-ids",
    reads,
    select,
    discover,
    next: (input, session) =>
      follow(
        "survey-options",
        ["--id", value(input, "id")],
        session,
        "read the survey options if the user wants to provide workout feedback",
      ),
  },
  {
    name: "edit-activity",
    summary: "Replace the notes on a completed activity",
    params: {
      ...params,
      notes: {
        kind: "flag",
        type: "string",
        required: true,
        description: "User-provided replacement notes; an empty string clears the notes",
      },
    },
    example: "--id 12345 --notes Recovery",
    guide: "calendar-changes",
    reads,
    select,
    discover,
    write: (input, member, before) => {
      const activity = record(before.activity)
      if (
        typeof activity.memberName !== "string" ||
        activity.memberName.toLowerCase() !== member.username.toLowerCase()
      )
        throw Errors.invalidData({
          message: "the completed activity does not identify this account as its owner",
          fix: "select your own activity from past; do not edit another athlete's ride",
        })
      if (typeof input.notes !== "string")
        throw Errors.invalidUsage({
          message: "missing replacement notes",
          fix: "provide --notes with the user's text",
        })
      return send("PUT", `${activityPath(value(input, "id"))}/details`, { notes: input.notes })
    },
    next: (input, session) =>
      follow(
        "activity-details",
        ["--id", value(input, "id")],
        session,
        "verify the saved notes match the user's requested text",
      ),
  },
]
