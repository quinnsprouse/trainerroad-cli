import { TrainerRoadClient } from "../trainerroad-client.mjs"

export const createWorkflowTransport = (sessionFile) => {
  const client = new TrainerRoadClient({ sessionFile })
  let username = null
  return {
    load: () => client.loadSession(),
    member: async (signal) => {
      client.signal = signal
      const member = await client.getMemberInfo()
      username = typeof member?.username === "string" ? member.username : null
      return member
    },
    request: (request, signal, mutation) => {
      client.signal = signal
      return client.workflowRequest(request, mutation, username)
    },
  }
}
