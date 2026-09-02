# Unofficial TrainerRoad CLI

> Unofficial tool. Not affiliated with or endorsed by TrainerRoad.

CLI to fetch TrainerRoad data for your account, including:

- future workouts
- past/completed workouts
- today view
- events and annotations
- progression levels
- plans and phases
- FTP and FTP prediction
- power ranking and power records
- weight history

It can also perform a small set of verified calendar writes for planned workouts:

- search the workout library by zone/profile/search text/duration/level
- fetch AI suggested workouts from TrainNow
- recommend library workouts against target duration/level/TSS
- fetch workout-library details by workout ID
- add a library workout to a calendar date
- copy an existing planned workout to another date
- move a planned workout to a new date
- list TrainerRoad alternate workout options
- replace a workout with a specific alternate
- switch a workout between inside and outside
- add and remove calendar annotations: time off, illness, injury, notes
- save a workout's power-profile chart as PNG or SVG

## Agent-Friendly Behavior

- Non-interactive by default. Inputs are flags or stdin, not prompts.
- Progressive disclosure. Use `trainerroad-cli help <command>` or `trainerroad-cli discover`.
- Command help includes concrete examples and flag descriptions.
- Write commands support `--dry-run` previews.
- Common retry cases are idempotent no-ops instead of duplicate calendar writes.
- Every write returns `before`/`after` (or the created record) so the caller can verify without a second call.

## How TrainerRoad Reacts To Calendar Changes

TrainerRoad's Adaptive Training treats the calendar as input. Agents managing an athlete's plan should expect:

- Removing or skipping a planned workout can cause TrainerRoad to rebuild the upcoming plan around the gap.
- Adding a workout, or marking time off, illness, or injury, can likewise shift the surrounding planned workouts.
- Planned workouts carry `recommendationReason`, `adaptationLocked`, and `adaptationAltered` fields that show whether TrainerRoad chose or altered them.
- After any write, re-read `future --days 14 --details` before deciding the next step. Do not assume the calendar looks the way it did before the write.

Write commands echo this in an `adaptiveTraining` field so it is visible in machine-readable output.

## Reading The Athlete's Situation

A useful order for an agent building a picture of how training is going:

1. `whoami` for FTP, weight, and timezone.
2. `plan --view current` for the plan, its phases, and the phase the athlete is in today.
3. `past --days 28 --details` and `future --days 14 --details` for what happened and what is scheduled.
4. `levels` for progression levels by zone, and `ftp-prediction` for where FTP is heading.
5. `annotations --from <date>` for time off, illness, and injury, and `annotation-details --id` for the notes behind them.
6. `events` for upcoming races.
7. `workout-image --id <workout-id>` when a picture of a workout's intervals helps explain it.

## Install

### Run without install (npx)

```bash
npx --yes trainerroad-cli help
```

### Global install

```bash
npm install -g trainerroad-cli
trainerroad-cli help
```

### Local project install

```bash
npm install trainerroad-cli
npx trainerroad-cli help
```

### Local development (from source)

```bash
git clone https://github.com/quinnsprouse/trainerroad-cli.git
cd trainerroad-cli
npm install
npm run help
```

## Quickstart

1. Authenticate

```bash
trainerroad-cli login --username <username> --password-stdin
```

2. Query data

```bash
trainerroad-cli whoami --json
trainerroad-cli today --json
trainerroad-cli future --days 30 --json
trainerroad-cli past --days 30 --json
trainerroad-cli plan --view current --json
trainerroad-cli levels --json
trainerroad-cli ftp --json
trainerroad-cli today --tz America/New_York --json
trainerroad-cli train-now --duration 60 --json
trainerroad-cli workout-library --zone "Endurance" --profile "Sustained Power" --min-duration 45 --max-duration 75 --json
trainerroad-cli workout-recommend --zone "Endurance" --profile "Sustained Power" --target-duration 60 --target-level 1.0 --count 3 --json
trainerroad-cli workout-details --id 18128 --include-chart --json
trainerroad-cli add-workout --workout-id 18128 --date 2026-03-16 --json
trainerroad-cli add-workout --workout-id 18128 --date 2026-03-16 --dry-run
trainerroad-cli copy-workout --id <planned-activity-id> --date 2026-03-16 --json
```

3. Mutate planned workouts

First get a planned workout ID from `future --details`:

```bash
trainerroad-cli future --days 14 --details --json
```

Then use that planned activity ID:

```bash
trainerroad-cli workout-alternates --id <planned-activity-id> --category easier --json
trainerroad-cli move-workout --id <planned-activity-id> --to 2026-03-13 --dry-run
trainerroad-cli move-workout --id <planned-activity-id> --to 2026-03-13 --json
trainerroad-cli replace-workout --id <planned-activity-id> --alternate-id <workout-id> --json
trainerroad-cli switch-workout --id <planned-activity-id> --mode outside --json
trainerroad-cli copy-workout --id <planned-activity-id> --date 2026-03-16 --json
```

`copy-workout` is the reliable way to place an existing planned workout on another date.
`add-workout` exists, but TrainerRoad's add endpoints are still inconsistent and may fail even after retry/reconciliation.

4. Annotations and images

```bash
trainerroad-cli add-annotation --type time-off --date 2026-09-21 --days 3 --title "Travel" --dry-run
trainerroad-cli add-annotation --type illness --date 2026-09-21 --end-date 2026-09-23 --notes "Head cold" --json
trainerroad-cli annotation-details --id <annotation-id> --json
trainerroad-cli remove-annotation --id <annotation-id> --json
trainerroad-cli workout-image --id 1592808 --file fishers.png
trainerroad-cli workout-image --id 1592808 --format svg --file fishers.svg
```

PNG output uses the optional `@resvg/resvg-js` package. If it is not installed, use `--format svg`.

5. Discover all commands

```bash
trainerroad-cli help
trainerroad-cli help future --json
trainerroad-cli discover --level 3 --json
```

## Modes

- `private` (authenticated): full account data
- `public` (username-based): limited day-level data

Use `--target <username>` and/or `--public` for public mode queries.

## Output

- default: pretty JSON
- `--json`: structured JSON
- `--jsonl`: one record per line
- `--fields a,b,c`: project record fields
- `--records-only`: lighter record payloads
- `--tz <IANA timezone>`: localize day boundaries/timestamps (defaults to `TR_TIMEZONE` or system timezone)

## Help

```bash
trainerroad-cli help
trainerroad-cli help future
trainerroad-cli future --help
trainerroad-cli help move-workout --json
```

## Security

- Session cookies are stored in `.trainerroad/session.json`.
- Treat this file as sensitive and do not commit it.
