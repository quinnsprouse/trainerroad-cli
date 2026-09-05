import { Effect, Schema } from "effect"
import { defineMutation, defineQuery } from "../src/contract/contract.ts"
import type { RosterContract } from "../src/commands/index.ts"
import { TrainerRoadWriter } from "../src/services/trainerroad.ts"
import type { OperationsWriter } from "../src/services/operations.ts"
import type { LocalWriter } from "../src/services/local.ts"
import type { WorkflowWriter } from "../src/services/workflows.ts"
import type { PlanServices, QueryServices } from "../src/services/index.ts"

const queryThatWrites = defineQuery({
  name: "fixture-write",
  summary: "Rejected read capability",
  stability: "experimental",
  params: {},
  dataSchema: Schema.String,
  domainErrorCodes: [],
  examples: [],
  handler: Effect.fn("fixture.query")(function* () {
    yield* TrainerRoadWriter
    return "invalid"
  }),
})

const planThatWrites = defineMutation({
  name: "fixture-plan-write",
  summary: "Rejected planning capability",
  stability: "experimental",
  params: {},
  dataSchema: Schema.String,
  planSchema: Schema.String,
  domainErrorCodes: [],
  examples: [],
  idempotency: { kind: "none" },
  plan: Effect.fn("fixture.plan")(function* () {
    yield* TrainerRoadWriter
    return "invalid"
  }),
  apply: (plan) => Effect.succeed(plan),
})

// These assignments stop compiling if registration begins admitting write capabilities.
export const rejectsQueryWrite: typeof queryThatWrites extends RosterContract ? true : false = false
export const rejectsPlanWrite: typeof planThatWrites extends RosterContract ? true : false = false
export const rejectsOperationsQuery: OperationsWriter extends QueryServices ? true : false = false
export const rejectsOperationsPlan: OperationsWriter extends PlanServices ? true : false = false
export const rejectsLocalQuery: LocalWriter extends QueryServices ? true : false = false
export const rejectsLocalPlan: LocalWriter extends PlanServices ? true : false = false
export const rejectsWorkflowQuery: WorkflowWriter extends QueryServices ? true : false = false
export const rejectsWorkflowPlan: WorkflowWriter extends PlanServices ? true : false = false
