import { expect, it, vi } from "vitest"
import type { ApiRequest } from "../src/domain/workflow.ts"
import { get } from "../src/domain/workflow.ts"
import { lines, makeInvoke } from "./harness.ts"

const mode = vi.hoisted(() => ({ collision: false }))
vi.mock("../src/domain/workflows.ts", async (original) => {
  const actual = await original<typeof import("../src/domain/workflows.ts")>()
  return {
    workflows: actual.workflows.map((spec) =>
      spec.name === "skip-workout"
        ? {
            ...spec,
            hydrate: () => ({ [mode.collision ? "activity" : "details"]: get("/fixture/details") }),
          }
        : spec,
    ),
  }
})

it.each(["collision", "read-failure"])(
  "does not dispatch a write after hydration %s",
  async (scenario) => {
    mode.collision = scenario === "collision"
    const calls: ApiRequest[] = []
    const invoke = makeInvoke(
      () => {
        throw new Error("unexpected legacy transport")
      },
      undefined,
      {
        workflow: () => ({
          load: async () => true,
          member: async () => ({ memberId: 42, username: "fixture" }),
          request: async (request, _signal, mutation) => {
            expect(mutation).toBe(false)
            calls.push(request)
            if (request.path === "/fixture/details") throw new Error("hydration failed")
            return { id: "planned-123", date: { year: 2026, month: 9, day: 7 } }
          },
        }),
      },
    )
    const result = await invoke(["skip-workout", "--id", "planned-123", "--yes"])
    expect(result.code).not.toBe(0)
    expect(lines(result.stdout)[0]!.status).toBe("error")
    expect(calls.map((request) => request.path)).toEqual(
      mode.collision
        ? ["/app/api/calendar/plannedactivities/planned-123"]
        : ["/app/api/calendar/plannedactivities/planned-123", "/fixture/details"],
    )
  },
)
