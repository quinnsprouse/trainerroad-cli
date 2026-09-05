import type { Schema } from "effect"
import { Errors } from "../errors.ts"
import type { JsonObject } from "./operation.ts"
import { follow, get, record, required, segment, send, value, type Workflow } from "./workflow.ts"

const invalid = (message: string): never => {
  throw Errors.invalidData({
    message,
    fix: "inspect the matching read command in TrainerRoad before continuing; do not infer missing fitness state",
  })
}
const rows = (data: Schema.Json | undefined): JsonObject[] => {
  if (!Array.isArray(data)) return invalid("expected fitness records")
  return data.map(record)
}
const isId = (data: Schema.Json | undefined): data is string | number =>
  (typeof data === "string" && data.trim().length > 0) ||
  (typeof data === "number" && Number.isSafeInteger(data) && data > 0)
const matches = (data: Schema.Json | undefined, expected: string): boolean =>
  isId(data) && String(data) === expected
const optionalNumber = (data: Schema.Json | undefined): number | null => {
  if (data == null) return null
  if (typeof data !== "number" || !Number.isFinite(data)) return invalid("invalid fitness value")
  return data
}

// calendar-k861i5ew.js displays raw value/units. Preserve recorded units rather
// than treating a measurement as the member's current display preference.
const weightState = (records: JsonObject, id: string): JsonObject => {
  const selected = rows(records.history).filter((item) => matches(item.id, id))
  if (selected.length === 0)
    throw Errors.notFound({
      message: "weight record was not found in this account's history",
      fix: "read weight-history with the same session and select a current record ID",
    })
  if (selected.length !== 1) return invalid("ambiguous weight record ID")
  const item = selected[0]!
  if (
    !isId(item.id) ||
    typeof item.date !== "string" ||
    item.date.trim() === "" ||
    (item.units !== 0 && item.units !== 1)
  )
    return invalid("invalid weight record date or units")
  const amount = optionalNumber(item.value)
  if (amount === null || amount <= 0) return invalid("invalid weight measurement")
  return {
    weight: {
      id: item.id,
      date: item.date,
      value: amount,
      units: item.units,
      unitName: item.units === 1 ? "pounds" : "kilograms",
    },
  }
}

// dismissInlineBreakthrough in ai-ftp-detection.service-o301xvoq.js stores the
// viewedPredictionId setting. It does not accept or reject the FTP prediction.
const promptReads: Workflow["reads"] = (_, member) => ({
  timeline: get(`/app/api/react-calendar/${segment(member.memberId)}/timeline`),
  settings: get("/app/api/membersettings?names=viewedPredictionId"),
  profile: get("/app/api/member-info"),
  survey: get("/app/api/survey/check"),
})
const pendingChange = (data: Schema.Json | undefined): JsonObject | null => {
  if (data === null) return null
  const item = record(data)
  if (!isId(item.id) || typeof item.source !== "number" || !Number.isSafeInteger(item.source))
    return invalid("pending FTP record has no valid identity or source")
  if (item.isApplied != null && typeof item.isApplied !== "boolean")
    return invalid("invalid pending FTP applied flag")
  return {
    id: item.id,
    source: item.source,
    value: optionalNumber(item.value),
    isApplied: item.isApplied ?? null,
  }
}
const promptState = (records: JsonObject): JsonObject => {
  const profile = record(records.profile)
  if (
    !isId(profile.memberId) ||
    !Array.isArray(profile.roles) ||
    !profile.roles.every((role) => typeof role === "string")
  )
    return invalid("missing account identity or roles")
  const settings = rows(records.settings)
  // The settings service mirrors PascalCase response names to camelCase.
  const viewed = settings.filter(
    (item) => typeof item.name === "string" && item.name.toLowerCase() === "viewedpredictionid",
  )
  if (viewed.length > 1 || settings.length !== viewed.length)
    return invalid("unexpected or ambiguous viewedPredictionId response")
  const viewedId = viewed[0]?.value ?? null
  if (viewedId !== null && !isId(viewedId)) return invalid("invalid viewed prediction ID")
  const pending = pendingChange(record(records.timeline).pendingAiFtpChange)
  const ftp = optionalNumber(profile.ftp)
  const hasRole = profile.roles.includes("AiFtpBreakthrough")
  if (records.survey === undefined) return invalid("missing pending survey state")
  const surveyOutstanding = records.survey !== null
  if (surveyOutstanding) record(records.survey)
  // Match the breakthrough display gate without claiming that a modal is open.
  const alreadyViewed = pending !== null && viewedId !== null && pending.id === viewedId
  const reason =
    pending === null
      ? "no-pending-record"
      : pending.source !== 24
        ? "not-breakthrough"
        : pending.isApplied === true
          ? "already-applied"
          : !hasRole
            ? "feature-unavailable"
            : ftp === null || ftp <= 0
              ? "no-account-ftp"
              : typeof pending.value !== "number" || pending.value <= 0
                ? "no-predicted-ftp"
                : surveyOutstanding
                  ? "survey-outstanding"
                  : alreadyViewed
                    ? "already-viewed"
                    : "ready"
  return {
    accountMemberId: profile.memberId,
    accountFtp: ftp,
    pending,
    viewedPredictionId: viewedId,
    settingExists: viewed.length === 1,
    breakthroughEnabled: hasRole,
    surveyOutstanding,
    canDismiss: reason === "ready",
    reason,
  }
}

