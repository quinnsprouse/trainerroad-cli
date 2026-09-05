import type { Schema } from "effect"
import { Errors } from "../errors.ts"
import type { Flags, JsonObject } from "./operation.ts"
import {
  choice,
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

// Contracts recovered from survey.api, edit-survey, surveys, aiftp.api,
// athlete-data, activitysync.api, and workout-details static browser callers.
const invalid = (message: string): never => {
  throw Errors.invalidData({
    message,
    fix: "read the matching discovery command again; do not guess missing fields or identifiers",
  })
}
const answerError = (message: string): never => {
  throw Errors.invalidUsage({
    message,
    fix: "read survey-options for this activity and obtain the user's answer using its current option element IDs",
  })
}
const numericId = (input: Flags, key: string): number => {
  const raw = value(input, key)
  const id = Number(raw)
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id))
    throw Errors.invalidUsage({
      message: `invalid ${key}`,
      fix: "use a positive integer ID from the matching discovery command",
    })
  return id
}
const positiveInteger = (item: Schema.Json | undefined): item is number =>
  typeof item === "number" && Number.isSafeInteger(item) && item > 0
const sameId = (item: Schema.Json | undefined, expected: string): boolean =>
  (typeof item === "string" || typeof item === "number") && String(item) === expected
const rows = (data: Schema.Json | undefined): JsonObject[] => {
  if (!Array.isArray(data)) return invalid("expected a collection of records")
  return data.map(record)
}
const optionalString = (description: string) => ({
  kind: "flag" as const,
  type: "string" as const,
  description,
})
const activityId = required("Completed activity ID from past or survey-pending, not a workout ID")
const activityDiscovery = (session: string) =>
  follow("past", ["--details"], session, "discover the completed activity ID")
const surveyRead = (input: Flags) => {
  const id = numericId(input, "id")
  return {
    options: get(`/app/api/survey/${id}`),
    response: get(`/app/api/survey/response?id=${id}`),
  }
}

