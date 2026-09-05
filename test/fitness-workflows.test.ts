import { expect, it } from "vitest"
import { fitnessWorkflows } from "../src/domain/fitness-workflows.ts"
import type { Flags, JsonObject } from "../src/domain/operation.ts"
import { AppError } from "../src/errors.ts"

const account = { memberId: 42, username: "fixture-rider" }
const session = "/fake/fitness-session.json"
const spec = (name: string) => {
  const workflow = fitnessWorkflows.find((item) => item.name === name)
  if (!workflow) throw new Error(`unknown fixture workflow ${name}`)
  return workflow
}
// Fixtures mirror fields traced through raw API assignment in the browser source.
const fixture = (): JsonObject => ({
  profile: { memberId: 42, ftp: 240, roles: ["AiFtpBreakthrough"], secret: "SECRET_PROFILE" },
  timeline: {
    pendingAiFtpChange: { id: 789, value: 250, source: 24 },
    unrelated: "SECRET_HISTORY",
  },
  settings: [{ name: "viewedPredictionId", value: 456, token: "SECRET_SETTING" }],
  survey: null,
})
const input = { id: "789" }
const preview = (snapshot: JsonObject, answer: Flags = input) => {
  const workflow = spec("ftp-dismiss")
  workflow.validate?.(answer)
  const before = workflow.select!(snapshot, answer)
  return { before, request: workflow.write!(answer, account, before) }
}

it("reads weight by exact history ID and preserves units instead of silently converting", () => {
  const workflow = spec("weight-record")
  expect(workflow.reads({ id: "123" }, account)).toEqual({
    history: {
      method: "GET",
      path: "/app/api/weight-history/42/all",
      body: null,
    },
  })
  const history = [
    { id: 123, date: "2026-09-01T12:00:00Z", value: 160, units: 1, private: "SECRET" },
    { id: 124, date: "2026-09-02T12:00:00Z", value: 72, units: 0 },
  ]
  expect(workflow.select!({ history }, { id: "123" })).toEqual({
    weight: {
      id: 123,
      date: "2026-09-01T12:00:00Z",
      value: 160,
      units: 1,
      unitName: "pounds",
    },
  })
  expect(workflow.select!({ history }, { id: "124" })).toMatchObject({
    weight: { value: 72, unitName: "kilograms" },
  })
  expect(workflow.write).toBeUndefined()
})

it.each(
  [
    [],
    [{ id: 123, date: "2026-09-01", value: 70, units: 2 }],
    [{ id: 123, date: "2026-09-01", value: "70", units: 0 }],
    [{ id: 123, date: "", value: 70, units: 0 }],
    [{ id: 123, date: "2026-09-01", value: 0, units: 0 }],
    [{ id: 123 }, { id: 123 }],
  ].map((history) => ({ history })),
)("rejects missing, malformed, or ambiguous weight records: %j", ({ history }) => {
  expect(() => spec("weight-record").select!({ history }, { id: "123" })).toThrow(AppError)
})

it("reads persisted dismissal state independently of pending FTP existence", () => {
  expect(spec("ftp-prompt").reads({}, account)).toEqual({
    timeline: { method: "GET", path: "/app/api/react-calendar/42/timeline", body: null },
    settings: {
      method: "GET",
      path: "/app/api/membersettings?names=viewedPredictionId",
      body: null,
    },
    profile: { method: "GET", path: "/app/api/member-info", body: null },
    survey: { method: "GET", path: "/app/api/survey/check", body: null },
  })
  expect(spec("ftp-prompt").select!(fixture(), {})).toMatchObject({
    pending: { id: 789, source: 24, value: 250 },
    viewedPredictionId: 456,
    canDismiss: true,
  })
})

it("previews one fixed settings write and omits unrelated account data", () => {
  const plan = preview(fixture())
  expect(plan.request).toEqual({
    method: "PUT",
    path: "/app/api/membersettings",
    body: { name: "viewedPredictionId", value: 789 },
  })
  expect(JSON.stringify(plan)).not.toContain("SECRET")
  expect(spec("ftp-dismiss").params.id).toMatchObject({ required: true })
  expect(
    Object.values(spec("ftp-dismiss").reads(input, account)).every(
      (request) => request.method === "GET",
    ),
  ).toBe(true)
})

it("preserves the pending ID's scalar type in the viewed setting, matching browser strict equality", () => {
  expect(
    preview({ ...fixture(), settings: [{ name: "viewedPredictionId", value: "789" }] }).request
      .body,
  ).toEqual({ name: "viewedPredictionId", value: 789 })
  const stringId = {
    ...fixture(),
    timeline: { pendingAiFtpChange: { id: "prediction-789", source: 24, value: 250 } },
  }
  expect(preview(stringId, { id: "prediction-789" }).request.body).toEqual({
    name: "viewedPredictionId",
    value: "prediction-789",
  })
})

