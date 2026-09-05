import { TrainerRoadClient } from "../trainerroad-client.mjs"
import { queryDependencies } from "./query-dependencies.mjs"
import { canonicalJson } from "../contract/token.ts"
import { Errors } from "../errors.ts"
import { Schema } from "effect"
import { Member, RawActivity, CalendarDate, normalizeActivity } from "../domain/calendar.ts"
import { commandAnnotations } from "../operations/annotations.mjs"
import { commandEvents } from "../operations/events.mjs"
import { commandFtp, commandFtpPrediction } from "../operations/ftp.mjs"
import { commandLevels } from "../operations/levels.mjs"
import { commandPlan } from "../operations/plan.mjs"
import { commandPowerRanking, commandPowerRecords } from "../operations/power.mjs"
import { commandTimeline } from "../operations/timeline.mjs"
import { commandTrainNow } from "../operations/train-now.mjs"
import { commandWeightHistory } from "../operations/weight-history.mjs"
import { commandWorkoutLibrary } from "../operations/workout-library.mjs"
import { commandWorkoutRecommend } from "../operations/workout-recommend.mjs"
import {
  commandAddWorkout,
  commandCopyWorkout,
  commandWorkoutDetails,
} from "../operations/workout-tools.mjs"
import {
  commandReplaceWorkout,
  commandSwitchWorkout,
  commandWorkoutAlternates,
  commandRemoveWorkout,
} from "../operations/workout-mutations.mjs"
import {
  commandAddAnnotation,
  commandAnnotationDetails,
  commandRemoveAnnotation,
} from "../operations/annotation-mutations.mjs"
import { commandAddEvent } from "../operations/event-mutations.mjs"
import { commandFuture, commandPast, commandToday } from "../operations/workouts.mjs"

const operations = {
  timeline: commandTimeline,
  "train-now": commandTrainNow,
  events: commandEvents,
  annotations: commandAnnotations,
  levels: commandLevels,
  plan: commandPlan,
  "weight-history": commandWeightHistory,
  today: commandToday,
  future: commandFuture,
  past: commandPast,
  ftp: commandFtp,
  "ftp-prediction": commandFtpPrediction,
  "power-ranking": commandPowerRanking,
  "power-records": commandPowerRecords,
  "workout-library": commandWorkoutLibrary,
  "workout-recommend": commandWorkoutRecommend,
  "workout-details": commandWorkoutDetails,
  "add-workout": commandAddWorkout,
  "copy-workout": commandCopyWorkout,
  "workout-alternates": commandWorkoutAlternates,
  "replace-workout": commandReplaceWorkout,
  "switch-workout": commandSwitchWorkout,
  "add-event": commandAddEvent,
  "remove-workout": commandRemoveWorkout,
  "annotation-details": commandAnnotationDetails,
  "add-annotation": commandAddAnnotation,
  "remove-annotation": commandRemoveAnnotation,
}
const WRITES = new Set([
  "tryAddWorkoutToCalendar",
  "copyPlannedActivity",
  "replacePlannedActivityWithAlternate",
  "switchPlannedActivityMode",
  "createEvent",
  "deletePlannedActivity",
  "createAnnotation",
  "deleteAnnotation",
])
const READS = new Set([
  "getMemberInfo",
  "getPublicTssByUsername",
  "getTimeline",
  "getActivitiesByIds",
  "getPlannedActivitiesByIds",
  "getWeightHistory",
  "getCurrentCustomPlan",
  "getAllUserPlans",
  "getPlanPhases",
  "getCareerSummary",
  "getCareerLevels",
  "getAiFtpEligibility",
  "getAiFtpFailureStatus",
  "getPowerRanking",
  "getOnboardingPersonalRecords",
  "getSeasons",
  "getPersonalRecordsForDateRange",
  "getWorkoutProfilesByZone",
  "searchWorkoutLibrary",
  "getWorkoutsByIds",
  "getWorkoutSummary",
  "getWorkoutLevels",
  "getWorkoutChartData",
  "getWorkoutInformation",
  "getTrainNowStatus",
  "getTrainNowSuggestions",
  "getPlannedActivity",
  "getPlannedActivityAlternates",
  "getAnnotation",
  "getPersonalRecordsByActivityIds",
])
const stale = () =>
  Errors.staleConfirmation({
    message: "the confirmed account or calendar state changed",
    fix: "run the command without --confirm and inspect the new plan",
  })
const uncertain = () =>
  Errors.cannotWrite({
    message: "the write could not be verified and may already have happened",
    fix: "read the calendar before retrying; do not repeat this write blindly",
    guides: ["calendar-changes"],
  })

