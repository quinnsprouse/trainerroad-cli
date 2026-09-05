export type Flags = Readonly<Record<string, string | number | boolean>>
export interface ClientFactory {
  (options: {
    sessionFile: string
    signal: AbortSignal
  }): { loadSession(): Promise<boolean>; getMemberInfo(): Promise<unknown> }
}
export function runOperation(
  name: string,
  flags: Flags,
  phase: "query" | "plan" | "apply",
  now: number,
  signal: AbortSignal,
  expected?: unknown,
  factory?: ClientFactory,
): Promise<unknown>
