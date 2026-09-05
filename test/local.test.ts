import { Effect, FileSystem, Stream } from "effect"
import { describe, expect, it, vi } from "vitest"
import { makeInvoke, lines } from "./harness.ts"
import { rasterize } from "../src/services/local-transport.mjs"

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="10" height="5" fill="#29a8e0"/></svg>'
const member = { memberId: 42, username: "fixture" }
const file = "/fake/workout.svg"
function fixture() {
  const files = new Map<string, Uint8Array>()
  const writes: string[] = []
  let stdinReads = 0
  const remote = {
    login: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
    chart: vi.fn<() => Promise<{ member: typeof member; url: string; svg: string }>>(async () => ({
      member,
      url: "https://www.trainerroad.com/chart.svg",
      svg,
    })),
    rasterize,
  }
  const filesystem = FileSystem.layerNoop({
    exists: (path) => Effect.sync(() => files.has(path)),
    readFile: (path) => Effect.sync(() => files.get(path)!),
    remove: (path) =>
      Effect.sync(() => {
        writes.push(path)
        files.delete(path)
      }),
    makeDirectory: () => Effect.void,
    writeFile: (path, bytes, options) =>
      Effect.sync(() => {
        expect(options?.flag).toBe("wx")
        if (files.has(path)) throw new Error("test refuses overwrite")
        writes.push(path)
        files.set(path, bytes)
      }),
  })
  const invoke = makeInvoke(
    () => {
      throw new Error("no calendar calls")
    },
    undefined,
    {
      remote,
      filesystem,
      stdio: {
        stdin: Stream.suspend(() => {
          stdinReads++
          return Stream.make(new TextEncoder().encode("FIXTURE_PASSWORD\n"))
        }),
      },
    },
  )
  return {
    invoke,
    files,
    writes,
    remote,
    get stdinReads() {
      return stdinReads
    },
  }
}

describe("local mutations", () => {
  it("plans login without reading a password or writing a session", async () => {
    const test = fixture()
    const result = await test.invoke(["login", "--username", "fixture", "--password-stdin"])
    expect(result.code).toBe(4)
    expect(result.stdout).not.toContain("FIXTURE_PASSWORD")
    expect(test.stdinReads).toBe(0)
    expect(test.remote.login).not.toHaveBeenCalled()
    expect(test.writes).toEqual([])
    const applied = await test.invoke(lines(result.stdout)[0]!.confirmation.confirmArgs)
    expect(applied.code).toBe(0)
    expect(test.remote.login).toHaveBeenCalledOnce()
    expect(test.remote.login.mock.calls[0]).toContain("FIXTURE_PASSWORD")
    expect(applied.stdout).not.toContain("FIXTURE_PASSWORD")
  })

  it("rejects stale session confirmation without authenticating", async () => {
    const test = fixture()
    const plan = await test.invoke([
      "login",
      "--username",
      "fixture",
      "--session-file",
      "/fake/session",
      "--password-stdin",
    ])
    test.files.set("/fake/session", new Uint8Array([1]))
    const result = await test.invoke(lines(plan.stdout)[0]!.confirmation.confirmArgs)
    expect(lines(result.stdout)[0]!.error.code).toBe("stale_confirmation")
    expect(test.remote.login).not.toHaveBeenCalled()
    expect(test.stdinReads).toBe(0)
  })

  it("previews logout and removes only the confirmed session", async () => {
    const test = fixture()
    test.files.set("/fake/session", new Uint8Array([1]))
    const plan = await test.invoke(["logout", "--session-file", "/fake/session"])
    expect(plan.code).toBe(4)
    expect(test.writes).toEqual([])
    const result = await test.invoke(lines(plan.stdout)[0]!.confirmation.confirmArgs)
    expect(result.code).toBe(0)
    expect(test.writes).toEqual(["/fake/session"])
  })

  it("previews an SVG export then writes the confirmed bytes", async () => {
    const test = fixture()
    const plan = await test.invoke(["workout-image", "--id", "88", "--file", file])
    expect(plan.code).toBe(4)
    expect(test.writes).toEqual([])
    const result = await test.invoke(lines(plan.stdout)[0]!.confirmation.confirmArgs)
    expect(result.code).toBe(0)
    expect(new TextDecoder().decode(test.files.get(file))).toBe(svg)
    expect(lines(result.stdout)[0]!.data.imageFormat).toBe("svg")
  })

  it("refuses an existing destination before fetching a chart", async () => {
    const test = fixture()
    test.files.set(file, new Uint8Array([1]))
    const result = await test.invoke(["workout-image", "--id", "88", "--file", file, "--yes"])
    expect(lines(result.stdout)[0]!.error.code).toBe("resource_conflict")
    expect(test.remote.chart).not.toHaveBeenCalled()
    expect(test.writes).toEqual([])
  })

  it("rejects a chart that changes after confirmation", async () => {
    const test = fixture()
    const plan = await test.invoke(["workout-image", "--id", "88", "--file", file])
    test.remote.chart.mockResolvedValue({
      member,
      url: "https://www.trainerroad.com/chart.svg",
      svg: svg + " ",
    })
    const result = await test.invoke(lines(plan.stdout)[0]!.confirmation.confirmArgs)
    expect(lines(result.stdout)[0]!.error.code).toBe("stale_confirmation")
    expect(test.writes).toEqual([])
  })

  it("renders PNG using the optional renderer", async () => {
    const test = fixture()
    const result = await test.invoke([
      "workout-image",
      "--id",
      "88",
      "--file",
      "/fake/workout.png",
      "--width",
      "100",
      "--yes",
    ])
    expect(result.code).toBe(0)
    expect([...test.files.get("/fake/workout.png")!.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ])
  })

  it.each([
    ["--id", "abc"],
    ["--id", "0"],
    ["--id", "88", "--image-format", "gif"],
    ["--id", "88", "--width", "9000"],
  ])("rejects invalid image arguments %j", async (...args) => {
    const test = fixture()
    const result = await test.invoke(["workout-image", ...args, "--yes"])
    expect(result.code).toBe(64)
    expect(test.remote.chart).not.toHaveBeenCalled()
    expect(test.writes).toEqual([])
  })
})
