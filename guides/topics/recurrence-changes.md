---
topic: recurrence-changes
title: Inspect recurring activities and delete a series tail
brief: Read before selecting a recurrence occurrence or deleting this and uncompleted future activities. Preview windows do not limit tail deletion.
---

# Inspect recurring activities and delete a series tail

Use the same `--session-file` for discovery, preview, confirmation, and verification.

## Inspect a recurring activity

Run `recurring-activities --from YYYY-MM-DD --to YYYY-MM-DD` with the selected
session. The result lists series IDs and occurrence indices within that window.
It is not a complete history of every series or materialized occurrence.

Follow `recurrence-state --id <series-id>` with the same date window. It matches
the detail records to the authenticated member's timeline before showing the
activity and recurrence definition. A series ID, occurrence index, planned
activity ID, and workout-library ID are different identifiers. Do not substitute
one for another or build a composite occurrence ID.

To request an edit, establish whether the user means one occurrence or that
occurrence and all future ones. Complete the edit in TrainerRoad. One-occurrence
edits can create a standalone activity and exclude the original. Later-series
edits can split the series, so do not assume the old series ID remains sufficient.
After the app step, repeat discovery over the same dates and inspect the returned
IDs. An empty window does not prove the whole series was deleted.

## Delete this and uncompleted future recurring activities

Use this workflow only when the user intends to delete the series from one
occurrence onward, with no end date. It is not a one-occurrence delete, and
`--verify-through` never limits the deletion. Do not substitute this workflow
for an unsupported edit or a bounded-date deletion.

Discover the series with `recurring-activities`, then inspect `recurrence-state`.
Keep its series ID, occurrence index, and date. Preview `delete-recurrence-tail`
with `--id`, `--index`, `--from`, and `--verify-through`. The first date must match
that occurrence. The last date defines the preview and verification window only.

Inspect the preview's `deletionScope`, anchor, occurrence details, and linked
planned activities. It also retains completed-activity snapshots for comparison.
The CLI fetches planned-activity details to check recurrence linkage, rather than
guessing from plan group IDs. Missing or inconsistent details stop the operation.
An anchor available only as a materialized planned activity is not supported.

Tell the user that the deletion cannot be undone and includes future activities
beyond the displayed window. Confirm only that exact scope. Submit once, then
follow `recurrence-tail-state` and check `adaptation-status`. Once recalculation
settles, repeat the state read and compare the completed snapshots with the plan.
If completed records changed unexpectedly, stop and inspect TrainerRoad.

Compare the confirmed linked IDs against `inspectedPlannedActivities`, not only
the new linked list. A surviving activity can lose its recurrence link. If a
previously linked, uncompleted ID remains, do not call it deleted or repeat the
tail deletion to try to remove it.

The state query accepts an empty tail. It reports observations, not verified
whole-series deletion or guaranteed preservation of completed rides. Inspect a
later window if necessary. On a lost response, use these same reads before
considering another write.
