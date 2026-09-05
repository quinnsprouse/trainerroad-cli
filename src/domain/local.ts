import { Schema } from "effect"
import { Member } from "./calendar.ts"

export const LoginPlan = Schema.Struct({
  sessionFile: Schema.String,
  previous: Schema.NullOr(Schema.String),
  username: Schema.NonEmptyString,
  returnPath: Schema.String,
  passwordStdin: Schema.Boolean,
})
export type LoginPlan = typeof LoginPlan.Type
export const LogoutPlan = Schema.Struct({
  sessionFile: Schema.String,
  previous: Schema.NullOr(Schema.String),
})
export type LogoutPlan = typeof LogoutPlan.Type
export const ImagePlan = Schema.Struct({
  sessionFile: Schema.String,
  member: Member,
  workoutId: Schema.Int,
  chartUrl: Schema.String,
  chartDigest: Schema.String,
  file: Schema.String,
  imageFormat: Schema.Literals(["png", "svg"]),
  width: Schema.Int,
  background: Schema.String,
})
export type ImagePlan = typeof ImagePlan.Type
export const ImageResult = Schema.Struct({
  file: Schema.String,
  bytes: Schema.Int,
  imageFormat: Schema.Literals(["png", "svg"]),
  workoutId: Schema.Int,
})
export type ImageResult = typeof ImageResult.Type
