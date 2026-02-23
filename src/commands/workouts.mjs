function addLocalTimeSummary(record, summarizeActivityTime) {
  if (!record || typeof record !== "object" || typeof summarizeActivityTime !== "function") {
    return record;
  }
  const summary = summarizeActivityTime(record.started, record.durationInSeconds);
  if (!summary) return record;
  return { ...record, ...summary };
}

function addLocalTimeSummaryList(records, summarizeActivityTime) {
  const rows = Array.isArray(records) ? records : [];
  return rows.map((record) => addLocalTimeSummary(record, summarizeActivityTime));
}

export async function commandFuture(flags, deps) {
  const {
    requireNumber,
    normalizeDateOnlyInput,
    isoDateShift,
    resolveQueryContext,
    filterFuturePlanned,
    applyAgentRecordFilters,
    toRecordsOnlyPayload,
    isJsonMode,
    writeOutput,
    hasAgentRecordTransforms,
    toIsoDateFromPlanned,
    sortByDateAsc,
  } = deps;

  const days = requireNumber(flags.days, 60);
  const fromDate = normalizeDateOnlyInput(flags.from, isoDateShift(0));
  const toDate = normalizeDateOnlyInput(flags.to, isoDateShift(days));
  if (toDate < fromDate) {
    throw new Error(`Invalid range: --to (${toDate}) is before --from (${fromDate}).`);
  }

  const context = await resolveQueryContext(flags);
  if (context.mode === "private") {
    const subset = filterFuturePlanned(context.timeline.plannedActivities, fromDate, toDate);
    let records = subset;
    if (flags.details) {
      records = await context.client.getPlannedActivitiesByIds(
        context.memberInfo.memberId,
        context.memberInfo.username,
        subset.map((item) => item.id),
      );
    }
    const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags);

    const payload = {
      mode: "private",
      generatedAt: new Date().toISOString(),
      command: "future",
      query: { fromDate, toDate, days, details: Boolean(flags.details) },
      filters: filterSummary,
      member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
      count: filteredRecords.length,
      records: filteredRecords,
    };
    const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

    if (!isJsonMode(flags)) {
      await writeOutput(outputPayload, flags, (value) => {
        const lines = [`Future workouts (${value.count}) ${value.query.fromDate}..${value.query.toDate}`];
        if (hasAgentRecordTransforms(flags)) {
          for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
          lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
          return lines.join("\n");
        }
        for (const item of value.records) {
          if (flags.details) {
            lines.push(
              `- ${toIsoDateFromPlanned(item)} ${item.name || "(untitled)"} | id=${item.id} | tss=${item.tss} | duration=${item.durationInSeconds}s`,
            );
          } else {
            lines.push(`- ${toIsoDateFromPlanned(item)} id=${item.id} type=${item.type} tss=${item.tss}`);
          }
        }
        return lines.join("\n");
      });
      return;
    }
    await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
    return;
  }

  const records = sortByDateAsc(
    context.publicDays.filter(
      (day) => day.date >= fromDate && day.date <= toDate && day.plannedTssTotal > 0,
    ),
  );
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags);
  const payload = {
    mode: "public",
    generatedAt: new Date().toISOString(),
    command: "future",
    query: { fromDate, toDate, days, details: Boolean(flags.details) },
    filters: filterSummary,
    member: { username: context.targetUsername },
    count: filteredRecords.length,
    records: filteredRecords,
    limitations: [
      "Public mode returns day-level planned TSS only.",
      "Detailed workout names/durations are unavailable in public mode.",
    ],
  };
  const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

  if (!isJsonMode(flags)) {
    await writeOutput(outputPayload, flags, (value) => {
      const lines = [
        `Future plan signal (${value.count}) ${value.query.fromDate}..${value.query.toDate} [public mode]`,
      ];
      if (hasAgentRecordTransforms(flags)) {
        for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
        lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
        lines.push(`Limitations: ${value.limitations.join(" ")}`);
        return lines.join("\n");
      }
      for (const day of value.records) {
        lines.push(
          `- ${day.date} plannedTss=${day.plannedTssTotal} (TR=${day.plannedTssTrainerRoad}, other=${day.plannedTssOther})`,
        );
      }
      lines.push(`Limitations: ${value.limitations.join(" ")}`);
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
}

export async function commandPast(flags, deps) {
  const {
    requireNumber,
    normalizeDateOnlyInput,
    isoDateShift,
    resolveQueryContext,
    filterPastActivities,
    applyAgentRecordFilters,
    toRecordsOnlyPayload,
    isJsonMode,
    writeOutput,
    hasAgentRecordTransforms,
    sortByDateDesc,
    summarizeActivityTime,
  } = deps;

  const days = requireNumber(flags.days, 60);
  const limit = requireNumber(flags.limit, 30);
  const fromDate = normalizeDateOnlyInput(flags.from, isoDateShift(-days));
  const toDate = normalizeDateOnlyInput(flags.to, isoDateShift(0));
  if (toDate < fromDate) {
    throw new Error(`Invalid range: --to (${toDate}) is before --from (${fromDate}).`);
  }

  const context = await resolveQueryContext(flags);
  if (context.mode === "private") {
    const filtered = filterPastActivities(context.timeline.activities, fromDate, toDate).slice(0, limit);
    if (!flags.details) {
      const recordsWithLocalTime = addLocalTimeSummaryList(filtered, summarizeActivityTime);
      const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(recordsWithLocalTime, flags);
      const payload = {
        mode: "private",
        generatedAt: new Date().toISOString(),
        command: "past",
        query: { fromDate, toDate, days, limit, details: false },
        filters: filterSummary,
        member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
        count: filteredRecords.length,
        records: filteredRecords,
      };
      const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;
      if (!isJsonMode(flags)) {
        await writeOutput(outputPayload, flags, (value) => {
          const lines = [`Past workouts (${value.count}) ${value.query.fromDate}..${value.query.toDate}`];
          if (hasAgentRecordTransforms(flags)) {
            for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
            lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
            return lines.join("\n");
          }
          for (const item of value.records) {
            const overnightLabel = item.crossesMidnightLocal ? " | overnight=true" : "";
            lines.push(
              `- ${item.startedAtLocal ?? item.started} id=${item.id} type=${item.type} tss=${item.tss}${overnightLabel}`,
            );
          }
          return lines.join("\n");
        });
        return;
      }
      await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
      return;
    }

    const ids = filtered.map((item) => item.id);
    const details = await context.client.getActivitiesByIds(
      context.memberInfo.memberId,
      context.memberInfo.username,
      ids,
    );
    const personalRecords = await context.client.getPersonalRecordsByActivityIds(
      context.memberInfo.memberId,
      context.memberInfo.username,
      ids,
    );
    const detailRecords = details.map((item) => ({
      ...item,
      personalRecordCount: Array.isArray(personalRecords[item.id]) ? personalRecords[item.id].length : 0,
    }));
    const detailRecordsWithLocalTime = addLocalTimeSummaryList(detailRecords, summarizeActivityTime);
    const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(
      detailRecordsWithLocalTime,
      flags,
    );
    const payload = {
      mode: "private",
      generatedAt: new Date().toISOString(),
      command: "past",
      query: { fromDate, toDate, days, limit, details: true },
      filters: filterSummary,
      member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
      count: filteredRecords.length,
      records: filteredRecords,
      personalRecords,
    };
    const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

    if (!isJsonMode(flags)) {
      await writeOutput(outputPayload, flags, (value) => {
        const lines = [
          `Past workouts detailed (${value.count}) ${value.query.fromDate}..${value.query.toDate}`,
        ];
        if (hasAgentRecordTransforms(flags)) {
          for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
          lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
          return lines.join("\n");
        }
        for (const item of value.records) {
          const overnightLabel = item.crossesMidnightLocal ? " | overnight=true" : "";
          lines.push(
            `- ${item.startedAtLocal ?? item.started} ${item.name} | id=${item.id} | tss=${item.tss} | duration=${item.durationInSeconds}s | prs=${item.personalRecordCount}${overnightLabel}`,
          );
        }
        return lines.join("\n");
      });
      return;
    }
    await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
    return;
  }

  const records = sortByDateDesc(
    context.publicDays.filter(
      (day) => day.date >= fromDate && day.date <= toDate && (day.hasRides || day.tss > 0),
    ),
  ).slice(0, limit);
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags);
  const payload = {
    mode: "public",
    generatedAt: new Date().toISOString(),
    command: "past",
    query: { fromDate, toDate, days, limit, details: Boolean(flags.details) },
    filters: filterSummary,
    member: { username: context.targetUsername },
    count: filteredRecords.length,
    records: filteredRecords,
    limitations: [
      "Public mode returns day-level historical load signals only.",
      "Detailed completed workout records are unavailable in public mode.",
    ],
  };
  const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

  if (!isJsonMode(flags)) {
    await writeOutput(outputPayload, flags, (value) => {
      const lines = [
        `Past load signal (${value.count}) ${value.query.fromDate}..${value.query.toDate} [public mode]`,
      ];
      if (hasAgentRecordTransforms(flags)) {
        for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
        lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
        lines.push(`Limitations: ${value.limitations.join(" ")}`);
        return lines.join("\n");
      }
      for (const day of value.records) {
        lines.push(
          `- ${day.date} tss=${day.tss} (TR=${day.tssTrainerRoad}, other=${day.tssOther}) hasRides=${day.hasRides}`,
        );
      }
      lines.push(`Limitations: ${value.limitations.join(" ")}`);
      return lines.join("\n");
    });
    return;
  }
  await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
}

export async function commandToday(flags, deps) {
  const {
    normalizeDateOnlyInput,
    isoDateShift,
    resolveQueryContext,
    filterFuturePlanned,
    filterPastActivities,
    applyAgentRecordFilters,
    toRecordsOnlyPayload,
    isJsonMode,
    writeOutput,
    hasAgentRecordTransforms,
    toIsoDateFromPlanned,
    summarizeActivityTime,
  } = deps;

  const today = normalizeDateOnlyInput(flags.date, isoDateShift(0));
  const context = await resolveQueryContext(flags);

  if (context.mode === "private") {
    const plannedToday = filterFuturePlanned(context.timeline.plannedActivities, today, today);
    const activitiesToday = filterPastActivities(context.timeline.activities, today, today);
    let plannedRecords = plannedToday;
    let activityRecords = activitiesToday;
    let personalRecords = {};

    if (flags.details) {
      plannedRecords = await context.client.getPlannedActivitiesByIds(
        context.memberInfo.memberId,
        context.memberInfo.username,
        plannedToday.map((item) => item.id),
      );
      activityRecords = await context.client.getActivitiesByIds(
        context.memberInfo.memberId,
        context.memberInfo.username,
        activitiesToday.map((item) => item.id),
      );
      personalRecords = await context.client.getPersonalRecordsByActivityIds(
        context.memberInfo.memberId,
        context.memberInfo.username,
        activitiesToday.map((item) => item.id),
      );
    }

    const completedWithLocalTime = addLocalTimeSummaryList(activityRecords, summarizeActivityTime);
    const records = [
      ...plannedRecords.map((item) => ({ recordType: "planned", ...item })),
      ...completedWithLocalTime.map((item) => ({
        recordType: "completed",
        ...item,
        personalRecordCount: Array.isArray(personalRecords[item.id]) ? personalRecords[item.id].length : 0,
      })),
    ];
    const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags);

    const payload = {
      mode: "private",
      generatedAt: new Date().toISOString(),
      command: "today",
      query: { date: today, details: Boolean(flags.details) },
      filters: filterSummary,
      member: { memberId: context.memberInfo.memberId, username: context.memberInfo.username },
      counts: { planned: plannedRecords.length, completed: completedWithLocalTime.length },
      planned: plannedRecords,
      completed: completedWithLocalTime,
      personalRecords,
      count: filteredRecords.length,
      records: filteredRecords,
    };
    const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

    if (!isJsonMode(flags)) {
      await writeOutput(outputPayload, flags, (value) => {
        const lines = [`Today (${value.query?.date ?? today})`];
        if (value.counts) {
          lines.push(`Planned: ${value.counts.planned}`);
          lines.push(`Completed: ${value.counts.completed}`);
        }
        if (
          hasAgentRecordTransforms(flags) ||
          flags["records-only"] ||
          !Array.isArray(value.planned) ||
          !Array.isArray(value.completed)
        ) {
          lines.push(`Filtered records: ${value.count}`);
          for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
          if (value.filters) {
            lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
          }
          return lines.join("\n");
        }
        for (const item of value.planned) {
          if (flags.details) {
            lines.push(`- planned ${toIsoDateFromPlanned(item)} ${item.name || "(untitled)"} | tss=${item.tss}`);
          } else {
            lines.push(`- planned id=${item.id} type=${item.type} tss=${item.tss}`);
          }
        }
        for (const item of value.completed) {
          if (flags.details) {
            const prs = Array.isArray(value.personalRecords[item.id]) ? value.personalRecords[item.id].length : 0;
            const overnightLabel = item.crossesMidnightLocal ? " | overnight=true" : "";
            lines.push(
              `- completed ${item.startedAtLocal ?? item.started} ${item.name} | tss=${item.tss} | prs=${prs}${overnightLabel}`,
            );
          } else {
            const overnightLabel = item.crossesMidnightLocal ? " | overnight=true" : "";
            lines.push(
              `- completed ${item.startedAtLocal ?? item.started} id=${item.id} type=${item.type} tss=${item.tss}${overnightLabel}`,
            );
          }
        }
        return lines.join("\n");
      });
      return;
    }
    await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
    return;
  }

  const day = context.publicDays.find((item) => item.date === today) ?? null;
  const records = day ? [day] : [];
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(records, flags);
  const payload = {
    mode: "public",
    generatedAt: new Date().toISOString(),
    command: "today",
    query: { date: today, details: Boolean(flags.details) },
    filters: filterSummary,
    member: { username: context.targetUsername },
    counts: { days: day ? 1 : 0 },
    day,
    count: filteredRecords.length,
    records: filteredRecords,
    limitations: [
      "Public mode provides day-level load/plan signal only.",
      "No workout-level detail without authentication.",
    ],
  };
  const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;

  if (!isJsonMode(flags)) {
    await writeOutput(outputPayload, flags, (value) => {
      const dayCandidate =
        value.day ?? (Array.isArray(value.records) && value.records.length === 1 ? value.records[0] : null);
      if (!dayCandidate && !hasAgentRecordTransforms(flags) && !flags["records-only"]) {
        return `Today (${value.query?.date ?? today}) [public mode]\n- No day-level record returned.`;
      }
      if (hasAgentRecordTransforms(flags)) {
        const lines = [`Today (${value.query?.date ?? today}) [public mode]`, `Filtered records: ${value.count}`];
        for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
        if (value.filters) {
          lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
        }
        lines.push(`Limitations: ${value.limitations.join(" ")}`);
        return lines.join("\n");
      }
      return [
        `Today (${value.query?.date ?? today}) [public mode]`,
        `- tss=${dayCandidate.tss} (TR=${dayCandidate.tssTrainerRoad}, other=${dayCandidate.tssOther})`,
        `- plannedTss=${dayCandidate.plannedTssTotal} (TR=${dayCandidate.plannedTssTrainerRoad}, other=${dayCandidate.plannedTssOther})`,
        `- hasRides=${dayCandidate.hasRides}`,
        `Limitations: ${value.limitations.join(" ")}`,
      ].join("\n");
    });
    return;
  }
  await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
}
