import fs from "node:fs/promises"
import { afterEach, expect, it, vi } from "vitest"
import { createWorkflowTransport } from "../src/services/workflow-transport.mjs"
import { makeInvoke, lines } from "./harness.ts"
import { get } from "../src/domain/workflow.ts"

afterEach(() => vi.restoreAllMocks())

it("sends only validated IDs in a member-scoped hydration read header", async () => {
  vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({ cookies: {} }))
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith("/member-info")) return Response.json({ memberId: 42, username: "fixture" })
    expect(url).toBe("https://www.trainerroad.com/app/api/react-calendar/42/planned-activities")
    const headers = new Headers(init?.headers)
    expect(headers.get("ids")).toBe("planned-1,planned-2")
    expect(headers.has("trainerroad-correlationid")).toBe(false)
    expect(headers.get("tr-cache-control")).toBe("no-cache")
    expect(init?.method).toBe("GET")
    expect(init?.redirect).toBe("error")
    expect(init?.body).toBeNull()
    return Response.json([])
  })
  const client = createWorkflowTransport("/fake/fixture.json")
  const signal = new AbortController().signal
  await client.load()
  await client.member(signal)
  await expect(
    client.request(
      get("/app/api/react-calendar/42/planned-activities", ["planned-1", "planned-2"]),
      signal,
      false,
    ),
  ).resolves.toEqual([])
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([
  { ids: [] },
  { ids: [""] },
  { ids: ["a,b"] },
  { ids: ["café"] },
  { ids: ["a".repeat(8193)] },
  { ids: ["a\r\nx-injected: true"] },
  { ids: ["a", "a"] },
  { ids: Array.from({ length: 101 }, (_, i) => String(i)) },
  { ids: ["a"], mutation: true },
  { ids: ["a"], method: "PUT" as const },
  { ids: ["a"], body: {} },
  { ids: ["a"], path: "/app/api/membersettings" },
])(
  "refuses unsafe read batches before fetching: %j",
  async ({
    ids,
    mutation = false,
    path = "/app/api/react-calendar/42/planned-activities",
    method = "GET" as const,
    body = null,
  }) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ memberId: 42, username: "fixture" }))
    const client = createWorkflowTransport("/fake/fixture.json")
    const signal = new AbortController().signal
    await client.member(signal)
    fetch.mockClear()
    await expect(
      client.request({ ...get(path, ids), method, body }, signal, mutation),
    ).rejects.toThrow("Invalid planned-activity read batch")
    expect(fetch).not.toHaveBeenCalled()
  },
)

it("sends exactly one confirmed request, with cache bypass, correlation and no redirects", async () => {
  vi.spyOn(fs, "readFile").mockResolvedValue(
    JSON.stringify({ cookies: { SharedTrainerRoadAuth: "fixture-secret" } }),
  )
  const calls: Array<{ method: string; body: unknown }> = []
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers)
    expect(headers.get("cookie")).toBe("SharedTrainerRoadAuth=fixture-secret")
    if (url.endsWith("/member-info")) return Response.json({ memberId: 42, username: "fixture" })
    expect(init?.redirect).toBe("error")
    expect(headers.get("tr-cache-control")).toBe("no-cache")
    expect(headers.get("referer")).toBe("https://www.trainerroad.com/app/calendar/fixture")
    expect(headers.get("trainerroad-jsonformat")).toBe("camel-case")
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    if (url.endsWith("/planned-123") && init?.method === "GET")
      return Response.json({
        id: "planned-123",
        date: { year: 2026, month: 9, day: 10 },
        manuallyCompleted: false,
      })
    expect(url).toBe(
      "https://www.trainerroad.com/app/api/calendar/plannedactivities/planned-123/mark-manually-complete",
    )
    expect(headers.get("TrainerRoad-CorrelationId")).toMatch(/^[0-9a-f-]{36}$/)
    calls.push({ method: init!.method!, body: init?.body })
    return new Response(null, { status: 204 })
  })
  const invoke = makeInvoke(
    () => {
      throw new Error("no legacy access")
    },
    undefined,
    { workflow: createWorkflowTransport },
  )
  const result = await invoke([
    "complete-workout",
    "--id",
    "planned-123",
    "--completed",
    "true",
    "--yes",
  ])
  expect(result.code).toBe(0)
  expect(lines(result.stdout)[0]!.data.verification).toBe("required")
  expect(calls).toEqual([{ method: "POST", body: JSON.stringify({ completed: true }) }])
  expect(result.stdout + result.stderr).not.toContain("fixture-secret")
})

it.each(["malformed", "negative"])(
  "treats a %s successful response as uncertain and does not retry",
  async (responseType) => {
    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({ cookies: {} }))
    let writes = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith("/member-info")) return Response.json({ memberId: 42, username: "fixture" })
      if (init?.method === "GET")
        return Response.json({ id: "planned-123", date: { year: 2026, month: 9, day: 10 } })
      writes++
      return responseType === "malformed"
        ? new Response("<html>unexpected response</html>")
        : Response.json(false)
    })
    const invoke = makeInvoke(
      () => {
        throw new Error("no legacy access")
      },
      undefined,
      { workflow: createWorkflowTransport },
    )
    const result = lines(
      (await invoke(["skip-workout", "--id", "planned-123", "--yes"])).stdout,
    )[0]!
    expect(result.error.code).toBe("cannot_write")
    expect(writes).toBe(1)
    expect(result.next[0].args[0]).toBe("planned-activity")
  },
)