// Each operation receives this capability-limited facade, never the session jar.
export async function runOperation(
  name,
  flags,
  phase,
  now,
  signal,
  expected,
  factory = (options) => new TrainerRoadClient(options),
) {
  const raw = factory({ sessionFile: flags["session-file"], signal })
  const loaded = flags.public && flags.target ? false : await raw.loadSession()
  let member = null
  if (loaded) {
    try {
      member = await raw.getMemberInfo()
      if (!Schema.is(Member)(member))
        throw Errors.invalidData({
          message: "unexpected account response",
          fix: "check the account response before continuing",
        })
    } catch (error) {
      if (!(flags.target && (error.status === 401 || error.status === 403))) throw error
    }
  }
  if (!member && !flags.target)
    throw Errors.authFailure({
      message: "no authenticated account",
      fix: "run trainerroad-cli login --username <username> --password-stdin --yes",
    })
  let written = false
  let checking = false
  const observed = new Map()
  const facade = Object.fromEntries(
    [...READS, ...WRITES].map((method) => [
      method,
      async (...args) => {
        if (WRITES.has(method)) {
          if (phase !== "apply" || !checking)
            throw new Error("write capability used while planning")
          if (written) throw uncertain()
          written = true
        }
        const result =
          method === "getMemberInfo"
            ? member
            : method === "getTimeline" || method === "getPlannedActivity"
              ? await raw[method](args[0], args[1], { fresh: true })
              : await raw[method](...args)
        if (
          method === "getPlannedActivity" &&
          (!Schema.is(RawActivity)(result) ||
            String(result.id) !== String(args[0]) ||
            !Schema.is(CalendarDate)(normalizeActivity(result).date))
        )
          throw Errors.invalidData({
            message: "unexpected planned activity",
            fix: "check the selected id and date before proceeding",
          })
        if (method === "getAnnotation" && String(result?.id) !== String(args[0]))
          throw Errors.invalidData({
            message: "unexpected annotation id",
            fix: "check the selected annotation before proceeding",
          })
        if (method === "getTimeline") {
          if (!Array.isArray(result?.plannedActivities))
            throw Errors.invalidData({
              message: "unexpected timeline response",
              fix: "check the calendar response before continuing",
            })
          for (const activity of result.plannedActivities) {
            if (
              !Schema.is(RawActivity)(activity) ||
              !Schema.is(CalendarDate)(normalizeActivity(activity).date)
            )
              throw Errors.invalidData({
                message: "invalid calendar activity",
                fix: "check the calendar date and activity id before continuing",
              })
          }
        }
        if (phase !== "query" && !written && READS.has(method)) {
          const key = JSON.stringify([method, args])
          const value = canonicalJson(JSON.parse(JSON.stringify(result ?? null)))
          if (checking && observed.has(key) && value !== observed.get(key)) throw stale()
          if (!checking) observed.set(key, value)
        }
        return result
      },
    ]),
  )
  const deps = queryDependencies({ client: facade, member, flags, timeZone: flags.tz, now })
  const operation = operations[name]
  if (!operation) throw new Error("unknown operation")
  const execute = async (dryRun) => {
    const result = await operation({ ...flags, "dry-run": dryRun }, deps)
    // Legacy normalizers use undefined for omitted fields. The new boundary returns JSON values only.
    return JSON.parse(JSON.stringify(result))
  }
  if (phase !== "apply") return execute(phase === "plan")
  const preview = await execute(true)
  delete preview.generatedAt
  if (canonicalJson(preview) !== canonicalJson(expected)) throw stale()
  checking = true
  try {
    const output = await execute(false)
    if (written && (output.annotation === null || output.event === null)) throw uncertain()
    if (
      written &&
      name === "replace-workout" &&
      (String(output.after?.plannedActivityId) !== String(flags.id) ||
        Number(output.after?.workoutId) !== Number(flags["alternate-id"]))
    )
      throw uncertain()
    if (
      written &&
      name === "switch-workout" &&
      (String(output.after?.plannedActivityId) !== String(flags.id) ||
        output.after?.isOutside !== (flags.mode === "outside"))
    )
      throw uncertain()
    if (written && (name === "remove-workout" || name === "remove-annotation")) {
      let absent = false
      try {
        if (name === "remove-workout")
          await raw.getPlannedActivity(flags.id, member.username, { fresh: true })
        else await raw.getAnnotation(flags.id, member.username)
      } catch (error) {
        if (error.status === 404) absent = true
        else throw error
      }
      if (!absent) throw uncertain()
    }
    return output
  } catch (error) {
    if (written) throw uncertain()
    throw error
  }
}
