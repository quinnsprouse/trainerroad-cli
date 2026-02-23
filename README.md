# Unofficial TrainerRoad CLI (reverse-engineered)

> Unofficial tool. Not affiliated with or endorsed by TrainerRoad.

This project supports two profile access modes:

- `private` (authenticated): full workout/activity detail
- `public` (username-based): day-level training load/plan signals

## What was confirmed

- Login is form-based at `POST /app/login` with `application/x-www-form-urlencoded`.
- Login page exposes a required hidden anti-forgery token: `__RequestVerificationToken`.
- Successful login sets `SharedTrainerRoadAuth` cookie.
- Session auth is cookie-based (not bearer-token based from localStorage).
- Private core data endpoint:
  - `GET /app/api/react-calendar/{memberId}/timeline`
- Detail endpoints that require `ids` request header:
  - `GET /app/api/react-calendar/{memberId}/activities`
  - `GET /app/api/react-calendar/{memberId}/planned-activities`
  - `GET /app/api/react-calendar/{memberId}/personal-records`
- Public endpoint:
  - `GET /app/api/tss/{username}`
- Additional private performance endpoints:
  - `GET /app/api/career/{memberId}/levels`
  - `GET /app/api/career/{username}/new`
  - `GET /app/api/ai-ftp-detection/can-use-ai-ftp/{memberId}`
  - `GET /app/api/calendar/aiftp/{memberId}/ai-failure-status`
  - `GET /app/api/onboarding/power-ranking?memberId={memberId}`
  - `POST /app/api/personal-records/for-date-range/{memberId}?rowType=...&indoorOnly=...`

## Install

### One-off via npx (after npm publish, recommended)

```bash
npx --yes trainerroad-cli@latest help
```

### Global install

```bash
npm install -g trainerroad-cli
trainerroad-cli help
```

### From GitHub (before npm publish)

```bash
npx --yes github:quinnsprouse/trainerroad-cli help
npm install -g github:quinnsprouse/trainerroad-cli
trainerroad-cli help
```

### Local development

```bash
git clone https://github.com/quinnsprouse/trainerroad-cli.git
cd trainerroad-cli
npm install
npx --yes node src/cli.mjs help
```

## Help menu

```bash
trainerroad-cli help
trainerroad-cli help future
trainerroad-cli past --help
```

## Authenticate

```bash
trainerroad-cli login --username quinnsprouse --password 'your-password' --return-path /app/career/quinnsprouse
```

Session cookies are stored in `.trainerroad/session.json`.

Auth behavior:

- No browser window is opened by default.
- CLI performs direct HTTP form login with anti-forgery token handling.
- You can avoid putting passwords in shell history with:

```bash
printf '%s' 'your-password' | trainerroad-cli login --username quinnsprouse --password-stdin
```

## Query commands

```bash
trainerroad-cli whoami
trainerroad-cli discover --level 1
trainerroad-cli discover --level 3 --json
trainerroad-cli timeline
trainerroad-cli timeline --target quinnsprouse --public
trainerroad-cli events
trainerroad-cli annotations
trainerroad-cli levels
trainerroad-cli plan
trainerroad-cli weight-history
trainerroad-cli today
trainerroad-cli today --target quinnsprouse --public
trainerroad-cli future --days 60
trainerroad-cli future --target quinnsprouse --public --days 60
trainerroad-cli future --days 60 --details
trainerroad-cli past --days 60 --limit 30
trainerroad-cli past --target quinnsprouse --public --days 60 --limit 30
trainerroad-cli past --days 60 --limit 30 --details
trainerroad-cli ftp
trainerroad-cli ftp --target quinnsprouse --public
trainerroad-cli ftp-prediction
trainerroad-cli power-ranking
trainerroad-cli power-records --start-date 2025-01-01 --end-date 2026-02-23 --limit 25
trainerroad-cli capabilities
```

Profile mode selection rules:

- If logged in and no `--target` is provided, commands use `private` mode.
- If `--target` is provided and differs from logged-in user, commands use `public` mode.
- `--public` forces public mode even when authenticated.

Output formats:

- default JSON
- `--json` for structured JSON object
- `--jsonl` for one JSON record per line (agent-friendly)
- `--output <path>` to write output to a file
- `--fields a,b,c` to project `records` fields (filterable commands)

Progressive disclosure for agents:

- `discover --level 1`: high-level command map
- `discover --level 2`: command usage expansion
- `discover --level 3`: full filter/pattern guidance
- `help <command> --json`: machine-readable command help

Examples:

```bash
trainerroad-cli future --days 30 --details --json
trainerroad-cli future --from 2026-03-01 --to 2026-03-31 --min-tss 60 --sort tss-desc --result-limit 10 --json
trainerroad-cli past --days 90 --limit 100 --jsonl
trainerroad-cli past --days 120 --details --type 1 --contains threshold --fields id,name,started,tss --json
trainerroad-cli today --details --json
trainerroad-cli today --date 2026-02-24 --type planned --fields recordType,name,tss --json
trainerroad-cli past --days 365 --details --contains seneca --fields id,name,started,tss --records-only --json
trainerroad-cli events --from 2026-01-01 --to 2026-12-31 --fields id,name,dateOnly,racePriority --json
trainerroad-cli annotations --from 2026-01-01 --fields id,typeLabel,dateOnly,durationDays --json
trainerroad-cli levels --fields zoneLabel,recentLevel,aiProjectedDisplayLevel,aiDelta --json
trainerroad-cli plan --view phases --fields planName,start,end --json
trainerroad-cli weight-history --from 2025-01-01 --sort date-desc --json
trainerroad-cli timeline --target quinnsprouse --public --json
trainerroad-cli ftp --json
trainerroad-cli ftp-prediction --json
trainerroad-cli power-ranking --jsonl
trainerroad-cli power-records --full --json
```

Filter options on `future`, `past`, `today`, `events`, `annotations`, `levels`, `plan`, `weight-history`:

- `--from YYYY-MM-DD`, `--to YYYY-MM-DD`
- `--type <csv>`
- `--contains <text>`
- `--min-tss <n>`, `--max-tss <n>`
- `--sort date|date-desc|tss|tss-desc|name|name-desc`
- `--result-limit <n>`
- `--fields a,b,c`
- `--records-only`

`ftp-prediction` now emits a card-style model in private mode:

- `currentFtp`
- `predictedFtp`
- `predictionDate` / `predictionDateOnly`
- `daysUntilPrediction`
- `ftpDelta` / `ftpDeltaPercent`
- `plannedWorkoutCount` (planned workouts between today and prediction date)

Public mode limitations:

- No workout-level detail (name, duration, interval structure) for another user via public endpoints.
- Public mode returns day-level fields like:
  - `tss`
  - `plannedTssTotal`
  - `hasRides`
- Public mode can include FTP history points via `ftpRecordsDate`.
- AI FTP detection, progression levels, and power ranking/record endpoints require private auth.

## Notes

- This is an unofficial reverse-engineered client and can break if TrainerRoad changes API contracts.
- This project is not affiliated with or endorsed by TrainerRoad.
- Treat `.trainerroad/session.json` as sensitive (contains auth cookies).
