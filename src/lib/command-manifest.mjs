export const COMMANDS = {
  help: {
    summary: "Show global help or command help.",
    usage: [
      "node src/cli.mjs help",
      "node src/cli.mjs help <command>",
      "node src/cli.mjs <command> --help",
    ],
  },
  discover: {
    summary: "Agent-oriented command discovery with progressive disclosure levels.",
    usage: [
      "node src/cli.mjs discover",
      "node src/cli.mjs discover --level 1|2|3 [--json]",
      "node src/cli.mjs discover --command future --level 3 --json",
    ],
  },
  capabilities: {
    summary: "Show supported auth/data capabilities (private + public modes).",
    usage: ["node src/cli.mjs capabilities [--json]"],
  },
  login: {
    summary: "Authenticate and persist cookie session for private data access.",
    usage: [
      "node src/cli.mjs login --username <u> --password <p> [--return-path /app/career/<username>]",
      "node src/cli.mjs login --username <u> --password-stdin",
    ],
  },
  whoami: {
    summary: "Fetch authenticated member profile info (`/app/api/member-info`).",
    usage: ["node src/cli.mjs whoami [--json]"],
  },
  timeline: {
    summary: "Get profile summary (private full timeline or public TSS-derived summary).",
    usage: [
      "node src/cli.mjs timeline [--target <username>] [--public] [--full] [--json]",
      "node src/cli.mjs timeline --target quinnsprouse --public --json",
    ],
  },
  events: {
    summary: "Show calendar events/races from timeline (private mode).",
    usage: [
      "node src/cli.mjs events [--full] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--type <value>] [--contains <text>] [--min-tss <n>] [--max-tss <n>] [--sort date|date-desc|name|name-desc|tss|tss-desc] [--result-limit <n>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
  },
  annotations: {
    summary: "Show timeline annotations (time off, notes, illness/injury markers) (private mode).",
    usage: [
      "node src/cli.mjs annotations [--full] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--type <value>] [--contains <text>] [--sort date|date-desc|name|name-desc] [--result-limit <n>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
  },
  levels: {
    summary: "Show progression levels by zone (private mode).",
    usage: [
      "node src/cli.mjs levels [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--type <zone|progressionId>] [--contains <text>] [--sort name|name-desc|date|date-desc] [--result-limit <n>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
  },
  plan: {
    summary: "Show training plan data (current plan, phases, or all plans) (private mode).",
    usage: [
      "node src/cli.mjs plan [--view current|phases|plans] [--full] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--type <value>] [--contains <text>] [--sort date|date-desc|name|name-desc] [--result-limit <n>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
  },
  "weight-history": {
    summary: "Show historical body-weight entries (private mode).",
    usage: [
      "node src/cli.mjs weight-history [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--contains <text>] [--sort date|date-desc] [--result-limit <n>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
  },
  today: {
    summary: "Show today's planned/completed activity for private or public profile mode.",
    usage: [
      "node src/cli.mjs today [--date YYYY-MM-DD] [--target <username>] [--public] [--details] [--type <value>] [--contains <text>] [--min-tss <n>] [--max-tss <n>] [--sort date|date-desc|tss|tss-desc] [--result-limit <n>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
  },
  future: {
    summary: "Show future plan data for private or public profile mode.",
    usage: [
      "node src/cli.mjs future [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--target <username>] [--public] [--details] [--type <value>] [--contains <text>] [--min-tss <n>] [--max-tss <n>] [--sort date|date-desc|tss|tss-desc] [--result-limit <n>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
  },
  past: {
    summary: "Show past activity data for private or public profile mode.",
    usage: [
      "node src/cli.mjs past [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--target <username>] [--public] [--details] [--type <value>] [--contains <text>] [--min-tss <n>] [--max-tss <n>] [--sort date|date-desc|tss|tss-desc] [--result-limit <n>] [--fields a,b] [--records-only] [--json|--jsonl]",
    ],
  },
  ftp: {
    summary: "Show FTP snapshot and FTP history (private or public mode).",
    usage: [
      "node src/cli.mjs ftp [--target <username>] [--public] [--history-limit <n>] [--json|--jsonl]",
    ],
  },
  "ftp-prediction": {
    summary: "Show AI FTP detection eligibility/status and progression impact (private mode).",
    usage: ["node src/cli.mjs ftp-prediction [--json]"],
  },
  "power-ranking": {
    summary: "Show best-power percentile ranking by duration (private mode).",
    usage: ["node src/cli.mjs power-ranking [--json|--jsonl]"],
  },
  "power-records": {
    summary: "Show date-range personal power records from TrainerRoad PR endpoint (private mode).",
    usage: [
      "node src/cli.mjs power-records [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--row-type 100|101] [--indoor-only true|false] [--limit <n>] [--full] [--json|--jsonl]",
    ],
  },
  logout: {
    summary: "Clear local persisted session.",
    usage: ["node src/cli.mjs logout"],
  },
};

export const PROJECT_NOTICE = "Unofficial tool. Not affiliated with or endorsed by TrainerRoad.";

export const GLOBAL_NOTES = [
  PROJECT_NOTICE,
  "Environment: TR_USERNAME, TR_PASSWORD, TR_SESSION_FILE, TR_TIMEZONE",
  "Timezone: --tz <IANA timezone> (for example America/New_York).",
  "Output modes: default JSON, --json, --jsonl, --output <path>",
  "Session file default: .trainerroad/session.json",
  "Private mode: authenticated cookie session + full workout endpoints.",
  "Public mode: username-based endpoint (`/app/api/tss/{username}`) with limited detail.",
  "Agent filters: --from --to --type --contains --min-tss --max-tss --sort --result-limit --fields",
  "Agent output: --records-only",
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
  logout: mergeFlagGroups(SHARED_FLAGS.help, SHARED_FLAGS.output, SHARED_FLAGS.session),
};