export const fitnessWorkflows: readonly Workflow[] = [
  {
    name: "weight-record",
    summary: "Read one account weight record with its original value and units",
    params: { id: required("Weight-history record ID, not member or activity ID") },
    example: "--id 123",
    guide: "session-and-ids",
    validate: (input) => {
      segment(value(input, "id"))
    },
    reads: (_, member) => ({
      history: get(`/app/api/weight-history/${segment(member.memberId)}/all`),
    }),
    select: (records, input) => weightState(records, value(input, "id")),
    discover: (session) =>
      follow("weight-history", [], session, "discover weight record IDs for this account"),
    next: (_, session) =>
      follow(
        "weight-history",
        [],
        session,
        "compare this measurement with surrounding records; use TrainerRoad for weight edits because their complete write contract is unverified",
      ),
  },
  {
    name: "ftp-prompt",
    summary: "Read the pending FTP breakthrough and its persisted dismissal state",
    params: {},
    example: "",
    guide: "athlete-feedback",
    reads: promptReads,
    select: promptState,
    discover: (session) =>
      follow("ftp-status", [], session, "discover the account's pending FTP detection record"),
    next: (_, session, before) =>
      before.reason === "survey-outstanding"
        ? follow(
            "survey-pending",
            [],
            session,
            "resolve the outstanding athlete survey before deciding about the breakthrough",
          )
        : before.canDismiss === true
          ? [
              {
                args: ["describe", "--command", "ftp-dismiss", "--json"],
                message:
                  "ask whether the user wants to dismiss this breakthrough prompt; dismissal does not accept or reject the FTP value",
              },
              {
                args: ["guide", "get", "athlete-feedback", "--json"],
                message: "review fitness feedback and verification guidance before a mutation",
              },
            ]
          : follow(
              "ftp-status",
              [],
              session,
              "inspect account FTP and pending detection state; this prompt is not eligible for dismissal through this flow",
            ),
  },
  {
    name: "ftp-dismiss",
    summary: "Mark the pending FTP breakthrough prompt as viewed without changing FTP",
    params: {
      id: required("Pending breakthrough detection record ID from ftp-prompt"),
    },
    example: "--id 789",
    guide: "athlete-feedback",
    validate: (input) => {
      segment(value(input, "id"))
    },
    reads: promptReads,
    select: promptState,
    write: (input, member, before) => {
      if (!matches(before.accountMemberId, String(member.memberId)))
        throw Errors.invalidData({
          message: "fitness state belongs to another account",
          fix: "read ftp-prompt with the intended session and inspect a fresh preview",
        })
      if (before.canDismiss !== true)
        throw Errors.invalidUsage({
          message: "this pending prompt cannot be dismissed with the requested action",
          fix: "read ftp-prompt and resolve its reason before requesting a fresh preview",
        })
      const pending = record(before.pending)
      if (!matches(pending.id, value(input, "id")))
        throw Errors.invalidData({
          message: "requested detection ID differs from the account's pending breakthrough",
          fix: "read ftp-prompt and use the exact pending detection record ID",
        })
      if (!isId(pending.id)) return invalid("pending detection ID is missing")
      return send("PUT", "/app/api/membersettings", {
        name: "viewedPredictionId",
        value: pending.id,
      })
    },
    discover: (session) =>
      follow("ftp-prompt", [], session, "discover the pending breakthrough ID and dismissal state"),
    next: (input, session) =>
      follow(
        "ftp-prompt",
        [],
        session,
        `verify viewedPredictionId equals ${value(input, "id")} and account FTP is unchanged from the preview; pending data may remain, so do not repeat dismissal to clear it`,
      ),
  },
]
