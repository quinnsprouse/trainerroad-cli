import { expect, it } from "vitest"
import { contracts } from "../src/commands/index.ts"
import { describeCli, schemaDocument } from "../src/contract/jsonschema.ts"
import { surfaceOf } from "../src/contract/surface.ts"
import { finalizeGuidance } from "../src/contract/guidance.ts"
import { makeInvoke, lines } from "./harness.ts"

const invoke = makeInvoke(() => {
  throw new Error("discovery must not access an account")
})
const options = { binName: "trainerroad-cli", version: "test", contracts }

it.each(contracts.map((contract) => contract.name))(
  "discovers %s and its guides without account access",
  async (name) => {
    const result = await invoke(["describe", "--command", name])
    expect(result.code).toBe(0)
    const description = lines(result.stdout)[0]!.data
    expect(description.commands).toHaveLength(1)
    expect(description.commands[0].name).toBe(name)
    expect(description.guideTopics.map((topic: any) => topic.topic).toSorted()).toEqual(
      [...description.commands[0].guides].toSorted((a: string, b: string) => a.localeCompare(b)),
    )
    await Promise.all(
      description.commands[0].guides.map(async (topic: string) => {
        const guide = lines((await invoke(["guide", "get", topic])).stdout)[0]!
        expect(guide.data.commands).toContain(name)
        expect(guide.data.content.length).toBeGreaterThan(0)
      }),
    )
  },
)

it.each([
  ["describe", "--command", "missing"],
  ["guide", "get", "missing"],
])("recovers from a missing discovery target: %j", async (...args) => {
  const result = await invoke(args)
  const error = lines(result.stdout)[0]!
  expect(error.error.code).toBe("not_found")
  expect((await invoke(error.next[0].args)).code).toBe(0)
})

it("keeps schema and describe rosters aligned", () => {
  const description = describeCli(options)
  const schema = schemaDocument(options)
  expect(schema.commands.map((command) => command.name).toSorted()).toEqual(
    description.commands.map((command) => command.name).toSorted(),
  )
})

it.each([
  ["workout-details", "integer", "workout library"],
  ["annotation-details", "string", "Annotation id"],
  ["remove-annotation", "string", "Annotation id"],
  ["copy-workout", "string", "Planned activity id"],
])("identifies the right id namespace for %s", (name, type, description) => {
  const command = describeCli({ ...options, only: name }).commands[0]!
  const id = command.params.find((param) => param.cliName === "--id")!
  expect(id.required).toBe(true)
  expect(id.type).toBe(type)
  expect(id.description).toContain(description)
})

it("drops broken or excessive hints without invalidating a completed operation", () => {
  const guidance = finalizeGuidance(contracts.map(surfaceOf), {
    next: [
      { message: "invalid", args: ["made-up-command"] },
      { message: "invalid required flags", args: ["move-workout"] },
      { message: "inventory", args: ["describe", "--json"] },
      { message: "duplicate", args: ["describe", "--json"] },
      { message: "guides", args: ["guide", "list", "--json"] },
      { message: "schema", args: ["schema", "--json"] },
      { message: "too many", args: ["whoami", "--json"] },
    ],
    guides: ["session-and-ids", "session-and-ids", "missing"],
  })
  expect(guidance.next).toHaveLength(3)
  expect(guidance.guides).toEqual(["session-and-ids"])
  expect(guidance.warnings).toHaveLength(4)
})
