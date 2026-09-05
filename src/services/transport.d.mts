export interface Transport {
  load(): Promise<boolean>
  member(signal: AbortSignal): Promise<unknown>
  timeline(memberId: string | number, username: string, signal: AbortSignal): Promise<unknown>
  planned(id: string, username: string, signal: AbortSignal): Promise<unknown>
  move(id: string, date: string, username: string, signal: AbortSignal): Promise<unknown>
}
export function createTransport(sessionFile: string): Transport
