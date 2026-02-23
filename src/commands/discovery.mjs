import {
  AGENT_FILTER_OPTIONS,
  AGENT_OUTPUT_OPTIONS,
  COMMANDS,
  FILTERABLE_COMMANDS,
} from "../lib/command-manifest.mjs";

export function buildDiscoveryPayload(level = 1, commandFilter = null) {
  const commandEntries = Object.entries(COMMANDS)
    .filter(([name]) => !commandFilter || name === commandFilter)
    .map(([name, def]) => ({
      name,
      summary: def.summary,
      usage: level >= 2 ? def.usage : undefined,
      supportsAgentFilters: FILTERABLE_COMMANDS.has(name),
      agentFilters: level >= 3 && FILTERABLE_COMMANDS.has(name) ? AGENT_FILTER_OPTIONS : undefined,
      agentOutputOptions:
        level >= 3 && FILTERABLE_COMMANDS.has(name) ? AGENT_OUTPUT_OPTIONS : undefined,
    }));

  const payload = {
    generatedAt: new Date().toISOString(),
    progressiveDisclosureLevel: level,
    discoveryFlow: {
      level1: "Find command families and choose auth mode.",
      level2: "Pick command and run with --json for machine output.",
      level3: "Apply --from/--to/--type/--contains/--min-tss/--max-tss/--sort/--result-limit/--fields.",
    },
    firstSteps: [
      "node src/cli.mjs capabilities --json",
      "node src/cli.mjs whoami --json",
      "node src/cli.mjs future --days 30 --json",
      "node src/cli.mjs help future --json",
    ],
    commandCount: commandEntries.length,
    commands: commandEntries,
  };

  if (level >= 3) {
    payload.agentPatterns = [
      {
        pattern: "Summarize future workouts in a date window",
        command:
          "node src/cli.mjs future --from 2026-03-01 --to 2026-03-31 --fields id,title,tss,date --sort date --json",
      },
      {
        pattern: "Find hard completed rides",
        command:
          "node src/cli.mjs past --days 90 --details --min-tss 80 --sort tss-desc --result-limit 20 --jsonl",
      },
      {
        pattern: "Extract only fields for downstream tools",
        command:
          "node src/cli.mjs today --details --fields recordType,name,started,tss --json",
      },
    ];
  }

  return payload;
}

export async function commandDiscover(flags, deps) {
  const { requirePositiveInteger, isJsonMode, writeOutput } = deps;
  const level = requirePositiveInteger(flags.level, 1);
  const boundedLevel = Math.min(Math.max(level, 1), 3);
  const commandFilter = flags.command ? String(flags.command).trim() : null;
  if (commandFilter && !COMMANDS[commandFilter]) {
    throw new Error(`Unknown command for --command: ${commandFilter}`);
  }

  const payload = buildDiscoveryPayload(boundedLevel, commandFilter);
  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `Discovery level: ${value.progressiveDisclosureLevel}`,
        "Flow:",
        `- L1: ${value.discoveryFlow.level1}`,
        `- L2: ${value.discoveryFlow.level2}`,
        `- L3: ${value.discoveryFlow.level3}`,
        `Commands returned: ${value.commandCount}`,
      ];
      for (const command of value.commands) {
        lines.push(`- ${command.name}: ${command.summary}`);
      }
      lines.push("Tip: add --json for structured discovery payload.");
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandCapabilities(flags, deps) {
  const { writeOutput } = deps;
  const payload = {
    generatedAt: new Date().toISOString(),
    authModes: {
      private: {
        method: "cookie-session + anti-forgery form post",
        browserRequired: false,
        flow: [
          "GET /app/login?ReturnUrl=...",
          "parse __RequestVerificationToken + ReturnUrl",
          "POST /app/login (x-www-form-urlencoded)",
          "store SharedTrainerRoadAuth cookie",
        ],
      },
      public: {
        method: "username-based unauthenticated endpoint access",
        browserRequired: false,
        endpoint: "GET /app/api/tss/{username}",
        limitations: [
          "No detailed workout names/durations from public endpoint",
          "No private react-calendar detail endpoints without auth",
        ],
      },
    },
    endpointCoverage: {
      privateFull: [
        "GET /app/api/member-info",
        "GET /app/api/react-calendar/{memberId}/timeline",
        "GET /app/api/react-calendar/{memberId}/activities (ids header)",
        "GET /app/api/react-calendar/{memberId}/planned-activities (ids header)",
        "GET /app/api/react-calendar/{memberId}/personal-records (ids header)",
        "GET /app/api/career/{memberId}/levels",
        "GET /app/api/career/{username}/new",
        "GET /app/api/weight-history/{memberId}/all",
        "GET /app/api/plan-builder/current-custom-plan/{username}",
        "GET /app/api/plan-builder/{username}/all-user-plans",
        "GET /app/api/plan-builder/{username}/plan-phases",
        "GET /app/api/ai-ftp-detection/can-use-ai-ftp/{memberId}",
        "GET /app/api/calendar/aiftp/{memberId}/ai-failure-status",
        "GET /app/api/seasons/{memberId}",
        "GET /app/api/onboarding/power-ranking?memberId={memberId}",
        "GET /app/api/onboarding/personal-records?startTime=...&endTime=...",
        "POST /app/api/personal-records/for-date-range/{memberId}?rowType=...&indoorOnly=...",
      ],
      publicLimited: [
        "GET /app/api/tss/{username} (day-level TSS + FTP history)",
      ],
    },
    commands: Object.keys(COMMANDS),
    agentFeatures: {
      progressiveDisclosure: [
        "discover --level 1",
        "discover --level 2",
        "discover --level 3 --json",
        "help <command> --json",
      ],
      filterableCommands: Array.from(FILTERABLE_COMMANDS),
      filterOptions: AGENT_FILTER_OPTIONS,
      outputOptions: AGENT_OUTPUT_OPTIONS,
    },
    outputModes: ["text", "json", "jsonl"],
  };

  await writeOutput(payload, flags, () => {
    return [
      "Capabilities:",
      "- Private mode (authenticated): full timeline + workout details.",
      "- Public mode (unauthenticated): day-level TSS/ride/planned signals + FTP history.",
      "- Commands support both via automatic mode selection and --target/--public flags.",
    ].join("\n");
  });
}
