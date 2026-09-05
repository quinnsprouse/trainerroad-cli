---
topic: athlete-feedback
title: Submit feedback and handle pending FTP
brief: Obtain the user's survey answers, accept a pending FTP value, or dismiss a breakthrough prompt without changing FTP.
---

# Submit feedback and handle pending FTP

Use the same `--session-file` for discovery, preview, confirmation, and verification.
Read `past --details` for completed activity IDs or `survey-pending` for the account's
pending survey. These IDs are different from planned activities and workout library IDs.

Read `survey-options --id <completed-id>`. Option rows have an `id` and an `elementId`.
A child row's `parentId` points to its root row's `id`. Submission takes the root and
child **element IDs**, resolved from this activity's current options. Do not use an
option's numeric kind, a remembered option ID, or the row ID as an element ID.

Obtain the user's answer before constructing a submission. Do not infer how a ride
felt from power, workout completion, an earlier answer, or the predicted difficulty.
Use `describe --command survey-submit --json` for the flags. Supply `--root-id` and
`--reason-ids` explicitly. Use `--reason-ids none` only when the selected answer needs
no reason. Reason IDs are comma-separated, belong to the same root, and cannot repeat.
The maximum is three; DidNotStruggle cannot accompany other reasons.

`--rpe` is optional. It accepts the user's quarter-step rating from 1 to 5 and must
match the root rating when rounded down. Explicit slider RPE requires the account's
PostWorkoutSlider feature. Ordinary answers work without it and send null RPE.
Multiple reasons and pass factors require PostWorkoutSlider and MultiReasonSlider.
Other requires the user's text in `--text`; unrelated answers cannot carry feedback text.
No arbitrary JSON payload is accepted.

Preview `survey-submit` with `--dry-run`, inspect the account, option labels, saved
response, resolved request, and feedback text, then obtain or use the user's existing
authorization. Follow the normal confirmation flow in `calendar-changes`. Standalone
submission always sends `deferFlushForward: false`; the CLI does not enter the browser's
post-workout ride-reconciliation flow.

After the single submission, read `survey-response --id <completed-id>` and compare the
saved root element ID, reason IDs, RPE, and text with the confirmed request. A response
can store reasons in `struggleReasonSurveyElementIds` or the singular field. Use the
nonempty array when present, otherwise the singular value. Read `survey-options` to
resolve labels. Null or different saved data does not authorize a second submission.
Read again after waiting or inspect TrainerRoad. Check `adaptation-status` and the
calendar after feedback that changes workout recommendations.

Read `ftp-status` to discover the account's current raw member-info FTP, prediction
status, and pending detection record. The browser can display an effective calendar
FTP that differs from this account value. Status codes are CanPredict, NoData,
NoRecentData, and NoActivities; status alone does not identify an acceptable record.

`ftp-accept --id <detection-record-id> --ftp <pending-value>` only accepts a record
verified in the authenticated member's timeline `pendingAiFtpChange`. It requires the
explicit pending value. Never substitute member ID, planned activity ID, workout ID,
or an FTP number in the detection ID flag. The supported pending sources are current
prediction, hard-fail, and breakthrough. Detection creation, mid-phase acceptance,
and rejection workflows are not implemented here.

Inspect the acceptance preview, submit once, then reread `ftp-status`. Compare the
account FTP to the authorized value and verify the pending record has cleared.
Read `ftp` for history and `adaptation-status` for recalculation. An HTTP acknowledgement
is not proof that the change and its calendar effects are complete. On an uncertain
write, follow the suggested reads before deciding whether another request is needed.

## Dismiss a breakthrough prompt without changing FTP

Read `ftp-prompt` with the selected session. Inspect `pending`, `viewedPredictionId`,
`canDismiss`, and `reason`. Dismissal marks the breakthrough as viewed. It neither
accepts nor rejects the proposed FTP, and it does not start a new detection.

If the user wants to hide that prompt, preview `ftp-dismiss --id <pending-id>`.
The preview must contain only the `viewedPredictionId` settings write for that
record. Do not use dismissal as a substitute for accepting or rejecting FTP.
An outstanding survey needs the user's answers before this flow becomes available.

After confirmation, follow the returned `ftp-prompt` read. Verify that
`viewedPredictionId` matches the confirmed ID and the account FTP is unchanged.
The pending record may remain after successful dismissal. Do not repeat the
write to try to remove it. On an uncertain response, perform the same read before
deciding whether another attempt is appropriate.
