# TrainerRoad API Notes

Date captured: 2026-02-23

## Authentication flow

1. `GET /app/login?ReturnUrl=%2Fapp%2Fcareer%2F{username}`
2. Parse hidden form inputs:
   - `ReturnUrl`
   - `__RequestVerificationToken`
3. `POST /app/login` (`application/x-www-form-urlencoded`) with:
   - `Username`
   - `Password`
   - `ReturnUrl`
   - `__RequestVerificationToken`
4. Success behavior:
   - HTTP `302` redirect to `/app/career/{username}`
   - `Set-Cookie: SharedTrainerRoadAuth=...`

Auth is cookie-based. Local storage did not contain primary auth tokens.

## Core data endpoints

- `GET /app/api/member-info`
  - Returns `memberId`, `username`, profile metadata.
- `GET /app/api/react-calendar/{memberId}/timeline`
  - Returns compact data for:
    - `activities` (past rides/workouts summary)
    - `plannedActivities` (future and historical planned workouts summary)
    - `events`, `annotations`, etc.

## Public profile endpoint

- `GET /app/api/tss/{username}`
  - Accessible without login for public profiles.
  - Returns day-level series (camel-case with `trainerroad-jsonformat: camel-case`):
    - `tssByDay` (nested week/day arrays)
    - each day includes `tss`, `plannedTssTrainerRoad`, `plannedTssOther`, `hasRides`
  - Does not provide workout-level detail records.

## Additional performance endpoints (authenticated)

- `GET /app/api/career/{memberId}/levels`
  - Returns progression-level object keyed by progression ID and timestamp.
- `GET /app/api/career/{username}/new`
  - Returns career summary fields including `ftp`, `weightKg`, and plan flags.
- `GET /app/api/ai-ftp-detection/can-use-ai-ftp/{memberId}`
  - Returns AI FTP eligibility (`can`, `reason`) and additional detection data.
- `GET /app/api/calendar/aiftp/{memberId}/ai-failure-status`
  - Returns AI FTP failure status code.
- `GET /app/api/onboarding/power-ranking?memberId={memberId}`
  - Returns power percentile rankings by duration.
- `POST /app/api/personal-records/for-date-range/{memberId}?rowType=...&indoorOnly=...`
  - Requires JSON body like:
    - `[{"Slot":1,"StartDate":"2013-05-10","EndDate":"2026-02-23"}]`
  - Returns `results[0].personalRecords`.

## Calendar write endpoints (authenticated)

- `GET /app/api/calendar/plannedactivities/{plannedActivityId}`
  - Returns a full planned workout/activity record.
- `GET /app/api/calendar/plannedactivities/{plannedActivityId}/alternates/{category}`
  - Categories observed: `similar`, `easier`, `harder`, `longer`, `shorter`.
- `PUT /app/api/react-calendar/planned-activity/{plannedActivityId}/move`
  - JSON body:
    - `{"newDate":{"year":2026,"month":3,"day":13}}`
- `PUT /app/api/react-calendar/planned-activity/{plannedActivityId}/replace-with-alternate`
  - JSON body:
    - `{"alternateWorkoutId":1056132,"updateDuration":false}`
- `PUT /app/api/react-calendar/planned-activity/{plannedActivityId}/switch-to-inside`
- `PUT /app/api/react-calendar/planned-activity/{plannedActivityId}/switch-to-outside`

Observed live against Quinn's account on March 11, 2026:

- Moving `Recess` (`05a68215-0fd5-431e-ba3f-b3bf01210c29`) between March 12, 2026 and March 13, 2026 succeeded.
- Replacing that workout with alternate `Totten Key` (`1056132`) and then restoring `Recess` (`18128`) succeeded.
- Switching that workout to outside and back to inside succeeded.
- Restoring the original workout after an alternate swap preserved the workout/date, but `recommendationReason` changed from the original planned value to an athlete-selected value (`31`).

## Workout library endpoints (authenticated)

