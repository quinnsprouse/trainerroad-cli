import { Schema } from "effect"
import { Member } from "./calendar.ts"

export const JsonObject = Schema.Record(Schema.String, Schema.Json)
export type JsonObject = typeof JsonObject.Type
export const Flags = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]),
)
export type Flags = typeof Flags.Type
export const QueryData = Schema.StructWithRest(
  Schema.Struct({
    command: Schema.String,
    member: Schema.StructWithRest(Schema.Struct({ username: Schema.String }), [JsonObject]),
  }),
  [JsonObject],
)
export const CollectionData = Schema.StructWithRest(
  Schema.Struct({
    command: Schema.String,
    member: Schema.StructWithRest(Schema.Struct({ username: Schema.String }), [JsonObject]),
    items: Schema.Array(JsonObject),
    count: Schema.Int,
  }),
  [JsonObject],
)
export const OperationPlan = Schema.Struct({
  command: Schema.String,
  flags: Flags,
  preview: Schema.StructWithRest(Schema.Struct({ member: Member, query: JsonObject }), [
    JsonObject,
  ]),
})
export type OperationPlan = typeof OperationPlan.Type
