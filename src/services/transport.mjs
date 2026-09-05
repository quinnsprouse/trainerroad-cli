import { TrainerRoadClient } from "../trainerroad-client.mjs"

export const createTransport = (sessionFile) => {
  const client = new TrainerRoadClient({ sessionFile })
  const run = (signal, action) => {
    client.signal = signal
    return action()
  }
  return {
    load: () => client.loadSession(),
    member: (signal) => run(signal, () => client.getMemberInfo()),
    timeline: (memberId, username, signal) =>
      run(signal, () => client.getTimeline(memberId, username, { fresh: true })),
    planned: (id, username, signal) =>
      run(signal, () => client.getPlannedActivity(id, username, { fresh: true })),
    move: (id, date, username, signal) =>
      run(signal, () => client.movePlannedActivity(id, date, username)),
  }
}