- `GET /app/api/workouts/workout-profiles-by-zone`
  - Returns zone/profile catalog and duration buckets.
- `POST /app/api/workouts`
  - Returns paginated workout-library results for the provided predicate.
  - Observed default predicate shape:
    - `pageNumber`, `pageSize`, `isDescending`, `sortProperty`
    - `searchText`
    - `progressions.profileIds`, `progressions.progressionIds`
    - `durations.*` bucket booleans
    - `workoutInstructions.yup|nope`
    - `workoutTypes.outside`
  - Response includes:
    - `predicate.totalCount`
    - `workouts[]` with fields like `id`, `workoutName`, `duration`, `tss`, `intensityFactor`, `progressionId`, `progressionLevel`, `profileId`, `profileName`, `isOutside`, `hasInstructions`
- `POST /app/api/workouts/by-id`
  - JSON body is an array of numeric workout IDs, e.g. `[18128]`.
- `GET /app/api/workouts/{workoutId}/summary`
- `GET /app/api/workouts/{workoutId}/levels`
- `GET /app/api/workouts/{workoutId}/chart-data`

## Add-workout notes

- TrainerRoad exposes at least two observed add-workout paths:
  - `POST /app/api/react-calendar/planned-tr-workout`
  - `POST /app/api/calendar/plannedactivities/workout`
- On Quinn's account on March 11, 2026, these add endpoints were inconsistent:
  - some requests returned HTTP `500`
  - at least one earlier request appears to have still resulted in calendar changes on March 18, 2026
  - empty-date repro attempts on March 16, 2026 and March 24, 2026 did not create a confirmed workout
- Because of that, CLI add-workout support should reconcile against the refreshed calendar after the POST rather than trusting the HTTP status alone.

## Copy-workout notes

- `POST /app/api/calendar/plannedactivities/{plannedActivityId}/copy/{YYYY-MM-DD}`
- Observed live on March 11, 2026:
  - copying planned activity `05a68215-0fd5-431e-ba3f-b3bf01210c29` to March 16, 2026 returned HTTP `204`
  - the copied workout appeared on the target date with a new planned activity ID
  - the copied workout could then be deleted cleanly via `DELETE /app/api/calendar/plannedactivities/{plannedActivityId}`

## TrainNow / AI Workouts

- `GET /app/api/train-now`
  - Returns account-level TrainNow state such as:
    - `hasTrainingPlan`
    - `hasPlanWorkoutToday`
    - `hasCompletedWorkoutToday`
- `POST /app/api/train-now`
  - Observed body:
    - `{"duration":60,"numSuggestions":10}`
  - Returns:
    - `recommendedCategory`
    - `suggestions.Attacking[]`
    - `suggestions.Climbing[]`
    - `suggestions.Endurance[]`
    - `hasRpePredictionServiceFailure`
- `GET /app/api/workout-information?ids=524179,265545,467754`
  - Enriches TrainNow suggestion IDs with workout card details used by the web UI.

## Detail endpoint behavior

The following endpoints return `400` unless request header `ids` is present:

- `GET /app/api/react-calendar/{memberId}/activities`
- `GET /app/api/react-calendar/{memberId}/planned-activities`
- `GET /app/api/react-calendar/{memberId}/personal-records`

Required/observed headers for these requests:

- `ids`: comma-separated IDs
- `trainerroad-jsonformat: camel-case`
- `tr-cache-control: use-cache` (observed)
- Auth cookie (`SharedTrainerRoadAuth`) in `Cookie`

ID source:

- Use `/timeline` response to collect IDs:
  - activities IDs are numeric (`activity.id`)
  - planned IDs are UUID strings (`plannedActivities.id`)

## Useful strategy for CLI

1. Login once and persist cookies securely.
2. Fetch `/member-info` for `memberId` + `username`.
3. Fetch `/timeline` for global summary dataset.
4. Filter for date windows client-side.
5. For richer detail, batch call detail endpoints with `ids` header.
6. For public profile fallback, use `/app/api/tss/{username}` and expose day-level signals only.
