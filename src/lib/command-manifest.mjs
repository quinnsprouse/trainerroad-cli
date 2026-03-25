export const COMMANDS = {
  help: {
    summary: "Show global help or command help.",
    usage: [
      "trainerroad-cli help",
      "trainerroad-cli help <command>",
      "trainerroad-cli <command> --help",
    ],
    examples: [
      "trainerroad-cli help future",
      "trainerroad-cli help future --json",
    ],
  },
  discover: {
    summary: "Agent-oriented command discovery with progressive disclosure levels.",
    usage: [
      "trainerroad-cli discover",
      "trainerroad-cli discover --level 1|2|3 [--json]",
      "trainerroad-cli discover --command future --level 3 --json",
    ],
    examples: [
      "trainerroad-cli discover --level 1",
      "trainerroad-cli discover --command workout-library --level 3 --json",
    ],
  },
  capabilities: {
    summary: "Show supported auth/data capabilities (private + public modes).",
    usage: ["trainerroad-cli capabilities [--json]"],
    examples: ["trainerroad-cli capabilities --json"],
  },
  login: {
    summary: "Authenticate and persist cookie session for private data access.",
    usage: [
      "trainerroad-cli login --username <username> --password <password> [--return-path /app/career/<username>]",
      "trainerroad-cli login --username <username> --password-stdin",
    ],
    examples: [
      "trainerroad-cli login --username quinnsprouse --password-stdin",
      "TR_PASSWORD='<password>' trainerroad-cli login --username quinnsprouse",
    ],
  },
  whoami: {
    summary: "Fetch authenticated member profile info (`/app/api/member-info`).",
    usage: ["trainerroad-cli whoami [--json]"],
    examples: ["trainerroad-cli whoami --json"],
  },
  timeline: {
    summary: "Get profile summary (private full timeline or public TSS-derived summary).",
    usage: [
      "trainerroad-cli timeline [--target <username>] [--public] [--full] [--json]",
    ],
    examples: [
      "trainerroad-cli timeline --json",
      "trainerroad-cli timeline --target quinnsprouse --public --json",
    ],
  },
  "train-now": {
    summary: "Fetch TrainerRoad AI suggested workouts (TrainNow) for a target duration (private mode).",
    usage: [
      "trainerroad-cli train-now [--duration <minutes>] [--num-suggestions <count>] [--category climbing|endurance|attacking] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli train-now --duration 60 --json",
      "trainerroad-cli train-now --duration 90 --category endurance --json",
    ],
  },
  events: {
    summary: "Show calendar events/races from timeline (private mode).",
    usage: [
      "trainerroad-cli events [--full] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--type <value>] [--contains <text>] [--min-tss <number>] [--max-tss <number>] [--sort date|date-desc|name|name-desc|tss|tss-desc] [--result-limit <count>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli events --from 2026-03-01 --to 2026-03-31 --json",
      "trainerroad-cli events --contains gravel --sort date --result-limit 10 --json",
    ],
  },
  annotations: {
    summary: "Show timeline annotations (time off, notes, illness/injury markers) (private mode).",
    usage: [
      "trainerroad-cli annotations [--full] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--type <value>] [--contains <text>] [--sort date|date-desc|name|name-desc] [--result-limit <count>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli annotations --from 2026-01-01 --json",
      "trainerroad-cli annotations --contains injury --sort date-desc --json",
    ],
  },
  levels: {
    summary: "Show progression levels by zone (private mode).",
    usage: [
      "trainerroad-cli levels [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--type <zone|progressionId>] [--contains <text>] [--sort name|name-desc|date|date-desc] [--result-limit <count>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli levels --json",
      "trainerroad-cli levels --type endurance --json",
    ],
  },
  plan: {
    summary: "Show training plan data (current plan, phases, or all plans) (private mode).",
    usage: [
      "trainerroad-cli plan [--view current|phases|plans] [--full] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--type <value>] [--contains <text>] [--sort date|date-desc|name|name-desc] [--result-limit <count>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli plan --view current --json",
      "trainerroad-cli plan --view phases --json",
    ],
  },
  "weight-history": {
    summary: "Show historical body-weight entries (private mode).",
    usage: [
      "trainerroad-cli weight-history [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--contains <text>] [--sort date|date-desc] [--result-limit <count>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli weight-history --json",
      "trainerroad-cli weight-history --from 2026-01-01 --sort date-desc --json",
    ],
  },
  today: {
    summary: "Show today's planned/completed activity for private or public profile mode.",
    usage: [
      "trainerroad-cli today [--date YYYY-MM-DD] [--target <username>] [--public] [--details] [--type <value>] [--contains <text>] [--min-tss <number>] [--max-tss <number>] [--sort date|date-desc|tss|tss-desc] [--result-limit <count>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli today --json",
      "trainerroad-cli today --target quinnsprouse --public --tz America/New_York --json",
    ],
  },
  future: {
    summary: "Show future plan data for private or public profile mode.",
    usage: [
      "trainerroad-cli future [--days <count>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--target <username>] [--public] [--details] [--type <value>] [--contains <text>] [--min-tss <number>] [--max-tss <number>] [--sort date|date-desc|tss|tss-desc] [--result-limit <count>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli future --days 30 --json",
      "trainerroad-cli future --from 2026-03-01 --to 2026-03-31 --fields id,title,tss,date --json",
    ],
  },
  past: {
    summary: "Show past activity data for private or public profile mode.",
    usage: [
      "trainerroad-cli past [--days <count>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <count>] [--target <username>] [--public] [--details] [--type <value>] [--contains <text>] [--min-tss <number>] [--max-tss <number>] [--sort date|date-desc|tss|tss-desc] [--result-limit <count>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli past --days 30 --json",
      "trainerroad-cli past --days 90 --min-tss 80 --sort tss-desc --result-limit 20 --jsonl",
    ],
  },
  ftp: {
    summary: "Show FTP snapshot and FTP history (private or public mode).",
    usage: [
      "trainerroad-cli ftp [--target <username>] [--public] [--history-limit <count>] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli ftp --json",
      "trainerroad-cli ftp --target quinnsprouse --public --history-limit 12 --json",
    ],
  },
  "ftp-prediction": {
    summary: "Show AI FTP detection eligibility/status and progression impact (private mode).",
    usage: ["trainerroad-cli ftp-prediction [--json]"],
    examples: ["trainerroad-cli ftp-prediction --json"],
  },
  "power-ranking": {
    summary: "Show best-power percentile ranking by duration (private mode).",
    usage: ["trainerroad-cli power-ranking [--json|--jsonl]"],
    examples: ["trainerroad-cli power-ranking --json"],
  },
  "power-records": {
    summary: "Show date-range personal power records from TrainerRoad PR endpoint (private mode).",
    usage: [
      "trainerroad-cli power-records [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--row-type 100|101] [--indoor-only true|false] [--limit <count>] [--full] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli power-records --start-date 2026-01-01 --end-date 2026-03-01 --json",
      "trainerroad-cli power-records --row-type 101 --indoor-only true --limit 20 --jsonl",
    ],
  },
  "workout-library": {
    summary: "Search the TrainerRoad workout library with agent-friendly filters (private mode).",
    usage: [
      "trainerroad-cli workout-library [--search <text>] [--zone <name>|--zone-id <id>] [--profile <name>|--profile-id <id>] [--outside true|false] [--has-instructions true|false] [--min-duration <minutes>] [--max-duration <minutes>] [--min-tss <number>] [--max-tss <number>] [--min-level <number>] [--max-level <number>] [--sort level|level-desc|duration|duration-desc|tss|tss-desc|name|name-desc] [--limit <count>] [--page-size <count>] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli workout-library --zone Endurance --profile \"Sustained Power\" --min-duration 45 --max-duration 75 --json",
      "trainerroad-cli workout-library --search Baxter --limit 5 --json",
    ],
  },
  "workout-recommend": {
    summary: "Recommend library workouts by ranking candidates against target duration/level/TSS (private mode).",
    usage: [
      "trainerroad-cli workout-recommend [--search <text>] [--zone <name>|--zone-id <id>] [--profile <name>|--profile-id <id>] [--outside true|false] [--has-instructions true|false] [--min-duration <minutes>] [--max-duration <minutes>] [--min-tss <number>] [--max-tss <number>] [--min-level <number>] [--max-level <number>] [--target-duration <minutes>] [--target-tss <number>] [--target-level <number>] [--count <count>] [--candidate-limit <count>] [--page-size <count>] [--sort level|level-desc|duration|duration-desc|tss|tss-desc|name|name-desc] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli workout-recommend --zone Endurance --profile \"Sustained Power\" --target-duration 60 --target-level 1.0 --count 3 --json",
      "trainerroad-cli workout-recommend --search threshold --target-duration 90 --count 5 --json",
    ],
  },
  "workout-details": {
    summary: "Fetch detailed workout-library metadata for a workout ID (private mode).",
    usage: [
      "trainerroad-cli workout-details --id <workout-id> [--include-chart true|false] [--chart-point-limit <count>] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli workout-details --id 18128 --json",
      "trainerroad-cli workout-details --id 18128 --include-chart --chart-point-limit 50 --json",
    ],
  },
  "add-workout": {
    summary: "Add a library workout to the calendar on a target date (private mode; reconciles flaky API responses).",
    usage: [
      "trainerroad-cli add-workout --workout-id <workout-id> --date YYYY-MM-DD [--outside true|false] [--dry-run] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli add-workout --workout-id 18128 --date 2026-03-16 --dry-run",
      "trainerroad-cli add-workout --workout-id 18128 --date 2026-03-16 --json",
    ],
  },
  "copy-workout": {
    summary: "Copy an existing planned workout to another date (private mode).",
    usage: [
      "trainerroad-cli copy-workout --id <planned-activity-id> --date YYYY-MM-DD [--dry-run] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli copy-workout --id 123456 --date 2026-03-16 --dry-run",
      "trainerroad-cli copy-workout --id 123456 --date 2026-03-16 --json",
    ],
  },
  "workout-alternates": {
    summary: "List alternate workout options for a planned workout (private mode).",
    usage: [
      "trainerroad-cli workout-alternates --id <planned-activity-id> [--category similar|easier|harder|longer|shorter] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli workout-alternates --id 123456 --json",
      "trainerroad-cli workout-alternates --id 123456 --category easier --json",
    ],
  },
  "move-workout": {
    summary: "Move a planned workout to a different date (private mode).",
    usage: [
      "trainerroad-cli move-workout --id <planned-activity-id> --to YYYY-MM-DD [--dry-run] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli move-workout --id 123456 --to 2026-03-13 --dry-run",
      "trainerroad-cli move-workout --id 123456 --to 2026-03-13 --json",
    ],
  },
  "replace-workout": {
    summary: "Replace a planned workout with a specific alternate workout ID (private mode).",
    usage: [
      "trainerroad-cli replace-workout --id <planned-activity-id> --alternate-id <workout-id> [--update-duration true|false] [--dry-run] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli replace-workout --id 123456 --alternate-id 18128 --dry-run",
      "trainerroad-cli replace-workout --id 123456 --alternate-id 18128 --json",
    ],
  },
  "switch-workout": {
    summary: "Switch a planned workout between inside and outside variants (private mode).",
    usage: [
      "trainerroad-cli switch-workout --id <planned-activity-id> --mode inside|outside [--dry-run] [--json|--jsonl]",
    ],
    examples: [
      "trainerroad-cli switch-workout --id 123456 --mode outside --dry-run",
      "trainerroad-cli switch-workout --id 123456 --mode outside --json",
    ],
  },
  logout: {
    summary: "Clear local persisted session.",
    usage: ["trainerroad-cli logout"],
    examples: ["trainerroad-cli logout"],
  },
};

