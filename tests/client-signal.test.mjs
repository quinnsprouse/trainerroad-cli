import assert from "node:assert/strict"
import test from "node:test"
import { TrainerRoadClient } from "../src/trainerroad-client.mjs"

await test("the client forwards an optional cancellation signal to fetch", async (t) => {
  const controller = new AbortController()
  const calls = []
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls.push(init.signal)
    return new Response(JSON.stringify({ memberId: 42, username: "fixture-rider" }), {
      headers: { "content-type": "application/json" },
    })
  })
  await new TrainerRoadClient({ signal: controller.signal }).getMemberInfo()
  await new TrainerRoadClient().getMemberInfo()
  assert.deepEqual(calls, [controller.signal, undefined])
})

await test("calendar reads retain caching by default and support an explicit fresh read", async (t) => {
  const cacheControls = []
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    cacheControls.push(new Headers(init.headers).get("tr-cache-control"))
    return new Response("{}", { headers: { "content-type": "application/json" } })
  })
  const client = new TrainerRoadClient()
  await client.getTimeline(42, "fixture-rider")
  await client.getTimeline(42, "fixture-rider", { fresh: true })
  await client.getPlannedActivity("planned-123", "fixture-rider")
  await client.getPlannedActivity("planned-123", "fixture-rider", { fresh: true })
  assert.deepEqual(cacheControls, ["use-cache", "no-cache", "use-cache", "no-cache"])
})

await test("an ambiguous add response never triggers a second write endpoint", async (t) => {
  const urls = []
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url)
    return new Response("response lost", { status: 503 })
  })
  const result = await new TrainerRoadClient().tryAddWorkoutToCalendar(88, "2026-09-12", {
    usernameForReferer: "fixture",
  })
  assert.equal(result[0].ok, false)
  assert.deepEqual(urls, ["https://www.trainerroad.com/app/api/react-calendar/planned-tr-workout"])
})