interface SurveyOption {
  readonly id: number
  readonly parentId: number | null
  readonly elementId: number
  readonly kind: number
  readonly type: number
  readonly text: string
}
const optionTypes = new Set([
  ...Array.from({ length: 35 }, (_, index) => index),
  ...Array.from({ length: 24 }, (_, index) => index + 40),
  ...Array.from({ length: 8 }, (_, index) => index + 70),
])
const optionsFrom = (data: Schema.Json | undefined): SurveyOption[] => {
  const options = rows(data).map((item): SurveyOption => {
    if (
      !positiveInteger(item.id) ||
      !positiveInteger(item.elementId) ||
      (item.parentId != null && !positiveInteger(item.parentId)) ||
      typeof item.kind !== "number" ||
      !Number.isInteger(item.kind) ||
      item.kind < 1 ||
      item.kind > 34 ||
      typeof item.type !== "number" ||
      !optionTypes.has(item.type) ||
      typeof item.text !== "string"
    )
      return invalid("invalid survey option")
    return {
      id: item.id,
      parentId: item.parentId ?? null,
      elementId: item.elementId,
      kind: item.kind,
      type: item.type,
      text: item.text,
    }
  })
  if (
    new Set(options.map((option) => option.id)).size !== options.length ||
    new Set(options.map((option) => option.elementId)).size !== options.length
  )
    return invalid("ambiguous survey option IDs")
  for (const option of options) {
    if (option.parentId === null) continue
    const parent = options.find((candidate) => candidate.id === option.parentId)
    if (!parent || parent.parentId !== null || parent.type !== option.type)
      return invalid("survey child has no matching root")
  }
  return options
}
const surveyState = (records: JsonObject, input: Flags): JsonObject => {
  const options = optionsFrom(records.options)
  if (records.response === undefined) return invalid("missing survey response field")
  const response = records.response === null ? null : record(records.response)
  if (response?.id != null && !sameId(response.id, value(input, "id")))
    return invalid("survey response belongs to another activity")
  return { options: options.map((option) => ({ ...option })), response }
}
const reasonIds = (input: Flags): number[] => {
  const raw = value(input, "reasonIds")
  if (raw === "none") return []
  const ids = raw.split(",").map((id) => numericId({ id }, "id"))
  if (ids.length > 3 || new Set(ids).size !== ids.length)
    return answerError("choose at most three distinct reasons, or explicitly choose none")
  return ids
}
// Generic reason-soliciting outcomes from surveys export l, including legacy/PLV3.
const reasonTypes = new Set([
  3, 4, 5, 7, 8, 13, 14, 19, 20, 25, 27, 28, 30, 31, 33, 34, 40, 45, 46, 51, 52, 57, 58, 63,
])
const surveyAnswer = (input: Flags, before: JsonObject): JsonObject => {
  const options = optionsFrom(before.options)
  const root = options.find((option) => option.elementId === numericId(input, "rootId"))
  if (!root || root.parentId !== null)
    return answerError("rootId must select a current root element ID")
  const reasons = reasonIds(input).map((id) => {
    const reason = options.find((option) => option.elementId === id)
    if (!reason || reason.parentId !== root.id || reason.type !== root.type)
      return answerError("reasonId must belong to the selected root")
    return reason
  })
  if (reasons.length > 1 && reasons.some((reason) => reason.kind === 17))
    return answerError("DidNotStruggle cannot be combined with another reason")
  if (reasons.some((reason) => reason.kind >= 21) && reasons.some((reason) => reason.kind < 21))
    return answerError("pass factors cannot be combined with struggle reasons")
  const isRating = root.kind >= 1 && root.kind <= 5
  const needsReason =
    reasonTypes.has(root.type) &&
    options.some((option) => option.parentId === root.id && option.kind < 21)
  if (needsReason && reasons.length === 0)
    return answerError("this answer requires a reason from the selected root")
  const rpe = input.rpe === undefined ? null : Number(value(input, "rpe"))
  if (rpe !== null && before.sliderEnabled !== true)
    return answerError("explicit RPE requires the account's PostWorkoutSlider feature")
  if (
    rpe !== null &&
    (!isRating ||
      !Number.isFinite(rpe) ||
      rpe < 1 ||
      rpe > 5 ||
      !Number.isInteger(rpe * 4) ||
      Math.floor(rpe) !== root.kind)
  )
    return answerError("RPE must be a quarter-step from 1 to 5 matching the root rating")
  const other = [root, ...reasons].some((option) => option.kind === 15 || option.kind === 34)
  const text = input.text === undefined ? null : value(input, "text").trim()
  if (other && !text) return answerError("Other requires the user's feedback text")
  if (!other && text !== null) return answerError("feedback text requires an Other option")
  const multi = reasons.length > 1 || reasons.some((reason) => reason.kind >= 21)
  if (multi && before.multiReasonEnabled !== true)
    return answerError(
      "multiple reasons and pass factors require the account's multi-reason survey feature",
    )
  return {
    id: numericId(input, "id"),
    type: root.type,
    rpeSurveyElementId: root.elementId,
    struggleReasonSurveyElementId: multi ? null : (reasons[0]?.elementId ?? null),
    struggleReasonSurveyElementIds: multi ? reasons.map((reason) => reason.elementId) : [],
    rpe,
    text,
    translatedDisplayName: null,
    deferFlushForward: false,
  }
}

