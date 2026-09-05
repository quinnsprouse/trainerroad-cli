# Migrate from 0.4 to 0.5

Version 0.5 replaces the original parser and command manifest with Lasso contracts.
The TrainerRoad operations remain available, but flags, responses, and write behavior change.
There is no parallel trial binary.

## Update invocations

| Before | Now |
| --- | --- |
| `help`, `help <command>` | `--help`, `<command> --help` |
| `discover`, `capabilities` | `describe --json`, `describe --command <command> --json` |
| `--jsonl` | `--format ndjson` |
| `--records-only` | Read `data.items`, or use NDJSON item events |
| `--output file.json` | Redirect stdout to the file |
| `workout-image --format svg` | `workout-image --image-format svg` |
| `login --password ...` | `TR_PASSWORD` or `--password-stdin` |
| Unconfirmed write | Inspect the plan, then use `confirmation.confirmArgs` |

Use `--yes` when the user has already authorized the exact change.
This requirement also applies to login, logout, and chart export.
Do not combine `--dry-run` with `--yes` or `--confirm`.

## Update response handling

Successful JSON responses wrap command data in `{ schemaVersion: "1", status: "ok", data, warnings, next, guides }`.
Errors have `status: "error"` and an `error` object with a stable code and recovery action.
Do not infer success from valid JSON alone.

Collection rows are in `data.items`, not `records`.
Declared top-level columns are projectable. Each full item has a `source` field containing its retained record.
Unknown upstream fields do not become new projectable columns automatically.
`--fields` no longer accepts arbitrary nested paths.
Projection returns only `{ items, count }`. Without projection, command metadata remains in `data`.

NDJSON item events use `{ event: "item", data: ... }`.
Wait for a terminal `summary`, `confirmation_required`, or `error` event.
Fetch `schema --json` from the same binary version to validate envelopes and command data.

Confirmation requests exit 4. Usage errors exit 64, authentication errors 77, and uncertain writes 73.
`describe --json` lists the complete exit and error catalogs.
After an interrupted write, inspect the calendar even if the error says it is transient.

## Check behavior changes

- Mandatory flags are rejected before account access and marked required in discovery.
- Calendar writes do not fall back to another write endpoint after an ambiguous response.
- Apply rechecks the account and affected state. Confirmation is not a server transaction or a durable idempotency key.
- Image export refuses existing destinations and binds the chart content to its plan.
- Login reads credentials only during apply. Session files are saved with owner-only permissions.
- Dates and numeric flags receive stricter validation. Boolean choices such as `--outside` use `true` or `false`.
- The Node.js minimum is 22.19. The published commands run the bundled `dist/bin.cjs`, not the source modules.

## Handle additional workflow commands

Browser-derived workflow queries return `data.records`, with the authenticated
`data.member` and resolved `data.sessionFile`. Their mutation plans include
`before` and the exact `request`. Do not treat these records as the retained
collection commands' `data.items` format. Fetch `schema --json` for the contract
of the specific command.

Their successful mutations report `submitted: true` and `verification: "required"`.
They do not report verified completion. Follow the returned read-only `next`
commands and compare the saved state with the confirmed request. Cancellation
during a dispatched workflow write produces non-retryable `cannot_write`, with
the same read-only recovery as a lost response.

`edit-event` preserves omitted fields. Events without a plan support named date,
time, discipline, and priority changes. Setting A priority requires an explicit
`--date` for the race-spacing check. Date edits return verification commands with
both affected dates. Plan-attached events still allow only name and notes.

Use `recurring-activities` and `recurrence-state` with an explicit date window to
discover recurring entries. These are read-only and do not replace the app's
series editor. `training-approaches` returns recorded changes without inferring
which one is currently effective or editable.

`delete-recurrence-tail` deletes from the selected occurrence onward, with no end
date. Its required `--verify-through` flag limits reads, not deletion. Confirm
that scope, then follow `recurrence-tail-state`, which accepts expected absence
and includes materialized and completed snapshots. Read `recurrence-changes`
before using this workflow. It is not a substitute for a one-occurrence edit.
