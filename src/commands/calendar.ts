import { Effect } from "effect"
import { defineMutation, defineQuery } from "../contract/contract.ts"
import { AccountProfile, MovePlan, MoveResult, calendarDate } from "../domain/calendar.ts"
import { moveFollowUp } from "../domain/follow-up.ts"
import { Errors } from "../errors.ts"
import { TrainerRoadReader, TrainerRoadWriter } from "../services/trainerroad.ts"

const sessionFile = {
  kind: "flag",
  type: "path",
  description: "Existing session file; defaults to TR_SESSION_FILE or .trainerroad/session.json",
} as const
const readErrors = [
  "invalid_usage",
  "auth_failure",
  "not_found",
  "invalid_data",
  "invalid_config",
  "service_unavailable",
] as const
export const whoami = defineQuery({
  name: "whoami",
  summary: "Show the account authenticated by the saved session",
  stability: "stable",
  params: { sessionFile },
  dataSchema: AccountProfile,
  domainErrorCodes: readErrors,
  guides: ["session-and-ids"],
  examples: [
    {
      command: "trainerroad-cli whoami --json",
      description: "Check the account before reading or changing its calendar",
    },
  ],
  handler: Effect.fn("whoami.handler")(function* (input) {
    const reader = yield* TrainerRoadReader
    return (yield* reader.account(input.sessionFile)).profile
  }),
  renderText: (data) => `${data.username} (${data.memberId})`,
})

export const moveWorkout = defineMutation({
  name: "move-workout",
  summary: "Preview and confirm a planned activity's new calendar date",
  stability: "stable",
  idempotency: { kind: "always" },
  params: {
    id: {
      kind: "flag",
      type: "string",
      required: true,
      description: "Required planned activity id from future, not workoutId",
    },
    to: {
      kind: "flag",
      type: "string",
      required: true,
      description: "Required target date, YYYY-MM-DD",
    },
    sessionFile,
  },
  planSchema: MovePlan,
  dataSchema: MoveResult,
  domainErrorCodes: [...readErrors, "stale_confirmation", "cannot_write"],
  guides: ["calendar-changes", "session-and-ids"],
  examples: [
    {
      command: "trainerroad-cli move-workout --id planned-123 --to 2026-09-12 --dry-run --json",
      description: "Preview without changing the calendar",
    },
  ],
  plan: Effect.fn("moveWorkout.plan")(function* (input) {
    if (input.id === undefined || input.id.trim().length === 0)
      return yield* Errors.invalidUsage({
        message: "missing planned activity --id",
        fix: "read future and pass a row's id, not its workoutId",
      })
    const to = yield* calendarDate(input.to, "to")
    const reader = yield* TrainerRoadReader
    const {
      sessionFile: file,
      member,
      activity,
    } = yield* reader.planned(input.id, input.sessionFile)
    if (activity.canMove === false && activity.date !== to)
      return yield* Errors.invalidData({
        message: "this planned activity cannot be moved",
        fix: "choose a movable planned workout in the calendar",
      })
    return { sessionFile: file, member, before: activity, to }
  }),
  apply: Effect.fn("moveWorkout.apply")(function* (plan) {
    const writer = yield* TrainerRoadWriter
    return yield* writer.move(plan)
  }),
  renderPlanText: (plan) =>
    plan.before.date === plan.to
      ? `No change: ${plan.before.id} is already on ${plan.to} for ${plan.member.username}`
      : `Move ${plan.before.id} from ${plan.before.date} to ${plan.to} for ${plan.member.username}`,
  renderText: (data) =>
    `${data.changed ? "Moved" : "Unchanged"}: ${data.after.id} on ${data.after.date}`,
  next: ({ plan }) => moveFollowUp(plan),
})
