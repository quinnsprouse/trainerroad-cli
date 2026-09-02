# Changelog

## 0.4.0 - 2026-09-02

- Added `add-annotation`, `remove-annotation`, and `annotation-details`: create time off, illness, injury, and note entries (single or multi-day via `--days` or `--end-date`), remove them by id (no-op when already gone), and read the title and notes that the timeline rows omit. Uses `POST/DELETE /app/api/calendar/annotations` and `GET /app/api/react-calendar/annotation/{id}`, confirmed live.
- Added `add-event`: creates a race or event via `POST /app/api/calendar/plannedactivities/event` with discipline (by name or id), A/B/C priority, duration, and either a TSS or a 1-10 intensity estimate. Confirmed live. Events are removed with `remove-workout`.
- Added `remove-workout`: deletes a planned workout or event by planned-activity id via `DELETE /app/api/calendar/plannedactivities/{id}` (confirmed live), with `--dry-run` and a no-op when the record is already gone.
- Fixed swapped annotation type labels: typeId 2 is illness and typeId 4 is time off (checked against the web app's enum and real calendar entries). Plan-marker ids 5 to 10 are now labelled too.
- Added `workout-image`: saves a workout's power-profile chart as PNG (default, via the optional `@resvg/resvg-js` package) or SVG. Workout records from `workout-library` and `workout-details` now include `chartUrl`.
- Fixed `power-records`: the web app moved to `POST /app/api/personal-records/{memberId}`; the old `/for-date-range` path stays as a 404 fallback.
- Key normalisation now runs per object at every depth, because personal-records nests PascalCase rows inside a camelCase envelope.
- Help output uses per-command flag descriptions, so shared names like `--type` and `--days` read correctly for each command.
- Write commands report an `adaptiveTraining` note, and the README explains how Adaptive Training reacts to calendar changes and how an agent should read an athlete's situation.
- Fixed `login`: TrainerRoad replaced the server-rendered login form with a React app, so the token scrape failed. `login` now posts JSON to `/app/api/login/login` the way the web app does, and falls back to the old form flow if that route ever disappears. A bad password now fails with "TrainerRoad rejected the username or password" instead of a redirect error.
- Fixed `plan` returning 404s: plan-builder endpoints are requested by numeric `memberId` instead of username (the username stays in the referer). The career-summary endpoint had the same problem and now takes a `memberId` too.
- Made a missing `current-custom-plan` (HTTP 404) non-fatal. The web app no longer calls that endpoint at all, so when it is absent `currentPlan` is derived from `all-user-plans` (the plan whose start/end window contains today) and its matching `plan-phases` rows. `currentPlan.source` reports which path produced it, and `currentPhaseName` names the active phase.
- Every API request now sends `trainerroad-jsonformat: camel-case` by default, and a PascalCase payload is normalised to camelCase if the header is ever ignored, so a dropped header or a casing change cannot blank the output.
- Request failures throw `HttpError` with `status`, `statusText`, `path`, and `payload` (message unchanged).
- Added tests for the JSON login flow and its fallback, memberId-keyed URLs, the format header, PascalCase normalisation, non-fatal 404 handling, and date-window current-plan derivation.

## 0.3.0 - 2026-03-25

- Added richer command help with examples, required-flag metadata, and machine-readable help payloads.
- Improved agent-facing failure messages so missing required flags fail fast with actionable retry guidance.
- Added `--dry-run` previews for calendar mutation commands.
- Made convergent mutation commands idempotent when the requested end state is already satisfied.
- Fixed login default return-path handling so it follows the provided username.
- Added automated tests covering CLI help/error behavior and write-command dry-run/no-op semantics.
