function summarizePrivateTimeline(memberInfo, timeline) {
  return {
    mode: "private",
    generatedAt: new Date().toISOString(),
    member: { memberId: memberInfo.memberId, username: memberInfo.username },
    counts: {
      activities: timeline.activities.length,
      plannedActivities: timeline.plannedActivities.length,
      events: timeline.events.length,
    },
  };
}

function summarizePublicTimeline(targetUsername, publicDays, today) {
  return {
    mode: "public",
    generatedAt: new Date().toISOString(),
    member: { username: targetUsername },
    counts: {
      days: publicDays.length,
      rideDays: publicDays.filter((d) => d.hasRides || d.tss > 0).length,
      futurePlannedDays: publicDays.filter((d) => d.date >= today && d.plannedTssTotal > 0).length,
    },
    limitations: [
      "Public mode does not expose detailed workout records.",
      "Use authenticated private mode for full workout detail.",
    ],
  };
}

export async function commandTimeline(flags, deps) {
  const { resolveQueryContext, isJsonMode, writeOutput, sortByDateAsc, isoDateShift } = deps;
  const context = await resolveQueryContext(flags);
  if (context.mode === "private") {
    const payload = {
      ...summarizePrivateTimeline(context.memberInfo, context.timeline),
      timeline: flags.full ? context.timeline : undefined,
    };
    if (!isJsonMode(flags) && !flags.full) {
      await writeOutput(payload, flags, (value) => {
        return [
          `Mode: ${value.mode}`,
          `User: ${value.member.username} (${value.member.memberId})`,
          `Activities: ${value.counts.activities}`,
          `Planned: ${value.counts.plannedActivities}`,
          `Events: ${value.counts.events}`,
          "Tip: add --json for machine output or --full --json for full payload.",
        ].join("\n");
      });
      return;
    }
    await writeOutput(payload, { ...flags, json: !flags.jsonl });
    return;
  }

  const payload = {
    ...summarizePublicTimeline(context.targetUsername, context.publicDays, isoDateShift(0)),
    days: flags.full ? sortByDateAsc(context.publicDays) : undefined,
  };
  if (!isJsonMode(flags) && !flags.full) {
    await writeOutput(payload, flags, (value) => {
      return [
        `Mode: ${value.mode}`,
        `Profile: ${value.member.username}`,
        `Total days: ${value.counts.days}`,
        `Ride days: ${value.counts.rideDays}`,
        `Future planned days: ${value.counts.futurePlannedDays}`,
        `Limitations: ${value.limitations.join(" ")}`,
      ].join("\n");
    });
    return;
  }
  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}
