import type { ApiRequest } from "../domain/workflow.ts"
export interface WorkflowTransport {
  load(): Promise<boolean>
  member(signal: AbortSignal): Promise<unknown>
  request(request: ApiRequest, signal: AbortSignal, mutation: boolean): Promise<unknown>
}
export function createWorkflowTransport(sessionFile: string): WorkflowTransport
