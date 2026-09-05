import { DateTime, Effect, Schema } from "effect"
import { Errors } from "../errors.ts"

export const Id = Schema.Union([Schema.NonEmptyString, Schema.Int])
export const Member = Schema.Struct({ memberId: Id, username: Schema.NonEmptyString })
export type Member = typeof Member.Type
export const AccountProfile = Schema.StructWithRest(Member, [
  Schema.Record(Schema.String, Schema.Json),
])
export type AccountProfile = typeof AccountProfile.Type

export const CalendarDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value) => {
    const parsed = DateTime.make(`${value}T00:00:00Z`)
    return parsed._tag !== "None" && DateTime.formatIsoDateUtc(parsed.value) === value
  }),
)
export const PlannedActivity = Schema.Struct({
  id: Schema.NonEmptyString,
  date: CalendarDate,
  name: Schema.NullOr(Schema.String),
  workoutId: Schema.NullOr(Id),
  isOutside: Schema.NullOr(Schema.Boolean),
  canMove: Schema.NullOr(Schema.Boolean),
})
export type PlannedActivity = typeof PlannedActivity.Type

export const RawActivity = Schema.Struct({
  id: Id,
  date: Schema.Struct({ year: Schema.Int, month: Schema.Int, day: Schema.Int }),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  workoutId: Schema.optional(Schema.NullOr(Id)),
  canMove: Schema.optional(Schema.NullOr(Schema.Boolean)),
  workout: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        id: Id,
        name: Schema.optional(Schema.NullOr(Schema.String)),
        isOutside: Schema.optional(Schema.NullOr(Schema.Boolean)),
      }),
    ),
  ),
})

export const normalizeActivity = (raw: typeof RawActivity.Type): PlannedActivity => ({
  id: String(raw.id),
  date: `${String(raw.date.year).padStart(4, "0")}-${String(raw.date.month).padStart(2, "0")}-${String(raw.date.day).padStart(2, "0")}`,
  name: raw.workout?.name ?? raw.name ?? null,
  workoutId: raw.workout?.id ?? raw.workoutId ?? null,
  isOutside: raw.workout?.isOutside ?? null,
  canMove: raw.canMove ?? null,
})

export const calendarDate = Effect.fn("calendarDate")(function* (
  value: string | undefined,
  flag: string,
) {
  if (value === undefined) {
    return yield* Errors.invalidUsage({
      message: `missing required flag --${flag}`,
      fix: `provide --${flag} YYYY-MM-DD`,
    })
  }
  return yield* Schema.decodeEffect(CalendarDate)(value).pipe(
    Effect.mapError(() =>
      Errors.invalidUsage({
        message: `invalid --${flag} date`,
        fix: `provide --${flag} YYYY-MM-DD`,
      }),
    ),
  )
})

export const MovePlan = Schema.Struct({
  sessionFile: Schema.NonEmptyString,
  member: Member,
  before: PlannedActivity,
  to: CalendarDate,
})
export type MovePlan = typeof MovePlan.Type

export const MoveResult = Schema.Struct({
  member: Member,
  before: PlannedActivity,
  after: PlannedActivity,
  changed: Schema.Boolean,
})
export type MoveResult = typeof MoveResult.Type

export const sameActivity = (left: PlannedActivity, right: PlannedActivity): boolean =>
  left.id === right.id &&
  left.date === right.date &&
  left.workoutId === right.workoutId &&
  left.isOutside === right.isOutside &&
  left.canMove === right.canMove &&
  left.name === right.name