it.each([{ id: "42" }, { id: "250" }, { id: ".." }])(
  "rejects a different intent or ID namespace: %j",
  (override) => {
    expect(() => preview(fixture(), { ...input, ...override })).toThrow(AppError)
  },
)

it.each([
  { timeline: { pendingAiFtpChange: null } },
  { timeline: { pendingAiFtpChange: { id: 789, source: 22, value: 250 } } },
  { timeline: { pendingAiFtpChange: { id: 789, source: 24, value: null } } },
  { timeline: { pendingAiFtpChange: { id: 789, source: 24, value: 250, isApplied: true } } },
  { profile: { memberId: 42, ftp: 240, roles: [] } },
  { profile: { memberId: 42, roles: ["AiFtpBreakthrough"] } },
  { profile: { memberId: 99, ftp: 240, roles: ["AiFtpBreakthrough"] } },
  { settings: [{ name: "viewedPredictionId", value: 789 }] },
  { survey: { id: 123 } },
])("requires a current unseen account breakthrough with no outstanding survey: %j", (override) => {
  expect(() => preview({ ...fixture(), ...override })).toThrow(AppError)
})

it("binds role, account FTP, pending value, and viewed setting into stale-plan state", () => {
  const original = preview(fixture())
  const changedFtp = preview({
    ...fixture(),
    profile: { memberId: 42, ftp: 245, roles: ["AiFtpBreakthrough"] },
  })
  const changedPending = preview({
    ...fixture(),
    timeline: { pendingAiFtpChange: { id: 789, source: 24, value: 260 } },
  })
  const changedSetting = preview({
    ...fixture(),
    settings: [{ name: "viewedPredictionId", value: 123 }],
  })
  expect(changedFtp.before).not.toEqual(original.before)
  expect(changedPending.before).not.toEqual(original.before)
  expect(changedSetting.before).not.toEqual(original.before)
})

it("verifies the viewed ID after a single submission, even when pending data remains", () => {
  const workflow = spec("ftp-dismiss")
  const next = workflow.next(input, session, preview(fixture()).before)[0]!
  expect(next.args).toEqual(["ftp-prompt", "--session-file", session, "--json"])
  expect(next.message).toContain("789")
  expect(next.message).toContain("FTP is unchanged")
  const after = spec("ftp-prompt").select!(
    { ...fixture(), settings: [{ name: "viewedPredictionId", value: 789 }] },
    {},
  )
  expect(after).toMatchObject({
    pending: { id: 789 },
    accountFtp: 240,
    viewedPredictionId: 789,
    canDismiss: false,
    reason: "already-viewed",
  })
  expect(spec("ftp-prompt").write).toBeUndefined()
})

it("supports an unset setting and its PascalCase response name without guessing malformed data", () => {
  expect(preview({ ...fixture(), settings: [] }).before).toMatchObject({
    settingExists: false,
    viewedPredictionId: null,
  })
  expect(
    preview({ ...fixture(), settings: [{ name: "ViewedPredictionId", value: null }] }).before,
  ).toMatchObject({ settingExists: true, viewedPredictionId: null })
  for (const settings of [
    {},
    [{ name: "unrelated", value: 1 }],
    [{ name: "viewedPredictionId", value: {} }],
    [
      { name: "viewedPredictionId", value: 1 },
      { name: "viewedPredictionId", value: 2 },
    ],
  ])
    expect(() => preview({ ...fixture(), settings })).toThrow(AppError)
})

it("offers decision guidance and read-only discovery without automatic write retries", () => {
  const workflow = spec("ftp-prompt")
  const ready = workflow.next({}, session, workflow.select!(fixture(), {}))
  expect(ready[0]?.args).toEqual(["describe", "--command", "ftp-dismiss", "--json"])
  expect(ready[1]?.args).toEqual(["guide", "get", "athlete-feedback", "--json"])
  const outstanding = workflow.next(
    {},
    session,
    workflow.select!({ ...fixture(), survey: { id: 123 } }, {}),
  )
  expect(outstanding[0]?.args[0]).toBe("survey-pending")
  for (const item of fitnessWorkflows)
    for (const action of item.discover!(session)) {
      expect(action.args).toContain(session)
      expect(action.args).not.toContain("--yes")
      expect(action.args).not.toContain("--confirm")
    }
})