export const PROJECT_NOTICE = "Unofficial tool. Not affiliated with or endorsed by TrainerRoad.";

export const GLOBAL_NOTES = [
  PROJECT_NOTICE,
  "Environment: TR_USERNAME, TR_PASSWORD, TR_SESSION_FILE, TR_TIMEZONE",
  "Non-interactive by default: pass flags or stdin; commands do not prompt.",
  "Timezone: --tz <IANA timezone> (for example America/New_York).",
  "Output modes: default JSON, --json, --jsonl, --output <path>",
  "Session file default: .trainerroad/session.json",
  "Private mode: authenticated cookie session + full workout endpoints.",
  "Public mode: username-based endpoint (`/app/api/tss/{username}`) with limited detail.",
  "Agent filters: --from --to --type --contains --min-tss --max-tss --sort --result-limit --fields",
  "Agent output: --records-only",
  "Write commands: use --dry-run to preview calendar mutations before applying them.",
];

export const AGENT_FILTER_OPTIONS = [
  { flag: "--from", type: "YYYY-MM-DD", description: "Inclusive lower date bound." },
  { flag: "--to", type: "YYYY-MM-DD", description: "Inclusive upper date bound." },
  { flag: "--type", type: "csv", description: "Record type filter (e.g. 1,planned,completed)." },
  { flag: "--contains", type: "string", description: "Case-insensitive text match against title/name." },
  { flag: "--min-tss", type: "number", description: "Minimum TSS threshold." },
  { flag: "--max-tss", type: "number", description: "Maximum TSS threshold." },
  { flag: "--sort", type: "enum", description: "date|date-desc|tss|tss-desc|name|name-desc" },
  { flag: "--result-limit", type: "number", description: "Post-filter record cap." },
  { flag: "--fields", type: "csv", description: "Project records to selected field paths." },
];

