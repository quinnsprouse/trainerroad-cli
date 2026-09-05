export function login(
  sessionFile: string,
  username: string,
  password: string,
  returnPath: string,
  signal: AbortSignal,
): Promise<void>
export function chart(sessionFile: string, workoutId: number, signal: AbortSignal): Promise<unknown>
export function rasterize(svg: string, width: number, background: string): Promise<Uint8Array>
