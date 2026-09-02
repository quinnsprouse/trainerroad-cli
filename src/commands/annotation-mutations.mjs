import {
  ANNOTATION_TYPE_IDS,
  ANNOTATION_TYPE_LABELS,
  compactAnnotationDetail,
} from "../lib/planning-normalizers.mjs";
import { shiftDateOnly } from "../lib/timezone.mjs";
import { isHttpStatus } from "../trainerroad-client.mjs";

const DAY_SECONDS = 86_400;

function dateOnlyDiffDays(fromDateOnly, toDateOnly) {
  const [fy, fm, fd] = fromDateOnly.split("-").map(Number);
  const [ty, tm, td] = toDateOnly.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_SECONDS / 1000);
}

// TrainerRoad's Adaptive Training reacts to calendar changes: time off, illness, and injury
// entries can prompt it to adjust the surrounding planned workouts. Surface that to agents.
const ADAPTIVE_NOTE =
  "TrainerRoad may adapt nearby planned workouts in response to this change. Re-read `future` afterwards.";

function resolveAnnotationType(value) {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim().toLowerCase();
  if (/^\d+$/.test(raw)) {
    const typeId = Number(raw);
    return { typeId, typeLabel: ANNOTATION_TYPE_LABELS[typeId] ?? `type-${typeId}` };
  }
  const typeId = ANNOTATION_TYPE_IDS[raw] ?? ANNOTATION_TYPE_IDS[raw.replace(/[\s_]+/g, "-")];
  if (typeId === undefined) return null;
  return { typeId, typeLabel: ANNOTATION_TYPE_LABELS[typeId] };
}

function validTypeNames() {
  return Object.keys(ANNOTATION_TYPE_IDS).join(", ");
}