// athlete-data.getTimeline destructures pendingAiFtpChange from the raw timeline
// result, returns it unchanged, and init calls setPendingAiFtpChange with it.
// member-gd6j5htd.tryGetFromApi assigns the raw member-info result unchanged.
const ftpRead: Workflow["reads"] = (_, member) => ({
  status: get(`/app/api/calendar/aiftp/${segment(member.memberId)}/ai-failure-status`),
  timeline: get(`/app/api/react-calendar/${segment(member.memberId)}/timeline`),
  profile: get("/app/api/member-info"),
})
const pendingFtp = (data: Schema.Json | undefined): JsonObject | null => {
  if (data === null) return null
  const pending = record(data)
  if (
    !(
      (typeof pending.id === "string" && pending.id.trim() !== "") ||
      positiveInteger(pending.id)
    ) ||
    (pending.value != null &&
      (typeof pending.value !== "number" || !Number.isFinite(pending.value))) ||
    typeof pending.source !== "number" ||
    !Number.isSafeInteger(pending.source) ||
    (pending.date != null && typeof pending.date !== "string") ||
    (pending.isLowConfidence != null && typeof pending.isLowConfidence !== "boolean") ||
    (pending.isApplied != null && typeof pending.isApplied !== "boolean")
  )
    return invalid("pending FTP change is not an identifiable detection record")
  return {
    id: pending.id,
    value: pending.value ?? null,
    source: pending.source,
    date: pending.date ?? null,
    isLowConfidence: pending.isLowConfidence ?? null,
    isApplied: pending.isApplied ?? null,
  }
}
const ftpState = (records: JsonObject): JsonObject => {
  const status = record(records.status).status
  if (typeof status !== "number" || !Number.isInteger(status) || status < 0 || status > 3)
    return invalid("unknown FTP failure status")
  const profile = record(records.profile)
  if (profile.ftp != null && (typeof profile.ftp !== "number" || !Number.isFinite(profile.ftp)))
    return invalid("invalid account FTP")
  return {
    status,
    statusName: ["CanPredict", "NoData", "NoRecentData", "NoActivities"][status]!,
    currentFtp: profile.ftp ?? null,
    pending: pendingFtp(record(records.timeline).pendingAiFtpChange),
  }
}

const providers: Readonly<Record<number, string>> = {
  0: "garmin",
  1: "strava",
  2: "trainingpeaks",
  3: "dropbox",
  4: "manual",
  5: "zwift",
  6: "wahoo",
  7: "hammerhead",
  8: "finalsurge",
  9: "stages",
  10: "garminhealth",
  11: "tridot",
  13: "apple",
  14: "android",
  15: "rouvy",
  16: "coros",
  17: "simulated",
}
const pushProviders = { garmin: 0, wahoo: 6, hammerhead: 7, coros: 16 } as const
const syncState = (records: JsonObject): JsonObject => ({
  // Deliberate allowlist: connection objects can contain tokens, URLs, and credentials.
  connections: rows(record(records.sync).connections).map((connection) => {
    if (typeof connection.type !== "number" || !Number.isSafeInteger(connection.type))
      return invalid("invalid connection provider type")
    return { type: connection.type, provider: providers[connection.type] ?? "unknown" }
  }),
})
const deliveryState = (records: JsonObject, input: Flags): JsonObject => {
  const id = value(input, "id")
  const details = record(records.details)
  const candidates = [details.workout, details.alternate].filter((item) => item != null)
  const selected = candidates
    .map((item) => record(record(item).details))
    .find((item) => sameId(item.id, id))
  if (!selected)
    throw Errors.notFound({
      message: "workout details do not contain the requested library ID",
      fix: "read workout-library and select the exact outside workout ID",
    })
  identified(selected, id)
  if (selected.isOutside !== true)
    throw Errors.invalidUsage({
      message: "device push requires an outside workout",
      fix: "read workout-library and select an outside workout",
    })
  const roles = record(records.profile).roles
  return {
    ...syncState(records),
    workout: {
      id: selected.id!,
      isOutside: true,
      name: typeof selected.workoutName === "string" ? selected.workoutName : null,
    },
    corosEnabled: Array.isArray(roles) && roles.includes("Coros"),
  }
}

