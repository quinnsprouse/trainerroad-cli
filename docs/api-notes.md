# TrainerRoad API Notes

Date captured: 2026-02-23

## Authentication flow (current, captured 2026-09-02)

`/app/login` is a React single-page app. It authenticates with one JSON call:

- `POST /app/api/login/login` with `content-type: application/json` and the usual
  `trainerroad-jsonformat: camel-case` header.
- Body: `{"username": "<username or email>", "password": "...", "returnUrl": "/app/career/<username>" | null}`
- Bad credentials: HTTP 200 with `{"success": false, "redirectUrl": null}`.
- Success: HTTP 200 with `{"success": true, "redirectUrl": "..."}` and `Set-Cookie: SharedTrainerRoadAuth=...`.
  The web app then navigates to `redirectUrl`.

Auth is cookie-based. Local storage did not contain primary auth tokens.

### Legacy form flow (worked until mid-2026)

The CLI keeps this as a fallback in case the JSON route goes away.

1. `GET /app/login?ReturnUrl=%2Fapp%2Fcareer%2F{username}`
2. Parse hidden form inputs `ReturnUrl` and `__RequestVerificationToken`.
3. `POST /app/login` (`application/x-www-form-urlencoded`) with `Username`, `Password`, `ReturnUrl`,
   `__RequestVerificationToken`.
4. Success: HTTP `302` to `/app/career/{username}` plus `Set-Cookie: SharedTrainerRoadAuth=...`.

## Response casing

The API returns PascalCase keys (`MemberId`, `Start`) unless the request carries
`trainerroad-jsonformat: camel-case`. The web app sends that header on every call, and so does the
CLI. If a payload still comes back PascalCase the client lower-cases the first letter of each key.

## Member-id vs username paths

Several endpoints that used to accept a username now 404 on it and want the numeric `memberId`.
Confirmed 2026-09-02 (member 211199):

| Path | username | memberId |
| --- | --- | --- |
| `/app/api/plan-builder/{id}/all-user-plans` | 404 | 200 |
| `/app/api/plan-builder/{id}/plan-phases` | 404 | 200 |
| `/app/api/plan-builder/current-custom-plan/{id}` | 404 | 404 |
| `/app/api/career/{id}/new` | 404 | 200 |
| `/app/api/tss/{id}` (public) | 200 | 404 |

Send `referer: https://www.trainerroad.com/app/career/{username}` on member-keyed calls.

## Plan-builder endpoints (authenticated)

The web calendar loads only `all-user-plans` and `plan-phases`; it never calls `current-custom-plan`.

- `GET /app/api/plan-builder/{memberId}/all-user-plans` — array of plan summaries:
  `id` (GUID), `name`, `discipline` (int), `volume` (int), `phase`, `start`, `end` (local date-times,
  no offset), `isAdHoc`, `plannedActivityGroupId`, `inputJson` (the plan-builder wizard input).
- `GET /app/api/plan-builder/{memberId}/plan-phases` — array of phase rows: `id`, `customPlanId`
  (matches a plan `id`), `type` (int), `volume`, `planId`, `planName` (e.g. "Sustained Power Build"),
  `start`, `end` (ends at `23:59:59.999`), `isMasters`, `isPolarized`. A phase can start a few days
  before its plan's `start`, so match phases to plans by `customPlanId`, not by date.
- `GET /app/api/plan-builder/current-custom-plan/{memberId}` — 404. The CLI treats this as "no
  explicit current plan" and derives it from the two calls above (plan window containing today).

## Annotation endpoints (authenticated, confirmed 2026-09-02)

Annotations are the calendar's time off, illness, injury, and note entries. Timeline rows carry
only `id`, `typeId`, `date`, `duration`, `groupId`, `updated`; the title and notes need the detail call.

- `GET /app/api/react-calendar/annotation/{annotationId}` — `id`, `date` ({year,month,day}),
  `timeOfDay`, `duration` (seconds, whole days), `title`, `text`, `styleIndex`, `typeId`, `colorId`,
  `colorHex`, `plannedActivityGroupId`.
- `POST /app/api/calendar/annotations` — JSON body
  `{"date":"YYYY-MM-DD","timeOfDay":null,"duration":<days*86400>,"title":"...","text":"...","typeId":<n>,"colorId":2}`.
  `date` must be a plain date string; a `{year,month,day}` object is rejected with 400. Responds 204
  with no body, so the new id has to be found by diffing the timeline.
- `PUT /app/api/calendar/annotations/{annotationId}` — same body as create (from the web bundle, not
  yet exercised by the CLI).
