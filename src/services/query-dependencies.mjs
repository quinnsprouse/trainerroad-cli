import { filterFuturePlanned, filterPastActivities } from "../trainerroad-client.mjs"
import { applyAgentRecordFilters } from "../lib/agent-filters.mjs"
import {
  parseApiDateTime,
  summarizeActivityTimeWindow,
  toDateOnlyInTimeZone,
  shiftDateOnly,
} from "../lib/timezone.mjs"

export function queryDependencies({ client, member, flags, timeZone, now }) {
  function isoDateShift(days) {
    return shiftDateOnly(toDateOnlyInTimeZone(new Date(now), timeZone), days)
  }

  function toIsoDateFromPlanned(item) {
    return `${String(item.date.year).padStart(4, "0")}-${String(item.date.month).padStart(2, "0")}-${String(item.date.day).padStart(2, "0")}`
  }

  function toIsoDate(value) {
    if (typeof value === "string" && value.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10)
    }
    return (
      toDateOnlyInTimeZone(value, timeZone, { assumeUtcForOffsetlessDateTime: true }) ??
      new Date(value).toISOString().slice(0, 10)
    )
  }

  function summarizeActivityTime(started, durationInSeconds) {
    return summarizeActivityTimeWindow(started, durationInSeconds, timeZone, {
      assumeUtcForOffsetlessDateTime: true,
    })
  }

  function normalizeDateOnlyInput(value, fallback) {
    if (value == null || value === "") return fallback
    const normalized = String(value).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`)
    }
    return normalized
  }

  function requireNumber(value, fallback) {
    if (value == null) return fallback
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return parsed
  }

  function requirePositiveInteger(value, fallback) {
    const parsed = requireNumber(value, fallback)
    if (!Number.isInteger(parsed) || parsed < 1) return fallback
    return parsed
  }

  function toBoolean(value, fallback = false) {
    if (value == null) return fallback
    if (typeof value === "boolean") return value
    if (typeof value === "number") return value !== 0
    const normalized = String(value).trim().toLowerCase()
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false
    return fallback
  }

  function normalizeFtpHistory(raw) {
    const records = Array.isArray(raw) ? raw : []
    return records
      .map((item) => {
        const dateRaw = item?.date ?? item?.Date ?? null
        const valueRaw = item?.value ?? item?.Value ?? null
        const value = Number(valueRaw)
        if (!dateRaw || !Number.isFinite(value)) return null
        const parsedDate = parseApiDateTime(dateRaw, { assumeUtcForOffsetlessDateTime: true })
        if (!parsedDate) return null
        return {
          date: parsedDate.toISOString(),
          dateOnly: toIsoDate(dateRaw),
          value,
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  function getLastItem(values) {
    if (!Array.isArray(values) || values.length === 0) return null
    return values[values.length - 1]
  }

  function compactPersonalRecord(record) {
    return {
      seconds: record?.seconds ?? record?.Seconds ?? null,
      watts: record?.watts ?? record?.Watts ?? null,
      workoutDate: record?.workoutDate ?? record?.WorkoutDate ?? null,
      workoutSeconds: record?.workoutSeconds ?? record?.WorkoutSeconds ?? null,
      workoutGuid: record?.workoutGuid ?? record?.WorkoutGuid ?? null,
      workoutRecordId: record?.workoutRecordId ?? record?.WorkoutRecordId ?? null,
      workoutRecordName: record?.workoutRecordName ?? record?.WorkoutRecordName ?? null,
      surveyResponse: record?.surveyResponseTranslated ?? record?.SurveyResponseTranslated ?? null,
    }
  }

  function normalizeFitnessThresholds(raw) {
    const rows = Array.isArray(raw) ? raw : []
    return rows
      .map((item) => {
        const dateRaw = item?.date ?? item?.Date ?? null
        const valueRaw = item?.value ?? item?.Value ?? null
        const value = Number(valueRaw)
        if (!dateRaw || !Number.isFinite(value)) return null
        const parsedDate = parseApiDateTime(dateRaw, { assumeUtcForOffsetlessDateTime: true })
        if (!parsedDate) return null
        return {
          id: item?.id ?? item?.Id ?? null,
          date: parsedDate.toISOString(),
          dateOnly: toIsoDate(dateRaw),
          value,
          isApplied: Boolean(item?.isApplied ?? item?.IsApplied),
          isEnabled: item?.isEnabled ?? item?.IsEnabled ?? null,
          source: item?.source ?? item?.Source ?? null,
          viewed: item?.viewed ?? item?.Viewed ?? null,
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  function dateOnlyDiffDays(fromDateOnly, toDateOnly) {
    const fromMs = Date.parse(`${fromDateOnly}T00:00:00Z`)
    const toMs = Date.parse(`${toDateOnly}T00:00:00Z`)
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null
    return Math.round((toMs - fromMs) / 86_400_000)
  }

  function countPlannedWorkoutsInRange(plannedActivities, fromDateOnly, toDateOnly) {
    const rows = Array.isArray(plannedActivities) ? plannedActivities : []
    return rows.filter((item) => {
      const date = toIsoDateFromPlanned(item)
      if (date < fromDateOnly || date > toDateOnly) return false
      const type = Number(item?.type)
      return item?.workoutId != null || type === 1
    }).length
  }

  function flattenPublicTssDays(publicTss) {
    const weeks = Array.isArray(publicTss?.tssByDay)
      ? publicTss.tssByDay
      : Array.isArray(publicTss?.TssByDay)
        ? publicTss.TssByDay
        : []
    return weeks
      .flat()
      .filter((day) => day?.date || day?.Date)
      .map((day) => ({
        date: toIsoDate(day.date ?? day.Date),
        tss: day.tss ?? day.Tss ?? 0,
        tssTrainerRoad: day.tssTrainerRoad ?? day.TssTrainerRoad ?? 0,
        tssOther: day.tssOther ?? day.TssOther ?? 0,
        plannedTssTrainerRoad: day.plannedTssTrainerRoad ?? day.PlannedTssTrainerRoad ?? 0,
        plannedTssOther: day.plannedTssOther ?? day.PlannedTssOther ?? 0,
        plannedTssTotal:
          (day.plannedTssTrainerRoad ?? day.PlannedTssTrainerRoad ?? 0) +
          (day.plannedTssOther ?? day.PlannedTssOther ?? 0),
        hasRides: Boolean(day.hasRides ?? day.HasRides),
      }))
  }

  function sortByDateAsc(days) {
    return [...days].sort((a, b) => a.date.localeCompare(b.date))
  }

  function sortByDateDesc(days) {
    return [...days].sort((a, b) => b.date.localeCompare(a.date))
  }

  const withClient = async () => client
  const resolveQueryContext = async () => {
    const target = flags.target
    if (member && !flags.public && (!target || target === member.username)) {
      const timeline = await client.getTimeline(member.memberId, member.username, { fresh: true })
      return {
        mode: "private",
        client,
        authenticatedMemberInfo: member,
        memberInfo: member,
        targetUsername: member.username,
        timeline,
      }
    }
    const username = target ?? member?.username
    if (!username)
      throw new Error("Authentication required. Use login or --public --target <username>.")
    const publicTss = await client.getPublicTssByUsername(username)
    return {
      mode: "public",
      client,
      authenticatedMemberInfo: member,
      targetUsername: username,
      publicTss,
      publicDays: flattenPublicTssDays(publicTss),
    }
  }
  const requirePrivateContext = (context) => {
    if (context.mode !== "private") throw new Error("Authentication required. Run login first.")
  }
  const requireFlag = (_command, input, name) => {
    if (input[name] == null || input[name] === "")
      throw new Error("Missing required flag --" + name)
    return input[name]
  }
  return {
    timeZone,
    todayDateOnly: isoDateShift(0),
    withClient,
    resolveQueryContext,
    requirePrivateContext,
    requireFlag,
    applyAgentRecordFilters,
    requirePositiveInteger,
    requireNumber,
    toBoolean,
    normalizeDateOnlyInput,
    isoDateShift,
    filterFuturePlanned,
    filterPastActivities: (rows, from, to) => filterPastActivities(rows, from, to, timeZone),
    sortByDateAsc,
    sortByDateDesc,
    toIsoDateFromPlanned,
    toIsoDate,
    summarizeActivityTime,
    normalizeFtpHistory,
    getLastItem,
    normalizeFitnessThresholds,
    dateOnlyDiffDays,
    countPlannedWorkoutsInRange,
    compactPersonalRecord,
  }
}
