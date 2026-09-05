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
  }
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
  }
}

export async function commandTimeline(flags, deps) {
  const { resolveQueryContext, sortByDateAsc, isoDateShift } = deps
  const context = await resolveQueryContext(flags)
  if (context.mode === "private") {
    const payload = {
      ...summarizePrivateTimeline(context.memberInfo, context.timeline),
      timeline: flags.full ? context.timeline : undefined,
    }

    return payload
  }

  const payload = {
    ...summarizePublicTimeline(context.targetUsername, context.publicDays, isoDateShift(0)),
    days: flags.full ? sortByDateAsc(context.publicDays) : undefined,
  }

  return payload
}
