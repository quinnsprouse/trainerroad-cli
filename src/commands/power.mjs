export async function commandPowerRanking(flags, deps) {
  const { resolveQueryContext, requirePrivateContext, isJsonMode, writeOutput } = deps;
  const context = await resolveQueryContext(flags);
  requirePrivateContext(context, "power-ranking");

  const records = await context.client.getPowerRanking(
    context.memberInfo.memberId,
    context.memberInfo.username,
  );
  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "power-ranking",
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    count: records.length,
    records,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [`Power ranking entries: ${value.count}`];
      for (const item of value.records) {
        const watts = item?.wattsRanking?.value ?? null;
        const wattsPct = item?.wattsRanking?.percentile ?? null;
        const wkg = item?.wattsPerKgRanking?.value ?? null;
        const wkgPct = item?.wattsPerKgRanking?.percentile ?? null;
        lines.push(
          `- ${item.duration}s | watts=${watts ?? "n/a"} (pct=${wattsPct ?? "n/a"}) | w/kg=${wkg ?? "n/a"} (pct=${wkgPct ?? "n/a"})`,
        );
      }
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandPowerRecords(flags, deps) {
  const {
    resolveQueryContext,
    requirePrivateContext,
    normalizeDateOnlyInput,
    isoDateShift,
    requirePositiveInteger,
    toBoolean,
    compactPersonalRecord,
    isJsonMode,
    writeOutput,
    toIsoDate,
  } = deps;
  const context = await resolveQueryContext(flags);
  requirePrivateContext(context, "power-records");

  const startDate = normalizeDateOnlyInput(flags["start-date"], "2013-05-10");
  const endDate = normalizeDateOnlyInput(flags["end-date"], isoDateShift(0));
  const rowType = requirePositiveInteger(flags["row-type"], 101);
  const indoorOnly = toBoolean(flags["indoor-only"], false);
  const slot = requirePositiveInteger(flags.slot, 1);
  const limit = requirePositiveInteger(flags.limit, 25);
  const full = toBoolean(flags.full, false);

  const raw = await context.client.getPersonalRecordsForDateRange(
    context.memberInfo.memberId,
    context.memberInfo.username,
    { startDate, endDate, rowType, indoorOnly, slot },
  );

  const allRecords = Array.isArray(raw?.results?.[0]?.personalRecords)
    ? raw.results[0].personalRecords
    : [];
  const rankedByWatts = [...allRecords].sort((a, b) => (b?.Watts ?? 0) - (a?.Watts ?? 0));
  const selectedRaw = full ? allRecords : rankedByWatts.slice(0, limit);
  const records = full ? selectedRaw : selectedRaw.map((item) => compactPersonalRecord(item));

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "power-records",
    member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
    query: { startDate, endDate, rowType, indoorOnly, slot, limit, full },
    totalRecords: allRecords.length,
    count: records.length,
    records,
    results: full ? raw?.results ?? [] : undefined,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `Power records: returned ${value.count} of ${value.totalRecords}`,
        `Range: ${value.query.startDate}..${value.query.endDate} | rowType=${value.query.rowType} | indoorOnly=${value.query.indoorOnly}`,
      ];
      for (const item of value.records) {
        const workoutDate = item?.workoutDate ?? item?.WorkoutDate ?? null;
        const seconds = item?.seconds ?? item?.Seconds ?? null;
        const watts = item?.watts ?? item?.Watts ?? null;
        const name = item?.workoutRecordName ?? item?.WorkoutRecordName ?? "(unknown)";
        const dateLabel = workoutDate ? toIsoDate(workoutDate) : "(unknown-date)";
        lines.push(
          `- ${dateLabel} ${seconds}s ${watts}W | ride=${name}`,
        );
      }
      if (!value.query.full) {
        lines.push("Tip: add --full --json for complete personal-record payload.");
      }
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}
