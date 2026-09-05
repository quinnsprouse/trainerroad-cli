import { Schema } from "effect"
import { Errors } from "../errors.ts"
import { CalendarDate, Id } from "./calendar.ts"
import { follow, get, record, segment, value, type Workflow } from "./workflow.ts"

const Setting = Schema.Literals([0, 1, 2, 3, 4])
const Approach = Schema.Struct({
  id: Id,
  date: Schema.NonEmptyString,
  setting: Setting,
  customPlanId: Schema.NullOr(Id),
  adaptationSettings: Schema.NullOr(
    Schema.Struct({ maxEndurance: Schema.Finite, outsideDuration: Schema.Finite }),
  ),
  customAggressiveness: Schema.NullOr(
    Schema.Struct({
      endurance: Setting,
      tempo: Setting,
      sweetSpot: Setting,
      threshold: Setting,
      vo2Max: Setting,
      anaerobic: Setting,
    }),
  ),
})
const invalid = (): never => {
  throw Errors.invalidData({
    message: "TrainerRoad returned an unsupported training-approach record",
    fix: "inspect training approaches in TrainerRoad; do not infer an effective setting from incomplete records",
  })
}

// The timeline carries raw changes, not the browser's athlete-local effective selection.
export const approachWorkflows: readonly Workflow[] = [
  {
    name: "training-approaches",
    summary: "Read recorded training-approach changes without inferring edit eligibility",
    guide: "workflow-boundaries",
    params: {
      id: { kind: "flag", type: "string", description: "Select a change id from this list" },
      from: { kind: "flag", type: "string", description: "Timeline start date, YYYY-MM-DD" },
      to: { kind: "flag", type: "string", description: "Timeline end date, YYYY-MM-DD" },
    },
    example: "",
    validate: (input) => {
      if (input.id !== undefined) value(input, "id")
      for (const key of ["from", "to"])
        if (input[key] !== undefined && !Schema.is(CalendarDate)(input[key]))
          throw Errors.invalidUsage({
            message: `${key} must be a real YYYY-MM-DD date`,
            fix: "use calendar dates and an ordered timeline window",
          })
      if (typeof input.from === "string" && typeof input.to === "string" && input.from > input.to)
        throw Errors.invalidUsage({
          message: "from is after to",
          fix: "use an ordered timeline window",
        })
    },
    reads: (input, member) => {
      const query = [
        ...(input.from === undefined ? [] : [`start=${value(input, "from")}`]),
        ...(input.to === undefined ? [] : [`end=${value(input, "to")}`]),
      ].join("&")
      return {
        timeline: get(
          `/app/api/react-calendar/${segment(member.memberId)}/timeline${query ? `?${query}` : ""}`,
        ),
      }
    },
    select: (records, input) => {
      const raw = record(records.timeline).trainingApproachChanges
      if (!Array.isArray(raw)) return invalid()
      const ids = new Set<string>()
      const changes = raw.map((entry) => {
        const decoded = Schema.decodeUnknownOption(Approach)(entry)
        if (decoded._tag === "None") return invalid()
        const item = decoded.value
        if (
          !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.test(
            item.date,
          ) ||
          !Schema.is(CalendarDate)(item.date.slice(0, 10))
        )
          return invalid()
        if (ids.has(String(item.id))) return invalid()
        ids.add(String(item.id))
        return item
      })
      if (input.id === undefined) return { changes }
      const selected = changes.filter((item) => String(item.id) === input.id)
      if (selected.length === 0)
        throw Errors.notFound({
          message: "training-approach id is absent from the requested timeline",
          fix: "list training-approaches without a date filter and select a returned id",
        })
      return { changes: selected }
    },
    discover: (session) => follow("training-approaches", [], session, "find a recorded change id"),
    next: () => [
      {
        message: "Read the training-approach handoff rules before requesting a change in the app",
        args: ["guide", "get", "workflow-boundaries", "--json"],
      },
    ],
  },
]
