import { expect, it } from "vitest"
import type { Schema } from "effect"
import type { ApiRequest } from "../src/domain/workflow.ts"
import { makeInvoke, lines } from "./harness.ts"

const fixture = () => {
  let answer: Schema.Json = null
  let ftp = 240
  let pending: Schema.Json = {
    id: "detection-123",
    value: 250,
    source: 22,
    date: "2026-09-04T00:00:00Z",
    isLowConfidence: false,
  }
  let fail = false
  const writes: ApiRequest[] = []
  const invoke = makeInvoke(
    () => {
      throw new Error("unexpected legacy transport")
    },
    undefined,
    {
      workflow: () => ({
        load: async () => true,
        member: async () => ({ memberId: 42, username: "fixture" }),
        request: async (request, _, mutation) => {
          if (mutation) {
            writes.push(request)
            if (fail) throw new Error("lost response")
            if (request.path === "/app/api/survey/response") answer = request.body
            if (request.path === "/app/api/calendar/aiftp/detection-123/accept") {
              ftp = 250
              pending = null
            }
            return true
          }
          switch (request.path) {
            case "/app/api/survey/123":
              return [
                { id: 1, parentId: null, elementId: 102, kind: 2, type: 10, text: "Moderate" },
              ]
            case "/app/api/survey/response?id=123":
              return answer
            case "/app/api/member-info":
              return {
                memberId: 42,
                username: "fixture",
                ftp,
                roles: ["PostWorkoutSlider"],
                secret: "must-not-leak",
              }
            case "/app/api/calendar/aiftp/42/ai-failure-status":
              return { status: 0 }
            case "/app/api/react-calendar/42/timeline":
              return { pendingAiFtpChange: pending }
            case "/app/api/activity-sync":
              return {
                connections: [
                  { type: 0, accessToken: "must-not-leak", refreshToken: "must-not-leak" },
                ],
              }
            case "/app/api/workoutdetails/777":
              return {
                workout: { details: { id: 777, isOutside: true, workoutName: "Outside Tempo" } },
                alternate: null,
              }
            default:
              throw new Error(`Unexpected read: ${request.path}`)
          }
        },
      }),
    },
  )
  return {
    invoke,
    writes,
    fail: () => {
      fail = true
    },
  }
}

const cases = [
  {
    args: [
      "survey-submit",
      "--id",
      "123",
      "--root-id",
      "102",
      "--reason-ids",
      "none",
      "--rpe",
      "2.5",
    ],
    request: {
      method: "POST",
      path: "/app/api/survey/response",
      body: {
        id: 123,
        type: 10,
        rpeSurveyElementId: 102,
        struggleReasonSurveyElementId: null,
        struggleReasonSurveyElementIds: [],
        rpe: 2.5,
        text: null,
        translatedDisplayName: null,
        deferFlushForward: false,
      },
    },
    check: "survey-response",
  },
  {
    args: ["ftp-accept", "--id", "detection-123", "--ftp", "250"],
    request: { method: "POST", path: "/app/api/calendar/aiftp/detection-123/accept", body: null },
    check: "ftp-status",
  },
  {
    args: ["workout-push", "--id", "777", "--provider", "garmin"],
    request: { method: "GET", path: "/app/api/workouts/777/garmin/push", body: null },
    check: "sync-list",
  },
] as const

it.each(cases)(
  "confirms $args and verifies without replaying the write",
  async ({ args, request, check }) => {
    const f = fixture()
    const selected = [...args, "--session-file", "/fake/athlete.json"]
    expect((await f.invoke([...selected, "--dry-run"])).code).toBe(0)
    const preview = lines((await f.invoke(selected)).stdout)[0]!
    expect(preview.status).toBe("confirmation_required")
    expect(f.writes).toEqual([])
    expect(JSON.stringify(preview)).not.toContain("must-not-leak")
    const response = await f.invoke(preview.confirmation.confirmArgs)
    expect(response.code).toBe(0)
    const applied = lines(response.stdout)[0]!
    expect(applied.data).toMatchObject({ submitted: true, verification: "required" })
    expect(f.writes).toEqual([request])
    expect(applied.next[0].args[0]).toBe(check)
    expect(applied.next[0].args).toContain("/fake/athlete.json")
    const verified = await f.invoke(applied.next[0].args)
    expect(verified.code).toBe(0)
    const records = lines(verified.stdout)[0]!.data.records
    if (check === "survey-response") expect(records.response).toEqual(request.body)
    if (check === "ftp-status") expect(records).toMatchObject({ currentFtp: 250, pending: null })
    if (check === "sync-list")
      expect(records.connections).toEqual([{ type: 0, provider: "garmin" }])
    expect(verified.stdout).not.toContain("must-not-leak")
    expect(f.writes).toHaveLength(1)
  },
)

it.each(cases)("does not retry an uncertain $args submission", async ({ args, check }) => {
  const f = fixture()
  f.fail()
  const result = lines((await f.invoke([...args, "--yes"])).stdout)[0]!
  expect(result.error.code).toBe("cannot_write")
  expect(f.writes).toHaveLength(1)
  expect(result.next[0].args[0]).toBe(check)
  expect(result.next[0].args).not.toContain("--yes")
})