export const AGENT_OUTPUT_OPTIONS = [
  {
    flag: "--records-only",
    type: "boolean",
    description: "Return only envelope + records (drops heavy side payload fields).",
  },
];

export const FILTERABLE_COMMANDS = new Set([
  "today",
  "future",
  "past",
  "events",
  "annotations",
  "levels",
  "plan",
  "weight-history",
]);

export const COMMAND_REQUIRED_FLAGS = {
  "workout-details": ["id"],
  "add-workout": ["workout-id", "date"],
  "copy-workout": ["id", "date"],
  "workout-alternates": ["id"],
  "move-workout": ["id", "to"],
  "replace-workout": ["id", "alternate-id"],
  "switch-workout": ["id", "mode"],
};

export const FLAG_DETAILS = {
  help: { description: "Show command help and exit." },
  output: { placeholder: "<path>", description: "Write command output to a file instead of stdout." },
  json: { description: "Emit machine-readable JSON output." },
  jsonl: { description: "Emit newline-delimited JSON records." },
  "session-file": {
    placeholder: "<path>",
    description: "Override the persisted session file path.",
  },
  username: { placeholder: "<username>", description: "TrainerRoad account username." },
  password: {
    placeholder: "<password>",
    description: "TrainerRoad account password. Prefer --password-stdin or TR_PASSWORD.",
  },
  "password-stdin": {
    description: "Read the password from stdin so the command stays non-interactive and shell-history safe.",
  },
  "return-path": {
    placeholder: "<path>",
    description: "Override the login ReturnUrl used during the auth flow.",
  },
  level: { placeholder: "1|2|3", description: "Discovery detail level." },
  command: { placeholder: "<command>", description: "Limit discovery/help output to one command." },
  target: { placeholder: "<username>", description: "Public TrainerRoad profile username to query." },
  public: {
    description: "Force public-mode requests even when an authenticated session exists.",
  },
  full: { description: "Return fuller upstream payload data when the command supports it." },
  duration: { placeholder: "<minutes>", description: "Requested workout duration in minutes." },
  "num-suggestions": {
    placeholder: "<count>",
    description: "Maximum TrainNow suggestions to request.",
  },
  category: {
    placeholder: "<value>",
    description: "Command-specific category filter (for example easier, endurance, or outside).",
  },
  from: { placeholder: "YYYY-MM-DD", description: "Inclusive lower date bound." },
  to: { placeholder: "YYYY-MM-DD", description: "Inclusive upper date bound or move target date." },
  type: { placeholder: "<value>", description: "Command-specific record type filter." },
  contains: { placeholder: "<text>", description: "Case-insensitive substring filter." },
  "min-tss": { placeholder: "<number>", description: "Minimum TSS threshold." },
  "max-tss": { placeholder: "<number>", description: "Maximum TSS threshold." },
  sort: { placeholder: "<mode>", description: "Command-specific sort mode." },
  "result-limit": { placeholder: "<count>", description: "Limit records after filters are applied." },
  fields: { placeholder: "a,b,c", description: "Project record fields for leaner downstream payloads." },
  "records-only": {
    description: "Return only the envelope and records arrays when supported.",
  },
  view: { placeholder: "current|phases|plans", description: "Plan view to return." },
  date: { placeholder: "YYYY-MM-DD", description: "Target calendar date." },
  details: { description: "Include additional workout/activity detail in the payload." },
  days: { placeholder: "<count>", description: "Relative day window size." },
  limit: { placeholder: "<count>", description: "Upstream or record limit for the command." },
  "history-limit": {
    placeholder: "<count>",
    description: "Maximum FTP history entries to include.",
  },
  "start-date": { placeholder: "YYYY-MM-DD", description: "Personal records window start date." },
  "end-date": { placeholder: "YYYY-MM-DD", description: "Personal records window end date." },
  "row-type": {
    placeholder: "100|101",
    description: "TrainerRoad PR row type to query.",
  },
  "indoor-only": {
    placeholder: "true|false",
    description: "Restrict personal-record queries to indoor rides.",
  },
  slot: {
    placeholder: "<value>",
    description: "Reserved upstream query slot used by the power-records endpoint.",
  },
  search: { placeholder: "<text>", description: "Free-text workout search query." },
  zone: { placeholder: "<name>", description: "Workout zone name filter." },
  "zone-id": { placeholder: "<id>", description: "Workout zone numeric identifier." },
  profile: { placeholder: "<name>", description: "Workout profile name filter." },
  "profile-id": { placeholder: "<id>", description: "Workout profile numeric identifier." },
  outside: {
    placeholder: "true|false",
    description: "Filter or create the outside workout variant where supported.",
  },
  "has-instructions": {
    placeholder: "true|false",
    description: "Filter workouts by whether text instructions exist.",
  },
  "min-duration": { placeholder: "<minutes>", description: "Minimum workout duration." },
  "max-duration": { placeholder: "<minutes>", description: "Maximum workout duration." },
  "min-level": { placeholder: "<number>", description: "Minimum workout progression level." },
  "max-level": { placeholder: "<number>", description: "Maximum workout progression level." },
  "target-duration": {
    placeholder: "<minutes>",
    description: "Target duration used when ranking recommended workouts.",
  },
  "target-tss": {
    placeholder: "<number>",
    description: "Target TSS used when ranking recommended workouts.",
  },
  "target-level": {
    placeholder: "<number>",
    description: "Target progression level used when ranking recommended workouts.",
  },
  count: { placeholder: "<count>", description: "Number of recommendations to return." },
  "candidate-limit": {
    placeholder: "<count>",
    description: "Maximum candidate workouts to score before ranking.",
  },
  "page-size": {
    placeholder: "<count>",
    description: "Upstream workout library page size.",
  },
  id: { placeholder: "<id>", description: "Workout, planned activity, or record identifier." },
  "include-chart": {
    placeholder: "true|false",
    description: "Include workout chart/sample data in workout-details.",
  },
  "chart-point-limit": {
    placeholder: "<count>",
    description: "Maximum chart points returned with --include-chart.",
  },
  "workout-id": {
    placeholder: "<workout-id>",
    description: "TrainerRoad workout library identifier.",
  },
  "dry-run": {
    description: "Preview the write command and exit without mutating the calendar.",
  },
  "alternate-id": {
    placeholder: "<workout-id>",
    description: "Alternate workout ID to apply during replace-workout.",
  },
  "update-duration": {
    placeholder: "true|false",
    description: "Let TrainerRoad update the duration during replace-workout.",
  },
  mode: {
    placeholder: "inside|outside",
    description: "Target workout delivery mode for switch-workout.",
  },
  tz: {
    placeholder: "<IANA timezone>",
    description: "Override local-day bucketing (defaults to TR_TIMEZONE or system timezone).",
  },
};

