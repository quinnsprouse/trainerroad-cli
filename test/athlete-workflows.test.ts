import { describe, expect, it } from "vitest"
import { athleteWorkflows } from "../src/domain/athlete-workflows.ts"
import { AppError } from "../src/errors.ts"
import type { Flags, JsonObject } from "../src/domain/operation.ts"
import type { Workflow } from "../src/domain/workflow.ts"

const member = { memberId: 42, username: "fixture-rider" }
const session = "/fake/athlete-session.json"
const spec = (name: string): Workflow => {
  const workflow = athleteWorkflows.find((item) => item.name === name)
  if (!workflow) throw new Error(`missing fixture workflow ${name}`)
  return workflow
}
const preview = (name: string, input: Flags, snapshot: JsonObject) => {
  const workflow = spec(name)
  workflow.validate?.(input)
  const before = workflow.select?.(snapshot, input) ?? snapshot
  if (!workflow.write) throw new Error("fixture expected a mutation")
  return { before, request: workflow.write(input, member, before) }
}
// Static response snapshots built from browser caller fields, not live responses.
const option = (
  id: number,
  elementId: number,
  kind: number,
  parentId: number | null = null,
  type = 10,
) => ({ id, elementId, kind, parentId, type, text: `Answer ${kind}` })
const surveyFixture = (): JsonObject => ({
  options: [
    option(1, 101, 1),
    option(2, 102, 2),
    option(3, 103, 3),
    option(4, 104, 4),
    option(5, 105, 5),
    option(11, 201, 8, 2),
    option(12, 202, 10, 2),
    option(13, 203, 15, 2),
    option(14, 204, 17, 2),
    option(15, 205, 22, 2),
    option(16, 206, 34, 2),
    option(17, 207, 8, 3),
  ],
  response: null,
  profile: { roles: ["PostWorkoutSlider", "MultiReasonSlider"], token: "SECRET_PROFILE" },
})
const answer = { id: "123", rootId: "102", reasonIds: "none" }
const ftpFixture = (): JsonObject => ({
  status: { status: 0 },
  profile: { ftp: 240, token: "SECRET_PROFILE" },
  timeline: {
    pendingAiFtpChange: {
      id: "prediction-789",
      value: 250,
      source: 22,
      date: "2026-09-04T00:00:00Z",
      isLowConfidence: false,
    },
    activities: [{ privateUnrelatedData: "omit" }],
  },
})
const deliveryFixture = (): JsonObject => ({
  details: {
    workout: { details: { id: 777, isOutside: true, workoutName: "Outside Tempo" } },
    alternate: null,
  },
  sync: {
    connections: [
      {
        type: 0,
        accessToken: "SECRET_ACCESS",
        refreshToken: "SECRET_REFRESH",
        url: "https://fixture.invalid/?token=SECRET_URL",
        nested: { token: "SECRET_NESTED" },
      },
    ],
    token: "SECRET_TOP_LEVEL",
  },
  profile: { roles: [], token: "SECRET_PROFILE" },
})

