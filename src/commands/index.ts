import type { MutationContract, QueryContract } from "../contract/contract.ts"
import type { ApplyServices, PlanServices, QueryServices } from "../services/index.ts"
import { moveWorkout, whoami } from "./calendar.ts"
import { operationContracts } from "./operations.ts"
import { workflowContracts } from "./workflows.ts"
import { login, logout, workoutImage } from "./local.ts"
import { makeGuideCommands } from "./guide.ts"
import { makeIntrospection } from "./introspection.ts"

// Registration enforces read-only queries and plans, and write-only apply handlers.
export type RosterContract =
  | QueryContract<any, any, QueryServices>
  | MutationContract<any, any, any, PlanServices, ApplyServices>

const introspection = makeIntrospection(() => contracts)
const guide = makeGuideCommands(() => contracts)
export const contracts: ReadonlyArray<RosterContract> = [
  whoami,
  ...operationContracts,
  ...workflowContracts,
  login,
  logout,
  workoutImage,
  moveWorkout,
  introspection.describe,
  introspection.schema,
  guide.list,
  guide.get,
]
