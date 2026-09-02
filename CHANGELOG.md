# Changelog

## 0.3.1 - 2026-09-02

- Fixed `plan` returning 404s: plan-builder endpoints are now requested by numeric `memberId` instead of username (the username stays in the referer).
- Made a missing `current-custom-plan` (HTTP 404) non-fatal. When it is absent, `currentPlan` is derived from `all-user-plans` (the plan whose start/end window contains today) and its matching `plan-phases` rows. `currentPlan.source` reports `current-custom-plan` or `all-user-plans`.
- Request failures now throw `HttpError` with `status`, `statusText`, `path`, and `payload` (message unchanged).
- Added tests for memberId-keyed plan-builder URLs, non-fatal 404 handling, and date-window current-plan derivation.
- Documented the new `POST /app/api/login/login` JSON login flow; the scraped-form `login` command no longer works against the React login page and needs a follow-up fix.

## 0.3.0 - 2026-03-25

- Added richer command help with examples, required-flag metadata, and machine-readable help payloads.
- Improved agent-facing failure messages so missing required flags fail fast with actionable retry guidance.
- Added `--dry-run` previews for calendar mutation commands.
- Made convergent mutation commands idempotent when the requested end state is already satisfied.
- Fixed login default return-path handling so it follows the provided username.
- Added automated tests covering CLI help/error behavior and write-command dry-run/no-op semantics.