describe("survey workflow specs", () => {
  it("discovers completed IDs and reads options and saved responses without a write", () => {
    const pending = spec("survey-pending")
    expect(pending.reads({}, member)).toEqual({
      pending: { method: "GET", path: "/app/api/survey/check", body: null },
    })
    expect(pending.next({}, session, { pending: { id: 123 } })[0]?.args).toEqual([
      "survey-options",
      "--id",
      "123",
      "--session-file",
      session,
      "--json",
    ])
    const options = spec("survey-options")
    expect(options.write).toBeUndefined()
    expect(options.reads({ id: "123" }, member)).toEqual({
      options: { method: "GET", path: "/app/api/survey/123", body: null },
      response: { method: "GET", path: "/app/api/survey/response?id=123", body: null },
    })
    expect(spec("survey-response").write).toBeUndefined()
  })

  it("requires an explicit answer and never invents RPE or feedback", () => {
    const workflow = spec("survey-submit")
    expect(workflow.params.rootId).toMatchObject({ required: true })
    expect(workflow.params.reasonIds).toMatchObject({ required: true })
    expect(() => preview("survey-submit", { id: "123" }, surveyFixture())).toThrow(AppError)
    const plan = preview("survey-submit", answer, surveyFixture())
    expect(plan.request).toEqual({
      method: "POST",
      path: "/app/api/survey/response",
      body: {
        id: 123,
        type: 10,
        rpeSurveyElementId: 102,
        struggleReasonSurveyElementId: null,
        struggleReasonSurveyElementIds: [],
        rpe: null,
        text: null,
        translatedDisplayName: null,
        deferFlushForward: false,
      },
    })
    expect(JSON.stringify(plan)).not.toContain("SECRET")
  })

  it("uses dynamic element IDs and preserves quarter-step RPE", () => {
    const fixture = {
      ...surveyFixture(),
      options: [option(70, 870, 2), option(71, 871, 8, 70)],
    }
    const plan = preview(
      "survey-submit",
      { ...answer, rootId: "870", reasonIds: "871", rpe: "2.75" },
      fixture,
    )
    expect(plan.request.body).toMatchObject({
      rpeSurveyElementId: 870,
      struggleReasonSurveyElementId: 871,
      struggleReasonSurveyElementIds: [],
      rpe: 2.75,
      deferFlushForward: false,
    })
  })

  it("allows ordinary answers without slider access but refuses explicit slider RPE", () => {
    const snapshot = { ...surveyFixture(), profile: { roles: [] } }
    expect(preview("survey-submit", answer, snapshot).request.body).toMatchObject({ rpe: null })
    expect(
      preview("survey-submit", { ...answer, reasonIds: "203", text: "Mechanical issue" }, snapshot)
        .request.body,
    ).toMatchObject({ text: "Mechanical issue", struggleReasonSurveyElementId: 203, rpe: null })
    expect(() => preview("survey-submit", { ...answer, rpe: "2.5" }, snapshot)).toThrow(
      /PostWorkoutSlider/,
    )
    const next = spec("survey-options").next({ id: "123" }, session, {})[0]!
    expect(next.args).toEqual(["describe", "--command", "survey-submit", "--json"])
    expect(next.message).toContain("ask the user")
  })

  it.each([
    { rootId: "2" }, // row id, not elementId
    { rootId: "201" }, // child passed as root
    { rootId: "999" },
    { reasonIds: "11" }, // child row id
    { reasonIds: "207" }, // belongs to another root
    { reasonIds: "201,201" },
    { reasonIds: "201,202,203,205" },
    { reasonIds: "204,201" },
    { reasonIds: "201,205" },
    { reasonIds: "" },
    { rpe: "3" },
    { rpe: "2.3" },
    { rpe: "NaN" },
    { rpe: "0" },
    { text: "unsolicited" },
    { reasonIds: "203" },
    { id: "../123" },
  ])("rejects invalid answer input %j", (override) => {
    expect(() => preview("survey-submit", { ...answer, ...override }, surveyFixture())).toThrow(
      AppError,
    )
  })

  it("validates a reason-required outcome and permits its explicit DidNotStruggle option", () => {
    const snapshot = {
      ...surveyFixture(),
      options: [option(2, 102, 2, null, 13), option(14, 204, 17, 2, 13)],
    }
    expect(() => preview("survey-submit", answer, snapshot)).toThrow(/requires a reason/)
    expect(
      preview("survey-submit", { ...answer, reasonIds: "204" }, snapshot).request.body,
    ).toMatchObject({ type: 13, struggleReasonSurveyElementId: 204 })
  })

  it("validates current option structure before submitting", () => {
    for (const options of [
      [option(1, 101, 1), option(1, 102, 2)],
      [option(1, 101, 1), option(2, 101, 2)],
      [option(1, 101, 1), option(2, 102, 8, 999)],
      [option(1, 101, 1), option(2, 102, 8, 1, 13)],
      [option(1, 101, 1, null, 999)],
    ])
      expect(() => preview("survey-submit", answer, { ...surveyFixture(), options })).toThrow(
        AppError,
      )
  })

  it("submits plural reasons with Other text and enforces account feature gates", () => {
    const input = { ...answer, reasonIds: "201,203", text: " Poor sleep and a mechanical issue " }
    const plan = preview("survey-submit", input, surveyFixture())
    expect(plan.request.body).toMatchObject({
      struggleReasonSurveyElementId: null,
      struggleReasonSurveyElementIds: [201, 203],
      text: "Poor sleep and a mechanical issue",
    })
    expect(() =>
      preview("survey-submit", input, { ...surveyFixture(), profile: { roles: [] } }),
    ).toThrow(AppError)
    expect(() =>
      preview(
        "survey-submit",
        { ...answer, reasonIds: "205" },
        { ...surveyFixture(), profile: { roles: [] } },
      ),
    ).toThrow(AppError)
  })

  it("rechecks dynamic options and prior response state in each preview", () => {
    const first = preview("survey-submit", answer, surveyFixture())
    const changed = preview("survey-submit", answer, {
      ...surveyFixture(),
      response: { id: 123, rpe: 4 },
    })
    expect(changed.before).not.toEqual(first.before)
    expect(() =>
      preview("survey-submit", answer, { ...surveyFixture(), options: [option(3, 103, 3)] }),
    ).toThrow(AppError)
    expect(() =>
      preview("survey-submit", answer, { ...surveyFixture(), response: { id: 999 } }),
    ).toThrow(AppError)
  })

  it("follows one submission with read-only comparison guidance preserving session", () => {
    const next = spec("survey-submit").next(answer, session, {})[0]!
    expect(next.args).toEqual([
      "survey-response",
      "--id",
      "123",
      "--session-file",
      session,
      "--json",
    ])
    expect(next.message).toContain("compare")
    expect(spec("survey-response").reads({ id: "123" }, member)).toEqual({
      response: { method: "GET", path: "/app/api/survey/response?id=123", body: null },
    })
    expect(spec("survey-response").select?.({ response: null }, { id: "123" })).toEqual({
      response: null,
    })
  })
})

