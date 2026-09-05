import { TrainerRoadClient } from "../trainerroad-client.mjs"

export async function login(sessionFile, username, password, returnPath, signal) {
  const client = new TrainerRoadClient({ sessionFile, signal })
  await client.login({ username, password, returnPath })
}

export async function chart(sessionFile, workoutId, signal) {
  const client = new TrainerRoadClient({ sessionFile, signal })
  if (!(await client.loadSession())) throw new Error("Authentication required")
  const member = await client.getMemberInfo()
  const response = await client.getWorkoutSummary(workoutId, member.username)
  const url = response?.summary?.picUrl
  if (typeof url !== "string") throw new Error("Workout has no chart")
  const parsed = new URL(url)
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !(
      parsed.hostname === "trainerroad.com" ||
      parsed.hostname.endsWith(".trainerroad.com") ||
      parsed.hostname.endsWith(".blob.core.windows.net")
    )
  )
    throw new Error("Unexpected chart host")
  return { member, url, svg: await client.fetchText(url) }
}

export async function rasterize(svg, width, background) {
  const { Resvg } = await import("@resvg/resvg-js")
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, background }).render().asPng()
}
