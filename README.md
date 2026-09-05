# Unofficial TrainerRoad CLI

Read TrainerRoad training data and make confirmed calendar changes from a terminal or agent.
This project is not affiliated with or endorsed by TrainerRoad.

Version 0.5 replaces the previous CLI with Lasso's command contracts, structured errors, confirmation plans, and offline guides.
It is a breaking migration. Read [MIGRATION.md](MIGRATION.md) before updating scripts.

## Run from source

Requires Node.js 22.19 or later.

```sh
npm ci
npm run build
node bin/trainerroad-cli.mjs describe --json
```

The package installs both `trainerroad-cli` and `trcli`. Both run the same binary.
After installing this version, start with:

```sh
trainerroad-cli --help
trainerroad-cli describe --command future --json
trainerroad-cli schema --json
```

The generated command inventory is the reference for flags, required inputs, output schemas, and error codes.

## Authenticate

Login writes a local session file, so it requires confirmation like other mutations.
Set `TR_USERNAME` and `TR_PASSWORD` through your secret manager, then run:

```sh
trainerroad-cli login --yes --json
trainerroad-cli whoami --json
```

Alternatively, provide `--username` and pipe one password line to `login --password-stdin --yes`.
Do not put a password in argv. Login previews never read the password.

Sessions default to `.trainerroad/session.json` in the working directory.
`--session-file` overrides `TR_SESSION_FILE`. Keep that path consistent across commands.
Session files contain credentials. Do not print or commit them.
`logout` removes the selected local file after confirmation. It does not revoke other sessions.

## Read training data

```sh
trainerroad-cli plan --view current --json
trainerroad-cli past --days 28 --details --json
trainerroad-cli future --days 14 --details --json
trainerroad-cli levels --json
trainerroad-cli events --json
trainerroad-cli annotations --json
trainerroad-cli workout-library --search endurance --limit 10 --json
```

Other commands cover FTP, AI FTP status, power records, weight history, TrainNow suggestions, workout recommendations, and detailed records.
Public-profile reads remain available on commands that declare `--target` and `--public`.

Dates use `YYYY-MM-DD`. Date bounds are inclusive.
Relative windows use `--tz`, then `TR_TIMEZONE`, then the system timezone.
Pass explicit bounds when a repeated read must use the same window.

## Preview and apply a calendar change

```sh
trainerroad-cli guide get calendar-changes --json
trainerroad-cli move-workout --id planned-123 --to 2026-09-12 --json
```

The second command returns `confirmation_required`, a plan, and `confirmation.confirmArgs`, then exits with code 4 without writing.
Inspect the account and change in the plan. Invoke this binary with the returned argv to confirm it.

`--dry-run` returns a plan with exit code 0. `--yes` applies after validation without a separate confirmation.
Use `--yes` only for an authorized change.
Calendar operations include add, copy, move, replace, switch, and remove workouts, plus event and annotation changes.

TrainerRoad can adapt nearby workouts after calendar changes. Follow the returned `next` action to inspect the calendar.
Confirmation checks cannot prevent another client from changing state between the last read and the write.
If a write fails or is interrupted, read the calendar before retrying.

## Run agent workflows

Additional browser-derived commands cover planned-activity state, annotation edits,
calendar weeks, single-event edits, plan naming, workout surveys, device delivery,
and recurrence and training-approach discovery. Discover the
commands available in this build with `describe --json`. These commands are marked
`experimental`: their API contracts were recovered from TrainerRoad's public
JavaScript and tested with fixtures, not exercised against a live account.

Each workflow has named inputs, a preview tied to the account and current records,
and a read-only verification step. The new mutation results use `submitted: true`
and `verification: "required"`. Acknowledgement does not prove that adaptation or
device delivery finished. Follow `next`, inspect the result, and never poll by
repeating a write. A disconnected provider or missing API field is a reason to
stop, not guess another endpoint.

Read the relevant topic from `guide list`. Guides explain which IDs to use,
which answers must come from the user, and where a task still requires the
TrainerRoad app. [Workflow coverage](docs/workflow-coverage.md) lists the boundaries.

## Export a chart

```sh
trainerroad-cli workout-image --id 18128 --file workout.svg --dry-run --json
```

Chart exports are file mutations. Confirm the plan to create the file.
Use `--image-format png` for PNG, which requires the optional `@resvg/resvg-js` dependency.
Exports never overwrite an existing file.

## Machine output

Non-terminal stdout defaults to JSON. Use `--json`, `--format ndjson`, or `--format text` explicitly.
`TRAINERROAD_FORMAT` supplies the default when no format flag is present.

Every terminal response carries `next` and `guides`. JSON envelopes also carry `schemaVersion`.
Errors include `code`, `message`, `fix`, and `transient`.
Collection commands return `data.items`; `--fields id,date` selects declared columns.
Each unprojected item includes `source` with the retained TrainerRoad record.
NDJSON emits items followed by one terminal event. Progress and warnings are not terminal results.

Use `guide list` and `guide get <topic>` for version-matched task context without network access.
The packaged [agent skill](skills/trainerroad-cli/SKILL.md) routes agents to those commands.

## Develop

Read [AGENTS.md](AGENTS.md) for boundaries and verification.
`npm run check:push` runs offline tests and the package smoke test.
[API notes](docs/api-notes.md) record the TrainerRoad behavior that the retained client implements.
The contract runtime comes from Lasso and retains its [MIT notice](LASSO-LICENSE).
