import { Schema } from "effect"
import type { NextAction } from "../output/guidance.ts"
import { CalendarDate, type MovePlan } from "./calendar.ts"
import { JsonObject, type OperationPlan } from "./operation.ts"

export const moveFollowUp = (plan: MovePlan): ReadonlyArray<NextAction> => [
  {
    message: "check the calendar around the affected dates",
    args: [
      "future",
      "--from",
      plan.before.date < plan.to ? plan.before.date : plan.to,
      "--to",
      plan.before.date > plan.to ? plan.before.date : plan.to,
      "--session-file",
      plan.sessionFile,
      "--details",
      "--json",
    ],
  },
]

export const calendarFollowUp = (plan: OperationPlan): ReadonlyArray<NextAction> => {
  const { command, flags, preview } = plan
  const context = ["--session-file", String(flags["session-file"]), "--tz", String(flags.tz)]
  const before = Schema.is(JsonObject)(preview.before) ? preview.before : {}
  const dates = [
    preview.query.date,
    preview.query.dateOnly,
    preview.query.endDateOnly,
    before.date,
    before.dateOnly,
    before.endDateOnly,
  ]
    .filter(Schema.is(CalendarDate))
    .toSorted()
  const actions: NextAction[] = []
  if (command.includes("annotation") || command === "add-event") {
    actions.push({
      message: "inspect the affected calendar records",
      args: [command.includes("annotation") ? "annotations" : "events", ...context, "--json"],
    })
  }
  if (dates.length > 0) {
    actions.push({
      message: "inspect planned workouts across the affected dates",
      args: [
        "future",
        "--from",
        dates[0]!,
        "--to",
        dates.at(-1)!,
        "--details",
        ...context,
        "--json",
      ],
    })
  } else if (actions.length === 0) {
    actions.push({
      message: "inspect the calendar",
      args: ["timeline", "--full", ...context, "--json"],
    })
  }
  return actions
}
