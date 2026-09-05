---
topic: calendar-changes
title: Confirm and verify calendar changes
brief: Read before changing the calendar, replaying a confirmation, or recovering from an uncertain write.
---

# Confirm and verify calendar changes

Read `future` and select the planned activity's `id`. A move changes that
scheduled instance. An add uses a library `workoutId`; a copy creates another
scheduled instance. Adds and copies are not idempotent.

Run the mutation without `--yes` to receive a plan and confirmation token.
The plan names the account, absolute session path, selected inputs, and relevant
state. It contains no cookies. Exit code 4 means confirmation is required and
nothing was written. Inspect the plan, then invoke the binary with
`confirmation.confirmArgs`.

`--dry-run` returns the plan with exit code 0 and no write. `--yes` applies after
validation without a separate confirmation. Use it only for an authorized change.

Confirmation binds the account and planned action. Apply recomputes the preview
and checks the state it relies on before writing. A move checks selected activity
fields; the other calendar mutations compare their preview data and repeat
dependent reads. If those checks differ, inspect a fresh plan.
The stale-state response's `next` command returns to a preview, even when the
failed invocation used `--yes`.

TrainerRoad provides no atomic conditional update for these operations. Another
client can still change state between the last check and the write. Avoid concurrent
calendar edits. Tokens are not durable idempotency keys and do not record a
completed write.

The CLI checks returned state after moves, replacements, switches, additions,
and deletions. These checks cover the selected record, not the entire training
plan. TrainerRoad can adapt nearby workouts after a change. Inspect `future`,
`events`, or `annotations` over the affected dates before making another decision.
After success or an uncertain write, `next` supplies read-only checks for the
affected records. These commands preserve the confirmed session path. A new
record must be uniquely identifiable; ambiguous additions return `cannot_write`.

If a write fails or is interrupted, the server may already have applied it.
Read the calendar before retrying. An uncertain result is `cannot_write` and
is not automatically retried. Even an `interrupted` error with `transient: true`
does not authorize repeating a write.

## Verify submitted workflow requests

`skip-workout`, `pin-workout`, and `complete-workout` target a planned activity.
Read `planned-activity --id <id>` before choosing the change. Pinning can prevent
adaptation. Manual completion does not upload a ride or establish that the user
actually completed the workout. Ask for that intent if it is not already clear.

The new workflow commands return `submitted: true` and `verification: "required"`
when the server acknowledges the request. This is not a claim that the requested
state or its background work is complete. Follow `next` and compare the returned
record with the confirmed request. If the state has not changed, wait and read
again. Do not repeat the write to poll for completion.

Read `adaptation-status` after calendar or FTP changes. While `state` is `pending`,
wait before following its next status check. If `state` is `failed`, inspect the
calendar and resolve the failure in TrainerRoad before another write. A `settled`
status means recalculation is not pending. It does not mean the resulting workout
choices match the user's intent. Inspect the affected calendar dates as well.

`reapply-plan` is an explicit plan change, not a required follow-up to every edit.
Only request it when the user wants that plan reapplied to the selected event.
Do not infer that an unrelated calendar edit needs reapplication.

`edit-activity` changes notes on a completed ride selected from `past`.
It requires the activity's owner to match the authenticated account. Use the
user's text. An empty `--notes` value clears existing notes.

For `skip-workout`, the current browser marks a manual skip in the activity's
`values["19"]` timestamp. For `complete-workout`, compare `manuallyCompleted`.
Pinning uses `recommendationReason: 37` for adapted cycling/rest entries, or
`adaptationLocked` for other entries. Do not treat a missing field as proof that
the change succeeded. If the returned representation differs, inspect TrainerRoad
instead of guessing a new verification rule.

## Edit annotations and calendar weeks

Read `annotation-state` and `annotation-colors` before editing a note, illness,
injury, or time-off entry. The color must belong to the selected annotation type.
Edits preserve other editable fields. Plan-managed annotation types are not
general-purpose notes and cannot be edited by these commands. Moving an annotation
preserves its duration, and verification covers both the old and new ranges.

For `copy-week` and `move-week`, `--start` and `--to` each identify the first day
of a seven-day window. Read `calendar-week` for both windows before deciding.
Copying can create planned activities from completed activities that have no
associated planned activity. It is not limited to copying future workouts.
Copies can create duplicates. Never replay a completed copy as a status check.

`delete-week` requires an explicit inclusive range of one to seven days. Inspect
the preview's `expectedDeletions` and `preservedManuallyCompleted` collections.
The current browser's deletion behavior targets planned activities not marked
manually complete, not every annotation, event, or completed ride in the window.
The CLI sends the exact requested dates and does not silently clamp historical
dates to today. Historical-date server restrictions remain unverified.

After any bulk change, verify both affected windows and wait for adaptation.
The preview is not an atomic lock against another client editing the calendar.
If another client is editing those dates, stop before submitting a bulk mutation.

## Edit a single event

Use `event-state --id <event-id>` to read a standalone event through member-scoped
lookups. `edit-event` supports name and notes, plus duration in seconds and custom
TSS for an event without a plan. For events without a plan, it also supports date,
start time, cycling discipline, and A/B/C priority. Omitted fields are preserved.
It refuses grouped or triathlon events and plan-affecting edits to attached events.

Use `--time HH:mm` in 15-minute steps or `--clear-time` to remove the start time.
Never supply both. Times are local event times, not UTC conversions. Read the
named discipline choices with `describe --command edit-event --json`.

Choose priority with the user. To set A priority, supply `--race-priority a` and
`--date YYYY-MM-DD`, even when the date is unchanged. The explicit date lets the
CLI check TrainerRoad's race-spacing result before preview and again before
apply. If TrainerRoad reports a conflict, ask the user for a different date or
priority. Do not demote the event automatically.

After a date edit, follow `event-state` and its `adaptation-status` nudge. The
verification window includes both the original and new dates, so a moved event
does not hide changes left behind on the old date.

Changing name or notes does not authorize changing the plan. Verify the saved
event first. Reapply or Plan Builder remains a separate decision. For changes
refused because of plan membership or multi-stage legs, use TrainerRoad's editor.

For recurring activity discovery or tail deletion, read `guide get recurrence-changes`.