function trimFlagPrefix(flag) {
  return String(flag ?? "").replace(/^--/, "").trim();
}

function mergeFlagGroups(...groups) {
  return new Set(
    [...groups.flat(), "tz"]
      .map((flag) => trimFlagPrefix(flag))
      .filter(Boolean),
  );
}

const SHARED_FLAGS = {
  help: ["help"],
  output: ["output"],
  session: ["session-file"],
  credentials: ["username", "password"],
  publicProfile: ["target", "public"],
  json: ["json"],
  jsonAndJsonl: ["json", "jsonl"],
  agentFilters: AGENT_FILTER_OPTIONS.map((option) => trimFlagPrefix(option.flag)),
  agentOutput: AGENT_OUTPUT_OPTIONS.map((option) => trimFlagPrefix(option.flag)),
  writeSafety: ["dry-run"],
};

export const COMMAND_FLAG_ALLOWLIST = {
  help: mergeFlagGroups(SHARED_FLAGS.help, SHARED_FLAGS.json),
  discover: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    ["level", "command"],
  ),
  capabilities: mergeFlagGroups(SHARED_FLAGS.help, SHARED_FLAGS.output, SHARED_FLAGS.json),
  login: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    ["password-stdin", "return-path"],
  ),
  whoami: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
  ),
  timeline: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.publicProfile,
    ["full"],
  ),
  "train-now": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    ["duration", "num-suggestions", "category"],
  ),
  events: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["full"],
  ),
  annotations: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["full"],
  ),
  levels: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
  ),
  plan: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["view", "full"],
  ),
  "weight-history": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
  ),
  today: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.publicProfile,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["date", "details"],
  ),
  future: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.publicProfile,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "from", "to", "details"],
  ),
  past: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.publicProfile,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "limit", "from", "to", "details"],
  ),
  ftp: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.publicProfile,
    ["history-limit"],
  ),
  "ftp-prediction": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
  ),
  "power-ranking": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
  ),
  "power-records": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    ["start-date", "end-date", "row-type", "indoor-only", "slot", "limit", "full"],
  ),
  "workout-library": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    [
      "search",
      "zone",
      "zone-id",
      "profile",
      "profile-id",
      "outside",
      "has-instructions",
      "min-duration",
      "max-duration",
      "min-tss",
      "max-tss",
      "min-level",
      "max-level",
      "sort",
      "limit",
      "page-size",
    ],
  ),
  "workout-recommend": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    [
      "search",
      "zone",
      "zone-id",
      "profile",
      "profile-id",
      "outside",
      "has-instructions",
      "min-duration",
      "max-duration",
      "min-tss",
      "max-tss",
      "min-level",
      "max-level",
      "target-duration",
      "target-tss",
      "target-level",
      "count",
      "candidate-limit",
      "page-size",
      "sort",
    ],
  ),
  "workout-details": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    ["id", "include-chart", "chart-point-limit"],
  ),
  "add-workout": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.writeSafety,
    ["workout-id", "date", "outside"],
  ),
  "copy-workout": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.writeSafety,
    ["id", "date"],
  ),
  "workout-alternates": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    ["id", "category"],
  ),
  "move-workout": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.writeSafety,
    ["id", "to"],
  ),
  "replace-workout": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.writeSafety,
    ["id", "alternate-id", "update-duration"],
  ),
  "switch-workout": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.credentials,
    SHARED_FLAGS.writeSafety,
    ["id", "mode"],
  ),
  logout: mergeFlagGroups(SHARED_FLAGS.help, SHARED_FLAGS.output, SHARED_FLAGS.session),
};