function annotationTitleFor(typeLabel) {
  return typeLabel
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function requirePrivateMember(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  let memberInfo;
  try {
    memberInfo = await client.getMemberInfo();
  } catch {
    throw new Error(
      "This command requires private authenticated mode. Login first with trainerroad-cli login.",
    );
  }
  return { client, memberInfo };
}

async function annotationIdsOnCalendar(client, memberInfo) {
  const timeline = await client.getTimeline(memberInfo.memberId, memberInfo.username);
  const rows = Array.isArray(timeline?.annotations) ? timeline.annotations : [];
  return new Set(rows.map((row) => String(row?.id)).filter((id) => id && id !== "undefined"));
}

export async function commandAnnotationDetails(flags, deps) {
  const { isJsonMode, requireFlag, writeOutput } = deps;
  const annotationId = String(requireFlag("annotation-details", flags, "id"));
  const { client, memberInfo } = await requirePrivateMember(flags, deps);
  const raw = await client.getAnnotation(annotationId, memberInfo.username);
  const annotation = compactAnnotationDetail(raw);

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "annotation-details",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { annotationId },
    annotation,
    raw: flags.full ? raw : undefined,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const a = value.annotation;
      return [
        `${a.typeLabel} ${a.dateOnly}..${a.endDateOnly} (${a.durationDays}d) | id=${a.id}`,
        `title: ${a.title ?? "(none)"}`,
        `notes: ${a.text ?? "(none)"}`,
      ].join("\n");
    });
    return;
  }
  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandAddAnnotation(flags, deps) {
  const { isJsonMode, requireFlag, toBoolean, normalizeDateOnlyInput, requirePositiveInteger, writeOutput } = deps;
  const dryRun = toBoolean(flags["dry-run"], false);
  const type = resolveAnnotationType(requireFlag("add-annotation", flags, "type"));
  if (!type) {
    throw new Error(`Invalid --type "${flags.type}". Expected one of: ${validTypeNames()}, or a numeric typeId.`);
  }
  const date = normalizeDateOnlyInput(requireFlag("add-annotation", flags, "date"), null);
  if (!date) throw new Error(`Invalid --date "${flags.date}". Expected YYYY-MM-DD.`);

  let durationDays = requirePositiveInteger(flags.days, 1);
  if (flags["end-date"] !== undefined && flags["end-date"] !== null && flags["end-date"] !== "") {
    const endDate = normalizeDateOnlyInput(flags["end-date"], null);
    if (!endDate) throw new Error(`Invalid --end-date "${flags["end-date"]}". Expected YYYY-MM-DD.`);
    const diff = dateOnlyDiffDays(date, endDate);
    if (diff === null || diff < 0) {
      throw new Error(`--end-date ${endDate} is before --date ${date}.`);
    }
    durationDays = diff + 1;
  }
  const endDateOnly = shiftDateOnly(date, durationDays - 1);

  const title = flags.title !== undefined && flags.title !== null && String(flags.title) !== ""
    ? String(flags.title)
    : annotationTitleFor(type.typeLabel);
  const text = flags.notes !== undefined && flags.notes !== null ? String(flags.notes) : "";
  const colorId = requirePositiveInteger(flags["color-id"], 2);

  const request = {
    date,
    timeOfDay: null,
    duration: durationDays * DAY_SECONDS,
    title,
    text,
    typeId: type.typeId,
    colorId,
  };
  const preview = {
    typeId: type.typeId,
    typeLabel: type.typeLabel,
    dateOnly: date,
    endDateOnly,
    durationDays,
    title,
    text,
    colorId,
  };

  const { client, memberInfo } = await requirePrivateMember(flags, deps);

  const base = {
    generatedAt: new Date().toISOString(),
    command: "add-annotation",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: preview,
    adaptiveTraining: ADAPTIVE_NOTE,
  };

  if (dryRun) {
    const payload = {
      ...base,
      dryRun: true,
      annotation: null,
      request,
      message: `Would add ${type.typeLabel} "${title}" on ${date}${durationDays > 1 ? ` through ${endDateOnly}` : ""}.`,
    };
    if (!isJsonMode(flags)) {
      await writeOutput(payload, flags, (value) => `${value.message}\nNo changes made.`);
      return;
    }
    await writeOutput(payload, { ...flags, json: !flags.jsonl });
    return;
  }

  const before = await annotationIdsOnCalendar(client, memberInfo);
  await client.createAnnotation(request, memberInfo.username);
  const after = await annotationIdsOnCalendar(client, memberInfo);
  const createdIds = [...after].filter((id) => !before.has(id));

  let annotation = null;
  for (const id of createdIds) {
    const detail = compactAnnotationDetail(await client.getAnnotation(id, memberInfo.username));
    if (detail.typeId === type.typeId && detail.dateOnly === date) {
      annotation = detail;
      break;
    }
  }

  const payload = {
    ...base,
    dryRun: false,
    annotation,
    request,
    message: annotation
      ? `Added ${annotation.typeLabel} "${annotation.title}" on ${annotation.dateOnly}${annotation.durationDays > 1 ? ` through ${annotation.endDateOnly}` : ""} (id=${annotation.id}).`
      : "TrainerRoad accepted the annotation but it could not be located on the calendar afterwards. Run `annotations` to inspect.",
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => `${value.message}\n${value.adaptiveTraining}`);
    return;
  }
  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandRemoveAnnotation(flags, deps) {
  const { isJsonMode, requireFlag, toBoolean, writeOutput } = deps;
  const dryRun = toBoolean(flags["dry-run"], false);
  const annotationId = String(requireFlag("remove-annotation", flags, "id"));
  const { client, memberInfo } = await requirePrivateMember(flags, deps);

  let before = null;
  try {
    before = compactAnnotationDetail(await client.getAnnotation(annotationId, memberInfo.username));
  } catch (error) {
    if (!isHttpStatus(error, 404)) throw error;
  }
  const noop = before === null;

  const base = {
    generatedAt: new Date().toISOString(),
    command: "remove-annotation",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { annotationId },
    before,
    adaptiveTraining: ADAPTIVE_NOTE,
  };

  if (dryRun || noop) {
    const payload = {
      ...base,
      dryRun,
      noop,
      message: noop
        ? `No annotation with id ${annotationId} exists on the calendar.`
        : `Would remove ${before.typeLabel} "${before.title}" on ${before.dateOnly}.`,
    };
    if (!isJsonMode(flags)) {
      await writeOutput(payload, flags, (value) => (value.noop ? value.message : `${value.message}\nNo changes made.`));
      return;
    }
    await writeOutput(payload, { ...flags, json: !flags.jsonl });
    return;
  }

  await client.deleteAnnotation(annotationId, memberInfo.username);
  const payload = {
    ...base,
    dryRun: false,
    noop: false,
    message: `Removed ${before.typeLabel} "${before.title}" on ${before.dateOnly} (id=${annotationId}).`,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => `${value.message}\n${value.adaptiveTraining}`);
    return;
  }
  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}
