import fs from "node:fs/promises"
import { afterEach, expect, it, vi } from "vitest"
import { createTransport } from "../src/services/transport.mjs"
import { lines, makeInvoke } from "./harness.ts"

afterEach(() => vi.restoreAllMocks())

it("uses the legacy client for a confirmed move without live file or network access", async () => {
  vi.spyOn(fs, "readFile").mockResolvedValue(
    JSON.stringify({ cookies: { SharedTrainerRoadAuth: "fixture-only" } }),
  )
  const requests: Array<{ url: string; method: string; body: unknown }> = []
  let day = 10
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? "GET"
    requests.push({ url, method, body: init?.body })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init?.headers).get("cookie")).toBe("SharedTrainerRoadAuth=fixture-only")
    let data: unknown
    if (url.endsWith("/member-info")) {
      data = { memberId: 42, username: "fixture-rider" }
    } else if (url.endsWith("/calendar/plannedactivities/planned-123") && method === "GET") {
      expect(new Headers(init?.headers).get("tr-cache-control")).toBe("no-cache")
      data = {
        id: "planned-123",
        date: { year: 2026, month: 9, day },
        workout: { id: 88, name: "Fixture", isOutside: false },
        canMove: true,
      }
    } else if (
      url.endsWith("/react-calendar/planned-activity/planned-123/move") &&
      method === "PUT"
    ) {
      day = 12
      data = {}
    } else {
      throw new Error(`Unexpected test request: ${method} ${url}`)
    }
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } })
  })
  const result = await makeInvoke(createTransport)([
    "move-workout",
    "--id",
    "planned-123",
    "--to",
    "2026-09-12",
    "--session-file",
    "/fake/session.json",
    "--yes",
  ])
  expect(result.code).toBe(0)
  expect(lines(result.stdout)[0]!.data.after.date).toBe("2026-09-12")
  expect(requests.filter((request) => request.method === "PUT")).toEqual([
    {
      url: "https://www.trainerroad.com/app/api/react-calendar/planned-activity/planned-123/move",
      method: "PUT",
      body: JSON.stringify({ newDate: { year: 2026, month: 9, day: 12 } }),
    },
  ])
  expect(result.stdout).not.toContain("fixture-only")
})