- `PUT /app/api/calendar/annotations/{annotationId}/move` — `{"newDate":"YYYY-MM-DD","oldDate":"YYYY-MM-DD"}`.
- `DELETE /app/api/calendar/annotations/{annotationId}` — 204. `GET` on that path is 405.
- `DELETE /app/api/react-calendar/annotation/{annotationId}` — the variant the web app uses from its
  "delete and adapt" modal, followed by `PUT /app/api/calendar/plans/plan/{planId}/reapply-plan`.
- Type ids (web-app enum, checked against real annotations 2026-09-02): 1 note, 2 illness, 3 injury,
  4 time-off, 5 stage-race, 6 custom-plan-start, 7 custom-plan-week, 8 custom-plan-block,
  9 plan-start, 10 plan-week. Only 1 to 4 are user-editable. Earlier notes here had 2 and 4 swapped.

## Event and planned-activity write endpoints (from the web bundle, 2026-09-02)

Base: `/app/api/calendar/plannedactivities`. Events are planned activities with `activityType` 1.

- `POST .../event` — `{"customPlanId":null,"name":"...","date":"YYYY-MM-DD","time":null,"discipline":<n>,"duration":<seconds>,"notes":"","racePriority":1|2|3,"stressEstimateType":1|2,"stressEstimateValue":<intensity or null>,"tss":<tss or null>,"manuallyCompleted":false}`.
  TSS mode: `stressEstimateType` 1 with `tss` set. Intensity mode: `stressEstimateType` 2 with `stressEstimateValue`.
- `PUT .../{eventId}/event` — same body.
- `DELETE .../{plannedActivityId}` — 204 for workouts and events alike. Confirmed live on a throwaway
  copy of a workout; the record 404s afterwards.
- `POST .../workout` — `{"date":"YYYY-MM-DD","isManualComplete":false,"recommendationReason":37,"time":null,"type":0|1|5,"workoutId":<id>}` (type 0 inside, 1 outside, 5 group workout; 37 = athlete-selected).
- `POST .../ai-workout` — `{"date","time","duration":<minutes>,"isManualComplete":false,"maxDynamicDuration","zone","profileId","type"}`.
- `PUT .../{id}/skip` (body `null`), `PUT .../{id}/pin` (`{"pinned":true}`), `POST .../{id}/mark-manually-complete` (`{"completed":true}`), `POST .../{id}/copy/{YYYY-MM-DD}`.
- `PUT /app/api/calendar/plans/plan/{planId}/reapply-plan` — body `null`. The web app calls this after
  calendar changes that should trigger Adaptive Training; progress via `GET /app/api/calendar/{memberId}/ff-progress`.

Discipline ids for events: 0 climbing road race, 1 rolling road race, 2 time trial, 3 criterium,
4 gran fondo, 5 cyclocross, 6 sprint tri, 7 olympic tri, 8 half tri, 9 full tri, 10 off-road tri,
11 XC olympic, 12 XC marathon, 13 short track, 14 gravity, 15 enduro, 16 gravel. Race priority:
1 C, 2 B, 3 A.

## Workout chart images

`GET /app/api/workouts/{workoutId}/summary` and `POST /app/api/workouts/by-id` both return `picUrl`,
a public Azure blob URL ending in `chart.svg` (the power-profile graphic, 381x254 viewBox, dark
background). The blob needs no cookies. The CLI rasterises it with `@resvg/resvg-js`.

## Adaptive Training side effects

TrainerRoad rebuilds upcoming planned workouts in response to calendar changes: deleting or adding
a workout, and adding time off, illness, or injury. Planned activities expose
`recommendationReason`, `adaptationLocked`, `adaptationAltered`, and `adaptationReason`. Re-read
the timeline after any write before reasoning about the plan.

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
- `GET /app/api/career/{memberId}/new` (username 404s since mid-2026)
  - Returns career summary fields including `ftp`, `weightKg`, and plan flags.
- `GET /app/api/ai-ftp-detection/can-use-ai-ftp/{memberId}`
  - Returns AI FTP eligibility (`can`, `reason`) and additional detection data.
- `GET /app/api/calendar/aiftp/{memberId}/ai-failure-status`
  - Returns AI FTP failure status code.
- `GET /app/api/onboarding/power-ranking?memberId={memberId}`
  - Returns power percentile rankings by duration.
- `POST /app/api/personal-records/{memberId}?rowType=...&indoorOnly=...` (was `/personal-records/for-date-range/{memberId}` until mid-2026; the CLI falls back to it on 404)
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
