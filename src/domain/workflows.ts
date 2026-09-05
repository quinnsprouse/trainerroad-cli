import { calendarWorkflows } from "./calendar-workflows.ts"
import { activityWorkflows } from "./activity-workflows.ts"
import { approachWorkflows } from "./approach-workflows.ts"
import { athleteWorkflows } from "./athlete-workflows.ts"
import { eventWorkflows } from "./event-workflows.ts"
import { fitnessWorkflows } from "./fitness-workflows.ts"
import { planningWorkflows, reapplyPlanWorkflow } from "./planning-workflows.ts"
import { recurrenceWorkflows } from "./recurrence-workflows.ts"
import type { Workflow } from "./workflow.ts"

export const workflows: readonly Workflow[] = [
  ...calendarWorkflows,
  ...activityWorkflows,
  ...approachWorkflows,
  ...athleteWorkflows,
  ...eventWorkflows,
  ...fitnessWorkflows,
  ...planningWorkflows,
  ...recurrenceWorkflows,
  reapplyPlanWorkflow,
]
