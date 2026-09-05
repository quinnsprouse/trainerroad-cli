---
topic: session-and-ids
title: Accounts, record ids, and date windows
brief: Read before selecting an account, choosing a mutation target, or interpreting date windows.
---

# Accounts, record ids, and date windows

Authenticate with `trainerroad-cli login`. Login is a file mutation, so inspect
its plan before confirming, or use `--yes` for an authorized login.
Credentials come from `TR_USERNAME` and `TR_PASSWORD`, or `--username` and
`--password-stdin`. Password input is consumed only during apply. Never put a
password in argv or read session cookies into model context.

Use the same `--session-file` across commands. Without that flag, the CLI uses
`TR_SESSION_FILE` or `.trainerroad/session.json` relative to the working directory.
Run `whoami --json` to verify the account. Logout removes the local session file;
it does not revoke the account's other sessions.

A planned calendar row's `id` identifies one scheduled instance.
Its `workoutId`, or `workout.id` in detailed data, identifies a workout in the
library. Several scheduled rows can share that library id.
Use planned ids for move, copy, replace, switch, and remove. Use library ids for
add-workout, workout-details, and workout-image. Annotation ids belong to
annotation-details and remove-annotation. Events are removed with remove-workout.

`planned-activity`, `skip-workout`, `pin-workout`, and `complete-workout` also use
planned activity ids. `activity-details` and `edit-activity` use completed activity
ids from `past`. Do not reuse one kind of id in another command because it looks
numeric. Read each command's description if the id namespace is unclear.

For a weight measurement, select its record ID from `weight-history`, then read
`weight-record --id <id>`. The value retains the recorded units: 0 means kilograms
and 1 means pounds. Do not treat it as the account's current display unit or
silently convert it. Weight writes still require the TrainerRoad app.

Collection responses expose selected columns and a `source` object containing
the retained record. Planned dates in those records may be `{ year, month, day }`.
A missing column is null, not a guarantee about the upstream state.

`--from`, `--to`, and target dates use inclusive calendar dates, not timestamps.
The planned date itself is not timezone-converted. Relative windows and completed
ride bucketing use `--tz`, then `TR_TIMEZONE`, then the system timezone.
Future defaults to the next 60 days; past defaults to 60 days and 30 records.
Use explicit bounds for reproducible reads.

Public-profile reads provide day-level load and plan signals, not authenticated
workout details. They cannot authorize private calendar mutations.
A null field or an empty public result does not prove that private data is absent.