describe("FTP workflow specs", () => {
  it("discovers pending records through the authenticated member's timeline", () => {
    const status = spec("ftp-status")
    expect(status.reads({}, member)).toEqual({
      status: { method: "GET", path: "/app/api/calendar/aiftp/42/ai-failure-status", body: null },
      timeline: { method: "GET", path: "/app/api/react-calendar/42/timeline", body: null },
      profile: { method: "GET", path: "/app/api/member-info", body: null },
    })
    expect(status.select?.(ftpFixture(), {})).toEqual({
      status: 0,
      statusName: "CanPredict",
      currentFtp: 240,
      pending: {
        id: "prediction-789",
        value: 250,
        source: 22,
        date: "2026-09-04T00:00:00Z",
        isLowConfidence: false,
        isApplied: null,
      },
    })
  })

  it("accepts exactly the pending detection ID, not the member ID", () => {
    const input = { id: "prediction-789", ftp: "250" }
    const plan = preview("ftp-accept", input, ftpFixture())
    expect(plan.request).toEqual({
      method: "POST",
      path: "/app/api/calendar/aiftp/prediction-789/accept",
      body: null,
    })
    expect(JSON.stringify(plan)).not.toContain("SECRET")
    expect(() => preview("ftp-accept", { ...input, id: "42" }, ftpFixture())).toThrow(AppError)
    expect(() => preview("ftp-accept", { ...input, ftp: "260" }, ftpFixture())).toThrow(AppError)
    const next = spec("ftp-accept").next(input, session, plan.before)[0]!
    expect(next.args).toEqual(["ftp-status", "--session-file", session, "--json"])
    expect(next.message).toContain("250")
    expect(next.message).toContain("prediction-789")
  })

  it.each([
    null,
    {},
    { id: "prediction-789", value: 250 },
    { id: "prediction-789", value: 250, source: 25, date: "2026-09-04", isLowConfidence: false },
    {
      id: "prediction-789",
      value: 250,
      source: 22,
      date: "2026-09-04",
      isLowConfidence: false,
      isApplied: true,
    },
  ])("refuses acceptance without a supported pending record: %j", (pending) => {
    expect(() =>
      preview(
        "ftp-accept",
        { id: "prediction-789", ftp: "250" },
        { ...ftpFixture(), timeline: { pendingAiFtpChange: pending } },
      ),
    ).toThrow(AppError)
  })

  it("reports absent pending state after acceptance without proposing a second write", () => {
    expect(
      spec("ftp-status").select?.(
        { ...ftpFixture(), profile: { ftp: 250 }, timeline: { pendingAiFtpChange: null } },
        {},
      ),
    ).toMatchObject({ currentFtp: 250, pending: null })
    expect(() =>
      spec("ftp-status").select?.({ ...ftpFixture(), status: { status: 5 } }, {}),
    ).toThrow(AppError)
    expect(spec("ftp-status").write).toBeUndefined()
  })

  it("keeps status readable without optional display fields or an established account FTP", () => {
    expect(
      spec("ftp-status").select?.(
        {
          ...ftpFixture(),
          profile: {},
          status: { status: 1 },
          timeline: { pendingAiFtpChange: null },
        },
        {},
      ),
    ).toMatchObject({ statusName: "NoData", currentFtp: null, pending: null })
    const snapshot = {
      ...ftpFixture(),
      timeline: {
        pendingAiFtpChange: {
          id: "mid-phase-789",
          value: 250,
          source: 25,
        },
      },
    }
    expect(spec("ftp-status").select?.(snapshot, {})).toMatchObject({
      pending: { id: "mid-phase-789", source: 25, date: null, isLowConfidence: null },
    })
    expect(() => preview("ftp-accept", { id: "mid-phase-789", ftp: "250" }, snapshot)).toThrow(
      /not supported for acceptance/,
    )
  })
})

