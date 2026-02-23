#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  TrainerRoadClient,
  filterFuturePlanned,
  filterPastActivities,
} from "./trainerroad-client.mjs";
import {
  applyAgentRecordFilters,
  hasAgentRecordTransforms,
  toRecordsOnlyPayload,
} from "./lib/agent-filters.mjs";
import {
  AGENT_FILTER_OPTIONS,
  AGENT_OUTPUT_OPTIONS,
  COMMANDS,
  FILTERABLE_COMMANDS,
  GLOBAL_NOTES,
  PROJECT_NOTICE,
} from "./lib/command-manifest.mjs";
import { commandAnnotations } from "./commands/annotations.mjs";
import { commandLogin, commandLogout, commandWhoAmI } from "./commands/auth.mjs";
import { commandCapabilities, commandDiscover, buildDiscoveryPayload } from "./commands/discovery.mjs";
import { commandEvents } from "./commands/events.mjs";
import { commandFtp, commandFtpPrediction } from "./commands/ftp.mjs";
import { commandLevels } from "./commands/levels.mjs";
import { commandPlan } from "./commands/plan.mjs";
import { commandPowerRanking, commandPowerRecords } from "./commands/power.mjs";
import { commandTimeline } from "./commands/timeline.mjs";
import { commandWeightHistory } from "./commands/weight-history.mjs";
import { commandFuture, commandPast, commandToday } from "./commands/workouts.mjs";

function printGlobalHelp() {
  console.log("trainerroad-cli (unofficial)");
  console.log("");
  console.log("Commands:");
  for (const [name, def] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(13)} ${def.summary}`);
  }
  console.log("");
  console.log("Global notes:");
  for (const note of GLOBAL_NOTES) console.log(`  - ${note}`);
  console.log("");
  console.log("Progressive disclosure:");
  console.log("  node src/cli.mjs discover --level 1");
  console.log("  node src/cli.mjs discover --level 2");
  console.log("  node src/cli.mjs discover --command future --level 3 --json");
  console.log("");
  console.log("Examples:");
  console.log("  node src/cli.mjs login --username quinnsprouse --password-stdin");
  console.log("  node src/cli.mjs future --days 30 --details --json");
  console.log("  node src/cli.mjs future --from 2026-03-01 --to 2026-03-31 --min-tss 60 --fields id,title,tss --jsonl");
  console.log("  node src/cli.mjs timeline --target quinnsprouse --public --json");
  console.log("  node src/cli.mjs ftp --target quinnsprouse --public --json");
}

function levenshteinDistance(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function getCommandSuggestions(input, max = 3) {
  const value = String(input ?? "").trim().toLowerCase();
  if (!value) return [];
  const commands = Object.keys(COMMANDS);

  const prefixMatches = commands.filter((name) => name.toLowerCase().startsWith(value));
  if (prefixMatches.length > 0) return prefixMatches.slice(0, max);

  const ranked = commands
    .map((name) => ({ name, distance: levenshteinDistance(value, name) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

  const threshold = Math.max(2, Math.floor(value.length / 3));
  return ranked
    .filter((item) => item.distance <= threshold)
    .slice(0, max)
    .map((item) => item.name);
}

function formatUnknownCommandMessage(input) {
  const suggestions = getCommandSuggestions(input);
  const lines = [`unknown command "${input}" for "trainerroad-cli"`];
  if (suggestions.length === 1) {
    lines.push("", "Did you mean this?", `  ${suggestions[0]}`);
  } else if (suggestions.length > 1) {
    lines.push("", "Did you mean one of these?");
    for (const suggestion of suggestions) lines.push(`  ${suggestion}`);
  }
  lines.push("", 'Run "trainerroad-cli help" for available commands.');
  return lines.join("\n");
}

function printCommandHelp(command, flags = {}) {
  const def = COMMANDS[command];
  if (!def) {
    console.error(formatUnknownCommandMessage(command));
    return 1;
  }
  if (flags.json) {
    const payload = {
      command,
      summary: def.summary,
      usage: def.usage,
      supportsAgentFilters: FILTERABLE_COMMANDS.has(command),
      agentFilterOptions: FILTERABLE_COMMANDS.has(command) ? AGENT_FILTER_OPTIONS : [],
      agentOutputOptions: FILTERABLE_COMMANDS.has(command) ? AGENT_OUTPUT_OPTIONS : [],
      outputModes: ["text", "json", "jsonl"],
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }
  console.log(`trainerroad-cli ${command} (unofficial)`);
  console.log("");
  console.log(def.summary);
  console.log(PROJECT_NOTICE);
  console.log("");
  console.log("Usage:");
  for (const line of def.usage) console.log(`  ${line}`);
  if (FILTERABLE_COMMANDS.has(command)) {
    console.log("");
    console.log("Agent filters:");
    for (const option of AGENT_FILTER_OPTIONS) {
      console.log(`  ${option.flag.padEnd(14)} ${option.description}`);
    }
    console.log("Agent output options:");
    for (const option of AGENT_OUTPUT_OPTIONS) {
      console.log(`  ${option.flag.padEnd(14)} ${option.description}`);
    }
  }
  return 0;
}

function parseArgs(argv) {
  const command = argv[2] ?? null;
  const args = argv.slice(3);
  const flags = {};
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const part = args[i];
    if (!part.startsWith("--")) {
      positionals.push(part);
      continue;
    }
    const key = part.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }

  return { command, flags, positionals };
}

function isoDateShift(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toIsoDateFromPlanned(item) {
  return `${String(item.date.year).padStart(4, "0")}-${String(item.date.month).padStart(2, "0")}-${String(item.date.day).padStart(2, "0")}`;
}

function toIsoDate(value) {
  if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function normalizeDateOnlyInput(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`);
  }
  return normalized;
}

