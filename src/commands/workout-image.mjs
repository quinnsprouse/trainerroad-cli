import fs from "node:fs/promises";
import path from "node:path";

const FORMATS = new Set(["png", "svg"]);

async function requirePrivateMember(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  try {
    const memberInfo = await client.getMemberInfo();
    return { client, memberInfo };
  } catch {
    throw new Error(
      "This command requires private authenticated mode. Login first with trainerroad-cli login.",
    );
  }
}

async function rasterize(svg, { width, background }) {
  let Resvg;
  try {
    ({ Resvg } = await import("@resvg/resvg-js"));
  } catch {
    throw new Error(
      "PNG output needs the optional @resvg/resvg-js package. Install it (npm install @resvg/resvg-js) or use --format svg.",
    );
  }
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background,
  });
  const image = renderer.render();
  return { bytes: image.asPng(), width: image.width, height: image.height };
}

export async function commandWorkoutImage(flags, deps) {
  const { isJsonMode, requireFlag, requirePositiveInteger, writeOutput } = deps;
  const workoutId = Number(requireFlag("workout-image", flags, "id"));
  if (!Number.isFinite(workoutId)) {
    throw new Error(`Invalid --id "${flags.id}". Expected a numeric workout ID.`);
  }

  const explicitFormat = flags.format ? String(flags.format).toLowerCase() : null;
  if (explicitFormat && !FORMATS.has(explicitFormat)) {
    throw new Error(`Invalid --format "${flags.format}". Expected png or svg.`);
  }
  const requestedFile = flags.file ? String(flags.file) : null;
  const extension = requestedFile ? path.extname(requestedFile).slice(1).toLowerCase() : null;
  const format = explicitFormat ?? (FORMATS.has(extension) ? extension : "png");
  const file = requestedFile ?? `workout-${workoutId}.${format}`;
  const width = requirePositiveInteger(flags.width, 1200);
  const background = flags.background ? String(flags.background) : "#1c1c1c";

  const { client, memberInfo } = await requirePrivateMember(flags, deps);
  const summaryPayload = await client.getWorkoutSummary(workoutId, memberInfo.username);
  const summary = summaryPayload?.summary ?? null;
  const chartUrl = summary?.picUrl ?? null;
  if (!chartUrl) {
    throw new Error(`Workout ${workoutId} has no chart image (summary.picUrl was empty).`);
  }

  const svg = await client.fetchText(chartUrl);
  let bytes;
  let size = null;
  if (format === "svg") {
    bytes = Buffer.from(svg, "utf8");
  } else {
    const rendered = await rasterize(svg, { width, background });
    bytes = rendered.bytes;
    size = { width: rendered.width, height: rendered.height };
  }
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, bytes);

  const payload = {
    generatedAt: new Date().toISOString(),
    command: "workout-image",
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    query: { workoutId, format, width: format === "png" ? width : undefined, background: format === "png" ? background : undefined },
    workout: {
      workoutId,
      workoutName: summary?.workoutName ?? summary?.name ?? null,
      durationMinutes: summary?.duration ?? null,
      tss: summary?.tss ?? null,
      intensityFactor: summary?.intensityFactor ?? null,
    },
    chartUrl,
    file: path.resolve(file),
    bytes: bytes.length,
    size,
    message: `Wrote ${format.toUpperCase()} chart for ${summary?.workoutName ?? `workout ${workoutId}`} to ${path.resolve(file)}.`,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => value.message);
    return;
  }
  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}
