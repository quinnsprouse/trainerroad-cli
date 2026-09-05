import { Schema } from "effect"
import type { ParamSpec } from "../contract/contract.ts"
import type { GuideTopic } from "../guides/catalog.generated.ts"
import type { NextAction } from "../output/guidance.ts"
import { Errors } from "../errors.ts"
import { Member } from "./calendar.ts"
import { Flags, JsonObject } from "./operation.ts"

export const ApiRequest = Schema.Struct({
  method: Schema.Literals(["GET", "POST", "PUT", "DELETE"]),
  path: Schema.NonEmptyString,
  body: Schema.Json,
  ids: Schema.optional(Schema.Array(Schema.NonEmptyString)),
})
export type ApiRequest = typeof ApiRequest.Type
export const WorkflowPlan = Schema.Struct({
  command: Schema.NonEmptyString,
  sessionFile: Schema.NonEmptyString,
  member: Member,
  input: Flags,
  before: JsonObject,
  request: ApiRequest,
})
export type WorkflowPlan = typeof WorkflowPlan.Type
export const WorkflowData = Schema.Struct({
  member: Member,
  sessionFile: Schema.NonEmptyString,
  records: JsonObject,
})
export const Submitted = Schema.Struct({
  member: Member,
  submitted: Schema.Literal(true),
  verification: Schema.Literal("required"),
})

export interface Workflow {
  readonly name: string
  readonly summary: string
  readonly params: Readonly<Record<string, ParamSpec>>
  readonly example: string
  readonly guide: GuideTopic
  readonly validate?: (input: Flags) => void
  readonly reads: (input: Flags, member: Member) => Readonly<Record<string, ApiRequest>>
  readonly hydrate?: (
    records: JsonObject,
    input: Flags,
    member: Member,
  ) => Readonly<Record<string, ApiRequest>>
  readonly select?: (records: JsonObject, input: Flags) => JsonObject
  readonly write?: (input: Flags, member: Member, before: JsonObject) => ApiRequest
  readonly next: (
    input: Flags,
    sessionFile: string,
    before: JsonObject,
  ) => ReadonlyArray<NextAction>
  readonly discover?: (sessionFile: string) => ReadonlyArray<NextAction>
}

export const get = (path: string, ids?: readonly string[]): ApiRequest => ({
  method: "GET",
  path,
  body: null,
  ...(ids === undefined ? {} : { ids }),
})
export const send = (
  method: ApiRequest["method"],
  path: string,
  body: Schema.Json = null,
): ApiRequest => ({ method, path, body })
export const segment = (value: string | number): string => {
  if (String(value) === "." || String(value) === "..")
    throw Errors.invalidUsage({
      message: "invalid resource id",
      fix: "use an id returned by the matching list command",
    })
  return encodeURIComponent(String(value))
}
export const required = (description: string): ParamSpec => ({
  kind: "flag",
  type: "string",
  required: true,
  description,
})
export const choice = (
  description: string,
  choices: readonly [string, ...string[]],
): ParamSpec => ({ kind: "flag", type: "choice", required: true, description, choices })
export const value = (input: Flags, key: string): string => {
  const result = input[key]
  if (typeof result !== "string" || result.trim().length === 0)
    throw Errors.invalidUsage({
      message: `--${key.replace(/[A-Z]/g, (s) => "-" + s.toLowerCase())} must not be empty`,
      fix: "inspect this command with describe and supply its required value",
    })
  return result
}
export const record = (data: Schema.Json | undefined): JsonObject => {
  if (!Schema.is(JsonObject)(data))
    throw Errors.invalidData({
      message: "unexpected TrainerRoad record",
      fix: "stop and check the current API response; do not guess missing fields",
    })
  return data
}
export const identified = (data: Schema.Json | undefined, id: string): JsonObject => {
  const result = record(data)
  if ((typeof result.id !== "string" && typeof result.id !== "number") || String(result.id) !== id)
    throw Errors.invalidData({
      message: "TrainerRoad returned a different resource",
      fix: "list the resources again and use the exact id",
    })
  return result
}
export const follow = (
  command: string,
  args: readonly string[],
  sessionFile: string,
  message: string,
): ReadonlyArray<NextAction> => [
  { message, args: [command, ...args, "--session-file", sessionFile, "--json"] },
]
