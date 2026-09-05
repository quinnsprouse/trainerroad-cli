---
topic: workout-delivery
title: Deliver an outside workout to a connected device
brief: Discover connection types and exact library IDs, preview one push, and verify on the provider or device.
---

# Deliver an outside workout to a connected device

Read `sync-list` with the intended `--session-file`. It returns only connection type
and provider name. Tokens, credentials, URLs, and unknown connection fields are omitted.
Presence in the connection list does not prove that credentials are still usable.

Read `workout-library` and choose the user's requested outside workout. The push ID
is the outside workout's library ID. It is not a completed ride ID or a planned
calendar activity ID. The preview reads workout details and checks the exact ID
against the returned workout or alternate. It refuses inside workouts and never
substitutes an alternate's different ID.

Use `describe --command workout-push --json`, then preview the selected ID and explicit
`--provider` with `--dry-run`. Supported destinations in this flow are garmin, wahoo,
hammerhead, and coros. Coros additionally requires the account's Coros role. Other
providers can appear in `sync-list` without supporting this push workflow.

Request delivery only with the user's intent to send that workout to that device.
Use the confirmation flow described in `calendar-changes`. Apply checks the current
workout, connections, and relevant role against the preview before dispatching once.

TrainerRoad's push route uses GET but changes state. The CLI treats it as a mutation,
requires confirmation, and does not use it for discovery, polling, or verification.
The acknowledgement does not prove that the provider or device received the workout.

After submission, follow `sync-list` to reread connection availability and inspect the
provider or device for the requested workout. There is no verified delivery-status
endpoint for this library-workout push. A connection still being present, a successful
HTTP response, or an unchanged workout-detail read is not delivery confirmation.
Do not push again merely because the device has not updated yet. If the request fails
or is interrupted, it may already have been processed; inspect the provider before
considering another authorized attempt.

Activity import/pull and completed-ride upload are separate workflows. This command
does not implement them and does not connect or disconnect provider accounts.
