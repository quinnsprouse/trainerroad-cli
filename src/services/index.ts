import { Layer } from "effect"
import { Progress } from "../output/progress.ts"
import { TrainerRoadReader, TrainerRoadWriter, trainerRoadLayer } from "./trainerroad.ts"
import { OperationsReader, OperationsWriter, operationsLayer } from "./operations.ts"
import { LocalReader, LocalWriter, localLayer } from "./local.ts"
import { WorkflowReader, WorkflowWriter, workflowsLayer } from "./workflows.ts"

export type QueryServices = TrainerRoadReader | OperationsReader | WorkflowReader | Progress
export type PlanServices =
  | TrainerRoadReader
  | OperationsReader
  | WorkflowReader
  | LocalReader
  | Progress
export type ApplyServices =
  | TrainerRoadWriter
  | OperationsWriter
  | WorkflowWriter
  | LocalWriter
  | Progress
export type AppServices = QueryServices | PlanServices | ApplyServices

export const appServicesLayer = Layer.mergeAll(
  trainerRoadLayer(),
  operationsLayer(),
  localLayer(),
  workflowsLayer(),
  Progress.layer,
)
