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