function requireNumber(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function requirePositiveInteger(value, fallback) {
  const parsed = requireNumber(value, fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function toBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function isJsonMode(flags) {
  return Boolean(flags.json || flags.jsonl);
}

function normalizeFtpHistory(raw) {
  const records = Array.isArray(raw) ? raw : [];
  return records
    .map((item) => {
      const dateRaw = item?.date ?? item?.Date ?? null;
      const valueRaw = item?.value ?? item?.Value ?? null;
      const value = Number(valueRaw);
      if (!dateRaw || !Number.isFinite(value)) return null;
      return {
        date: new Date(dateRaw).toISOString(),
        dateOnly: toIsoDate(dateRaw),
        value,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getLastItem(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values[values.length - 1];
}

function compactPersonalRecord(record) {
  return {
    seconds: record?.Seconds ?? null,
    watts: record?.Watts ?? null,
    workoutDate: record?.WorkoutDate ?? null,
    workoutSeconds: record?.WorkoutSeconds ?? null,
    workoutGuid: record?.WorkoutGuid ?? null,
    workoutRecordId: record?.WorkoutRecordId ?? null,
    workoutRecordName: record?.WorkoutRecordName ?? null,
    surveyResponse: record?.SurveyResponseTranslated ?? null,
  };
}

function normalizeFitnessThresholds(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((item) => {
      const dateRaw = item?.date ?? item?.Date ?? null;
      const valueRaw = item?.value ?? item?.Value ?? null;
      const value = Number(valueRaw);
      if (!dateRaw || !Number.isFinite(value)) return null;
      return {
        id: item?.id ?? item?.Id ?? null,
        date: new Date(dateRaw).toISOString(),
        dateOnly: toIsoDate(dateRaw),
        value,
        isApplied: Boolean(item?.isApplied ?? item?.IsApplied),
        isEnabled: item?.isEnabled ?? item?.IsEnabled ?? null,
        source: item?.source ?? item?.Source ?? null,
        viewed: item?.viewed ?? item?.Viewed ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function dateOnlyDiffDays(fromDateOnly, toDateOnly) {
  const fromMs = Date.parse(`${fromDateOnly}T00:00:00Z`);
  const toMs = Date.parse(`${toDateOnly}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.round((toMs - fromMs) / 86_400_000);
}

function countPlannedWorkoutsInRange(plannedActivities, fromDateOnly, toDateOnly) {
  const rows = Array.isArray(plannedActivities) ? plannedActivities : [];
  return rows.filter((item) => {
    const date = toIsoDateFromPlanned(item);
    if (date < fromDateOnly || date > toDateOnly) return false;
    const type = Number(item?.type);
    return item?.workoutId != null || type === 1;
  }).length;
}

function flattenPublicTssDays(publicTss) {
  const weeks = Array.isArray(publicTss?.tssByDay)
    ? publicTss.tssByDay
    : Array.isArray(publicTss?.TssByDay)
      ? publicTss.TssByDay
      : [];
  return weeks
    .flat()
    .filter((day) => day?.date || day?.Date)
    .map((day) => ({
      date: toIsoDate(day.date ?? day.Date),
      tss: day.tss ?? day.Tss ?? 0,
      tssTrainerRoad: day.tssTrainerRoad ?? day.TssTrainerRoad ?? 0,
      tssOther: day.tssOther ?? day.TssOther ?? 0,
      plannedTssTrainerRoad: day.plannedTssTrainerRoad ?? day.PlannedTssTrainerRoad ?? 0,
      plannedTssOther: day.plannedTssOther ?? day.PlannedTssOther ?? 0,
      plannedTssTotal:
        (day.plannedTssTrainerRoad ?? day.PlannedTssTrainerRoad ?? 0) +
        (day.plannedTssOther ?? day.PlannedTssOther ?? 0),
      hasRides: Boolean(day.hasRides ?? day.HasRides),
    }));
}

function sortByDateAsc(days) {
  return [...days].sort((a, b) => a.date.localeCompare(b.date));
}

function sortByDateDesc(days) {
  return [...days].sort((a, b) => b.date.localeCompare(a.date));
}

async function readPasswordFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function writeOutput(payload, flags, textRenderer = null) {
  if (flags.jsonl) {
    const records = Array.isArray(payload?.records) ? payload.records : Array.isArray(payload) ? payload : [];
    const content = records.map((item) => JSON.stringify(item)).join("\n");
    if (flags.output) {
      await fs.writeFile(flags.output, `${content}${content ? "\n" : ""}`, "utf8");
      console.log(`Wrote JSONL to ${flags.output}`);
      return;
    }
    if (content) console.log(content);
    return;
  }

  if (flags.json || typeof payload !== "string") {
    const content =
      typeof payload === "string" ? payload : `${JSON.stringify(payload, null, 2)}\n`;
    if (flags.output) {
      await fs.writeFile(flags.output, content, "utf8");
      console.log(`Wrote JSON to ${flags.output}`);
      return;
    }
    process.stdout.write(content);
    return;
  }

  const text = textRenderer ? textRenderer(payload) : String(payload);
  if (flags.output) {
    await fs.writeFile(flags.output, `${text}\n`, "utf8");
    console.log(`Wrote text to ${flags.output}`);
    return;
  }
  console.log(text);
}

async function withClient(flags) {
  const sessionFile =
    flags["session-file"] ??
    process.env.TR_SESSION_FILE ??
    path.resolve(".trainerroad", "session.json");
  const client = new TrainerRoadClient({
    username: flags.username ?? process.env.TR_USERNAME ?? null,
    password: flags.password ?? process.env.TR_PASSWORD ?? null,
    sessionFile,
  });
  await client.loadSession();
  return client;
}

async function tryGetAuthenticatedMemberInfo(client) {
  try {
    return await client.getMemberInfo();
  } catch {
    return null;
  }
}

async function resolveQueryContext(flags) {
  const client = await withClient(flags);
  const authenticatedMemberInfo = await tryGetAuthenticatedMemberInfo(client);
  const forcePublic = Boolean(flags.public);
  const target = flags.target ?? null;

  const canUsePrivate =
    authenticatedMemberInfo &&
    !forcePublic &&
    (!target || target === authenticatedMemberInfo.username);

  if (canUsePrivate) {
    const timeline = await client.getTimeline(
      authenticatedMemberInfo.memberId,
      authenticatedMemberInfo.username,
    );
    return {
      mode: "private",
      client,
      authenticatedMemberInfo,
      memberInfo: authenticatedMemberInfo,
      targetUsername: authenticatedMemberInfo.username,
      timeline,
    };
  }

  const publicUsername = target ?? authenticatedMemberInfo?.username ?? null;
  if (!publicUsername) {
    throw new Error(
      "No target profile available. Use --target <username> for public mode, or login for private mode.",
    );
  }

  let publicTss;
  try {
    publicTss = await client.getPublicTssByUsername(publicUsername);
  } catch {
    throw new Error(
      `Public profile data is unavailable for "${publicUsername}". The profile may be private, or the username may not exist.`,
    );
  }

  return {
    mode: "public",
    client,
    authenticatedMemberInfo,
    targetUsername: publicUsername,
    publicTss,
    publicDays: flattenPublicTssDays(publicTss),
  };
}

function requirePrivateContext(context, command) {
  if (context.mode !== "private") {
    throw new Error(
      `${command} requires private authenticated mode. Login first and run without --public/--target for full private data access.`,
    );
  }
}

async function main() {
  const { command, flags, positionals } = parseArgs(process.argv);

  if (!command) {
    printGlobalHelp();
    process.exit(0);
  }

  if (command === "help") {
    if (positionals[0]) {
      process.exit(printCommandHelp(positionals[0], flags));
    }
    if (flags.json) {
      const payload = buildDiscoveryPayload(2, null);
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exit(0);
    }
    printGlobalHelp();
    process.exit(0);
  }

  if (!COMMANDS[command]) {
    console.error(formatUnknownCommandMessage(command));
    process.exit(1);
  }

  if (flags.help) {
    process.exit(printCommandHelp(command, flags));
  }

  const commandDeps = {
    resolveQueryContext,
    requirePrivateContext,
    applyAgentRecordFilters,
    toRecordsOnlyPayload,
    hasAgentRecordTransforms,
    isJsonMode,
    writeOutput,
    requirePositiveInteger,
    requireNumber,
    normalizeDateOnlyInput,
    isoDateShift,
    filterFuturePlanned,
    filterPastActivities,
    sortByDateAsc,
    sortByDateDesc,
    toIsoDateFromPlanned,
    toIsoDate,
    withClient,
    readPasswordFromStdin,
    normalizeFtpHistory,
    getLastItem,
    normalizeFitnessThresholds,
    dateOnlyDiffDays,
    countPlannedWorkoutsInRange,
    toBoolean,
    compactPersonalRecord,
  };

  switch (command) {
    case "discover":
      await commandDiscover(flags, commandDeps);
      return;
    case "capabilities":
      await commandCapabilities(flags, commandDeps);
      return;
    case "login":
      await commandLogin(flags, commandDeps);
      return;
    case "whoami":
      await commandWhoAmI(flags, commandDeps);
      return;
    case "timeline":
      await commandTimeline(flags, commandDeps);
      return;
    case "events":
      await commandEvents(flags, commandDeps);
      return;
    case "annotations":
      await commandAnnotations(flags, commandDeps);
      return;
    case "levels":
      await commandLevels(flags, commandDeps);
      return;
    case "plan":
      await commandPlan(flags, commandDeps);
      return;
    case "weight-history":
      await commandWeightHistory(flags, commandDeps);
      return;
    case "today":
      await commandToday(flags, commandDeps);
      return;
    case "future":
      await commandFuture(flags, commandDeps);
      return;
    case "past":
      await commandPast(flags, commandDeps);
      return;
    case "ftp":
      await commandFtp(flags, commandDeps);
      return;
    case "ftp-prediction":
      await commandFtpPrediction(flags, commandDeps);
      return;
    case "power-ranking":
      await commandPowerRanking(flags, commandDeps);
      return;
    case "power-records":
      await commandPowerRecords(flags, commandDeps);
      return;
    case "logout":
      await commandLogout(flags, commandDeps);
      return;
    default:
      throw new Error(`Unhandled command: ${command}`);
  }
}

main().catch((error) => {
  const message = String(error?.message ?? error ?? "Unknown error");
  console.error(`Error: ${message}`);

  const unknownDiscoverCommandMatch = message.match(/^Unknown command for --command:\s*(.+)$/);
  if (unknownDiscoverCommandMatch) {
    const bad = unknownDiscoverCommandMatch[1].trim();
    const suggestions = getCommandSuggestions(bad);
    if (suggestions.length > 0) {
      console.error("Did you mean:");
      for (const suggestion of suggestions) console.error(`  ${suggestion}`);
    }
  }

  if (
    message.includes("requires private authenticated mode") ||
    message.includes("No target profile available")
  ) {
    console.error('Tip: login first: trainerroad-cli login --username <username> --password-stdin');
  }
  if (message.includes("No target profile available")) {
    console.error('Tip: or use public mode: trainerroad-cli <command> --target <username> --public');
  }
  if (message.includes('Invalid --view "')) {
    console.error("Tip: valid plan views are: current, phases, plans");
  }
  if (message.includes('Invalid date "')) {
    console.error("Tip: expected date format is YYYY-MM-DD");
  }
  console.error('Run "trainerroad-cli help" or "trainerroad-cli help <command>" for usage.');

  if (process.env.TR_CLI_DEBUG === "1" && error?.stack) {
    console.error("");
    console.error(error.stack);
  }
  process.exit(1);
});
