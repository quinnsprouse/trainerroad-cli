import { Effect } from "effect"
import { defineMutation, defineQuery } from "../contract/contract.ts"
import { WorkflowData, WorkflowPlan, Submitted } from "../domain/workflow.ts"
import { workflows } from "../domain/workflows.ts"
import { WorkflowReader, WorkflowWriter } from "../services/workflows.ts"

const errors = [
  "invalid_usage",
  "invalid_data",
  "invalid_config",
  "auth_failure",
  "not_found",
  "service_unavailable",
  "cannot_write",
  "stale_confirmation",
] as const
const split = (input: Readonly<Record<string, string | number | boolean | undefined>>) => ({
  sessionFile: typeof input.sessionFile === "string" ? input.sessionFile : undefined,
  values: Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[0] !== "sessionFile" && entry[1] !== undefined,
    ),
  ),
})

export const workflowContracts = workflows.map((spec) => {
  const base = {
    name: spec.name,
    summary: spec.summary,
    stability: "experimental" as const,
    params: {
      ...spec.params,
      sessionFile: {
        kind: "flag" as const,
        type: "path" as const,
        description: "Saved session path; defaults to TR_SESSION_FILE or .trainerroad/session.json",
      },
    },
    domainErrorCodes: errors,
    guides: [spec.guide],
    examples: [
      {
        command:
          `trainerroad-cli ${spec.name} ${spec.example}${spec.write === undefined ? "" : " --dry-run"} --json`.replace(
            / +/g,
            " ",
          ),
        description:
          spec.write === undefined
            ? spec.summary
            : "Preview the exact target and request before confirmation",
      },
    ],
  }
  if (spec.write === undefined)
    return defineQuery({
      ...base,
      dataSchema: WorkflowData,
      handler: Effect.fn("workflow.query.handler")(function* (input) {
        const reader = yield* WorkflowReader
        const { sessionFile, values } = split(input)
        return yield* reader.query(spec.name, values, sessionFile)
      }),
      next: ({ input, data }) => spec.next(split(input).values, data.sessionFile, data.records),
    })
  return defineMutation({
    ...base,
    planSchema: WorkflowPlan,
    dataSchema: Submitted,
    idempotency: { kind: "none" },
    plan: Effect.fn("workflow.plan.handler")(function* (input) {
      const reader = yield* WorkflowReader
      const { sessionFile, values } = split(input)
      return yield* reader.plan(spec.name, values, sessionFile)
    }),
    apply: Effect.fn("workflow.apply.handler")(function* (plan) {
      return yield* (yield* WorkflowWriter).apply(plan)
    }),
    next: ({ plan }) => spec.next(plan.input, plan.sessionFile, plan.before),
    renderPlanText: (plan) =>
      `${spec.summary} for ${plan.member.username}\n${plan.request.method} ${plan.request.path}\n${JSON.stringify(plan.request.body)}`,
    renderText: () => "Request submitted. Run the suggested read-only check to verify the result.",
  })
})
