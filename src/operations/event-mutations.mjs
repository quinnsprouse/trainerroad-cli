import { compactEventRecord } from "../lib/planning-normalizers.mjs"

// Discipline ids from the web app's event picker (2026-09-02).
export const EVENT_DISCIPLINES = {
  "climbing-road-race": 0,
  "rolling-road-race": 1,
  "time-trial": 2,
  criterium: 3,
  "gran-fondo": 4,
  cyclocross: 5,
  "sprint-triathlon": 6,
  "olympic-triathlon": 7,
  "half-triathlon": 8,
  "full-triathlon": 9,
  "off-road-triathlon": 10,
  "xc-olympic": 11,
  "xc-marathon": 12,
  "short-track": 13,
  gravity: 14,
  enduro: 15,
  gravel: 16,
}

const RACE_PRIORITIES = { a: 3, b: 2, c: 1 }
const STRESS_ESTIMATE_TSS = 1
const STRESS_ESTIMATE_INTENSITY = 2

const ADAPTIVE_NOTE =
  "TrainerRoad builds and adapts the plan around A and B events, so adding one can reshape upcoming workouts. Re-read `future` afterwards."

function disciplineLabel(id) {
  return (
    Object.entries(EVENT_DISCIPLINES).find(([, value]) => value === id)?.[0] ?? `discipline-${id}`
  )
}

function resolveDiscipline(value) {
  if (value === undefined || value === null || value === "") return null
  const raw = String(value).trim().toLowerCase()
  if (/^\d+$/.test(raw)) {
    const id = Number(raw)
    return { id, label: disciplineLabel(id) }
  }
  const key = raw.replace(/[\s_]+/g, "-")
  if (EVENT_DISCIPLINES[key] === undefined) return null
  return { id: EVENT_DISCIPLINES[key], label: key }
}

function resolvePriority(value) {
  const raw = String(value ?? "b")
    .trim()
    .toLowerCase()
  if (/^[123]$/.test(raw)) return Number(raw)
  return RACE_PRIORITIES[raw] ?? null
}

async function requirePrivateMember(flags, deps) {
  const { withClient } = deps
  const client = await withClient(flags)
  try {
    const memberInfo = await client.getMemberInfo()
    return { client, memberInfo }
  } catch {
    throw new Error(
      "This command requires private authenticated mode. Login first with trainerroad-cli login.",
    )
  }
}

async function eventIdsOnCalendar(client, memberInfo) {
  const timeline = await client.getTimeline(memberInfo.memberId, memberInfo.username)
  const rows = Array.isArray(timeline?.events) ? timeline.events : []
  return new Map(rows.filter((row) => row?.id).map((row) => [String(row.id), row]))
}

export async function commandAddEvent(flags, deps) {
  const { requireFlag, toBoolean, normalizeDateOnlyInput, requirePositiveInteger, requireNumber } =
    deps
  const dryRun = toBoolean(flags["dry-run"], false)
  const name = String(requireFlag("add-event", flags, "name"))
  const date = normalizeDateOnlyInput(requireFlag("add-event", flags, "date"), null)
  if (!date) throw new Error(`Invalid --date "${flags.date}". Expected YYYY-MM-DD.`)
  const discipline = resolveDiscipline(requireFlag("add-event", flags, "discipline"))
  if (!discipline) {
    throw new Error(
      `Invalid --discipline "${flags.discipline}". Expected one of: ${Object.keys(EVENT_DISCIPLINES).join(", ")}, or a numeric id.`,
    )
  }
  const priority = resolvePriority(flags.priority)
  if (priority === null)
    throw new Error(`Invalid --priority "${flags.priority}". Expected A, B, or C.`)
  const durationMinutes = requirePositiveInteger(flags.duration, null)
  if (!durationMinutes) throw new Error("--duration <minutes> is required for add-event.")

  const tss =
    flags.tss !== undefined && flags.tss !== null && flags.tss !== ""
      ? requireNumber(flags.tss, null)
      : null
  const intensity =
    flags.intensity !== undefined && flags.intensity !== null && flags.intensity !== ""
      ? requireNumber(flags.intensity, null)
      : null
  if (tss === null && intensity === null) {
    throw new Error(
      "add-event needs either --tss <number> or --intensity <1-10> so TrainerRoad can estimate the event's stress.",
    )
  }
  const notes = flags.notes !== undefined && flags.notes !== null ? String(flags.notes) : ""

  const request = {
    customPlanId: null,
    name,
    date,
    time: null,
    discipline: discipline.id,
    duration: durationMinutes * 60,
    notes,
    racePriority: priority,
    stressEstimateType: tss !== null ? STRESS_ESTIMATE_TSS : STRESS_ESTIMATE_INTENSITY,
    stressEstimateValue: tss !== null ? null : intensity,
    tss: tss !== null ? tss : null,
    manuallyCompleted: false,
  }
  const priorityLabel = Object.entries(RACE_PRIORITIES)
    .find(([, value]) => value === priority)[0]
    .toUpperCase()
  const preview = {
    name,
    date,
    discipline: discipline.label,
    disciplineId: discipline.id,
    priority: priorityLabel,
    racePriority: priority,
    durationMinutes,
    tss,
    intensity,
    notes,
  }

  const { client, memberInfo } = await requirePrivateMember(flags, deps)
  const base = {
    generatedAt: new Date().toISOString(),
    command: "add-event",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: preview,
    adaptiveTraining: ADAPTIVE_NOTE,
  }

  if (dryRun) {
    const payload = {
      ...base,
      dryRun: true,
      event: null,
      request,
      message: `Would add ${priorityLabel} event "${name}" (${discipline.label}) on ${date}.`,
    }

    return payload
  }

  const before = await eventIdsOnCalendar(client, memberInfo)
  const response = await client.createEvent(request, memberInfo.username)
  const after = await eventIdsOnCalendar(client, memberInfo)
  const candidates = [...after.entries()]
    .filter(([id]) => !before.has(id))
    .map(([, row]) => compactEventRecord(row))
    .filter(
      (row) =>
        row.name === name &&
        row.dateOnly === date &&
        row.activityEventType === discipline.id &&
        row.racePriority === priority,
    )
  const event = candidates.length === 1 ? candidates[0] : null

  const payload = {
    ...base,
    dryRun: false,
    event,
    request,
    response: flags.full ? response : undefined,
    message: event
      ? `Added ${priorityLabel} event "${event.name}" on ${event.dateOnly} (plannedActivityId=${event.id}). Remove it with remove-workout --id ${event.id}.`
      : "TrainerRoad accepted the event but it could not be located on the calendar afterwards. Run `events` to inspect.",
  }

  return payload
}
