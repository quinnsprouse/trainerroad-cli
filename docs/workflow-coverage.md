# Workflow coverage

The `describe --json` roster is the command inventory. This reference records the
boundaries of the browser-derived additions, not a public TrainerRoad API guarantee.
Request contracts were recovered from public browser bundles on 2026-09-04.
No live account requests were used to validate these additions.

| Workflow | Implemented commands | Boundary |
| --- | --- | --- |
| Planned activity state | `planned-activity`, `skip-workout`, `pin-workout`, `complete-workout` | Planned IDs only. Manual completion does not upload a ride. |
| Recalculation | `adaptation-status`, `reapply-plan` | Reapply checks plan/event membership and is a separate confirmed decision. |
| Completed activity notes | `activity-details`, `edit-activity` | Notes replacement on the authenticated owner's activity, not arbitrary activity editing. |
| Survey feedback | `survey-pending`, `survey-options`, `survey-response`, `survey-submit` | Dynamic element IDs and account feature checks. Standalone feedback only, not the browser's post-ride reconciliation flow. |
| Pending FTP | `ftp-status`, `ftp-accept` | Accept a verified pending record and explicit value. No detection creation or generic rejection. |
| FTP prompt dismissal | `ftp-prompt`, `ftp-dismiss` | Mark an eligible breakthrough as viewed. Does not accept or reject FTP; verification checks the persisted setting. |
| Weight record inspection | `weight-record` | Select one record from the authenticated member's history and preserve its original units. No weight writes. |
| Device delivery | `sync-list`, `workout-push` | Connected, supported outside-workout destinations. No delivery guarantee or provider-account management. |
| Annotations | `annotation-state`, `annotation-colors`, `edit-annotation`, `move-annotation` | User note/illness/injury/time-off types, with type-specific color validation. |
| Custom-plan naming | `custom-plans`, `custom-plan`, `rename-plan` | Naming and identity only, not Plan Builder creation or schedule edits. |
| Training-approach records | `training-approaches` | Recorded changes and plan links, optionally selected by id or timeline window. Does not infer the currently effective approach or edit eligibility. |
| Single-event edits | `event-state`, `edit-event` | Name and notes for plan-attached events. Events without a plan also allow duration/TSS, date, time, cycling discipline, and A/B/C priority. A priority requires an explicit date and server race-spacing check. No multi-stage leg changes. |
| Recurrence discovery | `recurring-activities`, `recurrence-state` | Member-matched series IDs, occurrence indices, and definitions within an explicit window. No creation, edits, or exception writes. |
| Recurrence-tail deletion | `delete-recurrence-tail`, `recurrence-tail-state` | Confirmed, unbounded tail deletion from a member-verified occurrence. Preview and verification windows are partial and do not limit deletion. Materialized-only anchors are refused. |
| Calendar weeks | `calendar-week`, `copy-week`, `move-week`, `delete-week` | Explicit date windows. Deletion previews separate expected deletions from manually completed entries. |

New workflow queries return selected records and the resolved session path.
Plans contain the account, inputs, selected state, and exact request. Plan summaries
include a `stateFingerprint`, a local comparison hash of the source record, not a
TrainerRoad revision or locking token. It avoids copying large plan input documents
into every preview while still detecting changes to them.

Successful writes return `submitted: true` and `verification: "required"`.
They are never retried automatically. Read-only `next` actions preserve the selected
session and relevant target or date window. A provider push uses GET upstream but
is classified as a mutation in the CLI. HTTP method alone is not an execution policy.

Recurrence-tail verification retains all inspected planned records, even when a
record no longer links to the series. Absence from the linked list is not proof
that a planned activity was deleted.

## Remaining gaps

General plan creation/update, training-approach edits, recurrence creation/editing, custom
workout authoring, weight writes, FTP detection/rejection, activity pull/upload, and
provider connection management remain unimplemented. Some routes and partial
payloads are known. Their remaining validation, identity, eligibility, or multi-write
recovery requirements are not replaced with generic JSON flags.

The `workflow-boundaries` guide tells agents how to hand these tasks back to the
TrainerRoad app and resume with a read-only verification step.

## Source families

The static sources are hosted under TrainerRoad's
[browser asset directory](https://cdn-prod-www-01.trainerroad.com/app/assets/generated/react/index-itfpmhx4.js).
Relevant build files include `calendar-mutation-manager-nhk9hkjm.js`,
`athlete-data-e8vhbgx8.js`, `survey.api-hwcu2kt8.js`, `edit-survey-mrmpalo4.js`,
`ai-ftp-detection.service-o301xvoq.js`, `workout-details-49rbdhdm.js`,
`use-annotation-flow-view-model-dfz907t1.js`, `calendar-k861i5ew.js`, and
`container.provider-dl1beg4n.js`. Training-approach selection rules come from
`edit-training-approach-flow-fsvkh5fo.js`. Event priority rules come from
`race-priority-nyvezth0.js`. Recurrence definitions come from
`recurrence-form-gm5izv44.js` and `recurring-activity.viewmodel-clm7p1kq.js`.
FTP dismissal follows `ai-ftp-detection.service-o301xvoq.js`, `member-gd6j5htd.js`,
and `membersettings.api-m0qrb0zm.js`.
These filenames identify the inspected build.
TrainerRoad can replace them and change the private API without notice.
