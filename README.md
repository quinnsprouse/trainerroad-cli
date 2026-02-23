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
```

3. Discover all commands

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

## Security

- Session cookies are stored in `.trainerroad/session.json`.
- Treat this file as sensitive and do not commit it.