describe("provider workflow specs", () => {
  it("allowlists connection output and excludes all token-bearing fields", () => {
    expect(spec("sync-list").select?.(deliveryFixture(), {})).toEqual({
      connections: [{ type: 0, provider: "garmin" }],
    })
    const plan = preview("workout-push", { id: "777", provider: "garmin" }, deliveryFixture())
    expect(JSON.stringify(plan)).not.toContain("SECRET")
    expect(JSON.stringify(plan)).not.toContain("url")
  })

  it("marks push as a mutation despite GET and never includes push among preview reads", () => {
    const workflow = spec("workout-push")
    const input = { id: "777", provider: "garmin" }
    expect(workflow.write).toBeTypeOf("function")
    expect(
      Object.values(workflow.reads(input, member)).some((request) =>
        request.path.endsWith("/push"),
      ),
    ).toBe(false)
    expect(preview("workout-push", input, deliveryFixture()).request).toEqual({
      method: "GET",
      path: "/app/api/workouts/777/garmin/push",
      body: null,
    })
    const next = workflow.next(input, session, {})[0]!
    expect(next.args).toEqual(["sync-list", "--session-file", session, "--json"])
    expect(next.message).toContain("do not prove delivery")
  })

  it("requires an exact outside library ID and connected, supported destination", () => {
    const input = { id: "777", provider: "garmin" }
    for (const override of [
      { id: "123" },
      { id: "planned-777" },
      { provider: "wahoo" },
      { provider: "strava" },
    ])
      expect(() => preview("workout-push", { ...input, ...override }, deliveryFixture())).toThrow(
        AppError,
      )
    expect(() =>
      preview("workout-push", input, {
        ...deliveryFixture(),
        details: {
          workout: { details: { id: 777, isOutside: false } },
        },
      }),
    ).toThrow(AppError)
  })

  it("resolves a matching outside alternate without silently substituting a different ID", () => {
    const snapshot = {
      ...deliveryFixture(),
      details: {
        workout: { details: { id: 555, isOutside: false } },
        alternate: { details: { id: 777, isOutside: true } },
      },
    }
    expect(preview("workout-push", { id: "777", provider: "garmin" }, snapshot).request.path).toBe(
      "/app/api/workouts/777/garmin/push",
    )
  })

  it("checks Coros connection and role separately", () => {
    const input = { id: "777", provider: "coros" }
    const snapshot = { ...deliveryFixture(), sync: { connections: [{ type: 16 }] } }
    expect(() => preview("workout-push", input, snapshot)).toThrow(AppError)
    expect(
      preview("workout-push", input, { ...snapshot, profile: { roles: ["Coros"] } }).request.path,
    ).toBe("/app/api/workouts/777/coros/push")
  })
})

it("every workflow provides read-only ID discovery with the selected session", () => {
  for (const workflow of athleteWorkflows) {
    const actions = workflow.discover?.(session)
    expect(actions?.length).toBeGreaterThan(0)
    for (const action of actions ?? []) {
      expect(action.args).toContain(session)
      expect(action.args).not.toContain("--yes")
      expect(action.args).not.toContain("--confirm")
    }
  }
  expect(athleteWorkflows.some((workflow) => /reject|pull/.test(workflow.name))).toBe(false)
})

it("offers guides at survey and device-delivery decision points without browse loops", () => {
  const survey = spec("survey-options").next({ id: "123" }, session, {})
  expect(survey.map((action) => action.args)).toEqual([
    ["describe", "--command", "survey-submit", "--json"],
    ["guide", "get", "athlete-feedback", "--json"],
  ])
  const sync = spec("sync-list").next({}, session, {})
  expect(sync.map((action) => action.args)).toEqual([
    ["workout-library", "--outside", "true", "--session-file", session, "--json"],
    ["guide", "get", "workout-delivery", "--json"],
  ])
})