export const athleteWorkflows: readonly Workflow[] = [
  {
    name: "survey-pending",
    summary: "Discover the account's pending completed-activity survey",
    params: {},
    example: "",
    guide: "athlete-feedback",
    reads: () => ({ pending: get("/app/api/survey/check") }),
    select: (records) => ({ pending: records.pending === null ? null : record(records.pending) }),
    discover: activityDiscovery,
    next: (_, session, before) => {
      const pending = before.pending === null ? null : record(before.pending)
      return positiveInteger(pending?.id)
        ? follow(
            "survey-options",
            ["--id", String(pending.id)],
            session,
            "read the choices before asking the user for an answer",
          )
        : activityDiscovery(session)
    },
  },
  {
    name: "survey-options",
    summary: "Read dynamic survey choices and the saved answer for an activity",
    params: { id: activityId },
    example: "--id 123",
    guide: "athlete-feedback",
    reads: surveyRead,
    select: surveyState,
    discover: activityDiscovery,
    next: () => [
      {
        args: ["describe", "--command", "survey-submit", "--json"],
        message:
          "ask the user for their answer, then choose its root and reason element IDs from these options and preview survey-submit",
      },
      {
        args: ["guide", "get", "athlete-feedback", "--json"],
        message:
          "read answer selection, confirmation, and verification guidance before submitting feedback",
      },
    ],
  },
  {
    name: "survey-response",
    summary: "Read the saved survey answer for comparison with a confirmed submission",
    params: { id: activityId },
    example: "--id 123",
    guide: "athlete-feedback",
    reads: (input) => ({ response: get(`/app/api/survey/response?id=${numericId(input, "id")}`) }),
    select: (records, input) => {
      if (records.response === null) return { response: null }
      const response = record(records.response)
      if (response.id != null && !sameId(response.id, value(input, "id")))
        return invalid("survey response belongs to another activity")
      return { response }
    },
    discover: activityDiscovery,
    next: (input, session) =>
      follow(
        "survey-options",
        ["--id", value(input, "id")],
        session,
        "resolve saved element IDs to current answer labels; a missing or different answer requires inspection before any retry",
      ),
  },
  {
    name: "survey-submit",
    summary: "Submit the user's explicit answer using current survey element IDs",
    params: {
      id: activityId,
      rootId: required(
        "Root elementId selected by the user from survey-options, not the option row id",
      ),
      reasonIds: required("Child elementIds chosen by the user, comma-separated, or explicit none"),
      rpe: optionalString("User-provided RPE from 1 to 5 in quarter steps; must match the root"),
      text: optionalString("The user's own feedback, only for Other"),
    },
    example: "--id 123 --root-id 101 --reason-ids none --rpe 2.5",
    guide: "athlete-feedback",
    validate: (input) => {
      numericId(input, "id")
      numericId(input, "rootId")
      reasonIds(input)
    },
    reads: (input) => ({ ...surveyRead(input), profile: get("/app/api/member-info") }),
    select: (records, input) => {
      const roles = record(records.profile).roles
      return {
        ...surveyState(records, input),
        sliderEnabled: Array.isArray(roles) && roles.includes("PostWorkoutSlider"),
        multiReasonEnabled:
          Array.isArray(roles) &&
          roles.includes("PostWorkoutSlider") &&
          roles.includes("MultiReasonSlider"),
      }
    },
    write: (input, _, before) =>
      send("POST", "/app/api/survey/response", surveyAnswer(input, before)),
    discover: activityDiscovery,
    next: (input, session) =>
      follow(
        "survey-response",
        ["--id", value(input, "id")],
        session,
        "compare saved root/reason element IDs, RPE, and text with the confirmed answer before considering a retry; reason arrays may replace the single-reason field",
      ),
  },
  {
    name: "ftp-status",
    summary: "Read account FTP status and discover its pending detection record ID",
    params: {},
    example: "",
    guide: "athlete-feedback",
    reads: ftpRead,
    select: ftpState,
    discover: (session) =>
      follow("ftp-status", [], session, "discover the account's pending detection record"),
    next: (_, session) =>
      follow(
        "ftp",
        [],
        session,
        "inspect current FTP and its history before choosing whether to accept the pending value",
      ),
  },
  {
    name: "ftp-accept",
    summary: "Accept the account's verified pending detection record and FTP value",
    params: {
      id: required("Detection record ID from ftp-status, not member ID or planned activity ID"),
      ftp: required("Explicit FTP value to accept, matching the pending record"),
    },
    example: "--id detection-123 --ftp 250",
    guide: "athlete-feedback",
    reads: ftpRead,
    select: ftpState,
    write: (input, _, before) => {
      const pending = identified(before.pending, value(input, "id"))
      if (
        pending.isApplied === true ||
        typeof pending.source !== "number" ||
        ![22, 23, 24].includes(pending.source) ||
        typeof pending.value !== "number" ||
        pending.value <= 0
      )
        throw Errors.invalidUsage({
          message: "pending FTP record is not supported for acceptance",
          fix: "inspect ftp-status and use TrainerRoad for unsupported or already-applied detections",
        })
      if (Number(value(input, "ftp")) !== pending.value)
        throw Errors.invalidUsage({
          message: "requested FTP differs from the pending detection",
          fix: "read ftp-status and obtain intent to accept the exact pending FTP value",
        })
      return send("POST", `/app/api/calendar/aiftp/${segment(value(input, "id"))}/accept`)
    },
    discover: (session) =>
      follow("ftp-status", [], session, "discover the pending detection record ID and value"),
    next: (input, session) =>
      follow(
        "ftp-status",
        [],
        session,
        `verify current FTP is ${value(input, "ftp")} and pending record ${value(input, "id")} is cleared; do not resubmit while recalculation is pending`,
      ),
  },
  {
    name: "sync-list",
    summary: "List connected provider types without exposing connection tokens",
    params: {},
    example: "",
    guide: "workout-delivery",
    reads: () => ({ sync: get("/app/api/activity-sync") }),
    select: syncState,
    discover: (session) => follow("sync-list", [], session, "discover connected provider types"),
    next: (_, session) => [
      ...follow(
        "workout-library",
        ["--outside", "true"],
        session,
        "discover an outside workout library ID to send to a connected device",
      ),
      {
        args: ["guide", "get", "workout-delivery", "--json"],
        message:
          "read delivery confirmation and device verification guidance before requesting a push",
      },
    ],
  },
  {
    name: "workout-push",
    summary: "Request delivery of an outside library workout to a connected device",
    params: {
      id: required("Outside workout library ID from workout-library"),
      provider: choice("Explicit connected device destination", [
        "garmin",
        "wahoo",
        "hammerhead",
        "coros",
      ]),
    },
    example: "--id 123 --provider garmin",
    guide: "workout-delivery",
    reads: (input) => ({
      details: get(`/app/api/workoutdetails/${numericId(input, "id")}`),
      sync: get("/app/api/activity-sync"),
      profile: get("/app/api/member-info"),
    }),
    select: deliveryState,
    write: (input, _, before) => {
      const provider = value(input, "provider")
      const type = Object.entries(pushProviders).find(([name]) => name === provider)?.[1]
      if (
        type === undefined ||
        !rows(before.connections).some((item) => item.type === type) ||
        (provider === "coros" && before.corosEnabled !== true)
      )
        throw Errors.invalidUsage({
          message: "provider is not connected or not enabled for workout push",
          fix: "read sync-list and choose a connected, supported device provider",
        })
      // write marks this GET as a mutation in the runner: confirmation and one dispatch.
      return send("GET", `/app/api/workouts/${numericId(input, "id")}/${provider}/push`)
    },
    discover: (session) => [
      ...follow("workout-library", [], session, "discover the outside workout library ID"),
      ...follow("sync-list", [], session, "discover connected device providers"),
    ],
    next: (_, session) =>
      follow(
        "sync-list",
        [],
        session,
        "reread connections, then verify the workout on the provider or device; connection presence and HTTP acknowledgement do not prove delivery, so do not push again blindly",
      ),
  },
]
