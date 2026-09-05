---
topic: workflow-boundaries
title: Recognize tasks that still need TrainerRoad
brief: Read when a requested workflow is absent from describe or needs a plan builder, recurrence editor, or provider handoff.
---

# Recognize tasks that still need TrainerRoad

Start with `describe --json`. It lists the commands implemented by this binary,
not every TrainerRoad feature. Browser-derived commands are experimental and have
fixture tests, not live-account verification. Do not invent an endpoint or send a
raw request when a command is absent.

Use the TrainerRoad app for these tasks until their complete API workflows are
implemented:

- Create a training plan or change its schedule, volume, goals, or approach.
- Edit a recurring series or create an exception to one occurrence.
- Author workout intervals or custom workout geometry.
- Create or replace body-weight records.
- Trigger a new FTP detection, handle mid-phase acceptance, or reject a detection.
- Connect or disconnect providers, import past activities, or upload completed rides.
- Edit multi-stage or triathlon event legs, or rebuild a plan after an event change
  when the available CLI command refuses that change.

Keep the user's requested goal, selected account, relevant IDs, and dates in the
handoff. Explain which part needs the app. Do not claim that a related command
completes it: renaming a plan does not rebuild it, pinning a workout does not edit
its intervals, and pushing an outside workout does not import completed rides.

Obtain approval before a materially different action. Do not replace an unsupported
edit with delete-and-recreate, dismiss a survey instead of submitting an answer, or
start OAuth merely to inspect provider status.

After the user completes the app step, resume with the matching read-only command.
Use `plan`, `calendar-week`, `future`, `past`, `ftp-status`, or `sync-list` as appropriate.
Inspect the resulting state before proposing another mutation.

For intentional deletion of this and all uncompleted future recurring activities,
read `recurrence-changes`. The CLI supports that specific tail-deletion workflow.
It does not replace a recurring edit or delete only the displayed date window.

## Inspect training approaches before an app handoff

Run `training-approaches --json` using the selected session. To inspect one change,
repeat the command with its `--id`. Optional `--from` and `--to` flags restrict the
timeline request. If an ID is absent, remove the date filter before concluding
that it was deleted.

Preserve the returned date timestamp. Do not call the last listed entry the current
approach. TrainerRoad uses the athlete's timezone, effective dates, and completed
activities to decide whether editing updates a record, creates one, or removes a
redundant change. The CLI does not calculate those permissions.

The `setting` codes are Default 0, VeryLow 1, Low 2, High 3, and VeryHigh 4.
`customAggressiveness` uses the same codes for each training zone when present.
These are stored choices, not recommendations for the user. Retain the selected
record's `customPlanId`, adaptation settings, and the user's requested change in
the handoff. Read `training-approaches` again after the app step to verify it.
