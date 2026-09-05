import { describe, expect, it } from "vitest"
import type { Transport } from "../src/services/transport.mjs"
import { lines, makeInvoke } from "./harness.ts"
import { runOperation } from "../src/services/operation-transport.mjs"

const member = { memberId: 42, username: "fixture-rider" }
const row = (day = 10) => ({
  id: "planned-123",
  date: { year: 2026, month: 9, day },
  workout: { id: 88, name: "Fixture workout", isOutside: false },
  canMove: true,
})
const moveArgs = [
  "move-workout",
  "--id",
  "planned-123",
  "--to",
  "2026-09-12",
  "--session-file",
  "/fake/session.json",
]

const noop = () => {}

function fixture() {
  let current = row()
  let account = member
  let loggedIn = true
  let memberResponse: unknown
  let plannedResponse: unknown
  let timeline: unknown = { plannedActivities: [row(30), row(1), row(10)] }
  let readError: unknown
  let failWrite = false
  let failVerification = false
  let memberReads = 0
  let plannedReads = 0
  let beforeRead = noop
  let beforeMember = noop
  const writes: Array<{ id: string; to: string }> = []
  const sessions: Array<string> = []
  const signals: Array<AbortSignal> = []
  const factory = (sessionFile: string): Transport => {
    sessions.push(sessionFile)
    return {
      load: async () => loggedIn,
      member: async (signal) => {
        signals.push(signal)
        memberReads++
        beforeMember()
        if (readError !== undefined) throw readError
        return memberResponse ?? account
      },
      timeline: async (_id, _username, signal) => {
        signals.push(signal)
        return timeline
      },
      planned: async (_id, _username, signal) => {
        signals.push(signal)
        plannedReads++
        beforeRead()
        if (failVerification && writes.length > 0) throw new Error("response lost")
        return plannedResponse ?? current
      },
      move: async (id, to, _username, signal) => {
        signals.push(signal)
        writes.push({ id, to })
        const [year, month, day] = to.split("-").map(Number)
        current = { ...current, date: { year: year!, month: month!, day: day! } }
        if (failWrite) throw new Error("session-cookie-must-not-leak")
        return {}
      },
    }
  }
  return {
    invoke: makeInvoke(factory, (name, flags, phase, now, signal, expected) =>
      runOperation(name, flags, phase, now, signal, expected, () => ({
        loadSession: async () => {
          sessions.push(String(flags["session-file"]))
          return loggedIn
        },
        getMemberInfo: async () => account,
        getTimeline: async () => timeline,
      })),
    ),
    writes,
    sessions,
    signals,
    get plannedReads() {
      return plannedReads
    },
    get memberReads() {
      return memberReads
    },
    setDate: (day: number) => {
      current = row(day)
    },
    setAccount: () => {
      account = { memberId: 99, username: "different-rider" }
    },
    setLoggedOut: () => {
      loggedIn = false
    },
    setMemberResponse: (value: unknown) => {
      memberResponse = value
    },
    setPlannedResponse: (value: unknown) => {
      plannedResponse = value
    },
    setTimeline: (value: unknown) => {
      timeline = value
    },
    setReadError: (value: unknown) => {
      readError = value
    },
    setWriteFailure: () => {
      failWrite = true
    },
    setVerificationFailure: () => {
      failVerification = true
    },
    onPlannedRead: (run: () => void) => {
      beforeRead = run
    },
    onMemberRead: (run: () => void) => {
      beforeMember = run
    },
  }
}

describe("authenticated reads", () => {
  it("decodes the account and does not expose session content", async () => {
    const test = fixture()
    const result = await test.invoke(["whoami", "--session-file", "/fake/session.json"])
    expect(result.code).toBe(0)
    expect(lines(result.stdout)[0]!.data).toEqual(member)
    expect(test.sessions).toEqual(["/fake/session.json"])
    expect(test.signals[0]).toBeInstanceOf(AbortSignal)
    expect(test.writes).toEqual([])
  })

  it("refuses a missing session before requesting an account", async () => {
    const test = fixture()
    test.setLoggedOut()
    const result = await test.invoke(["whoami"])
    expect(result.code).toBe(77)
    expect(lines(result.stdout)[0]!.error.code).toBe("auth_failure")
    expect(test.memberReads).toBe(0)
  })

  it.each([401, 403, 404, 429, 503])(
    "maps HTTP %s without disclosing response bodies",
    async (status) => {
      const test = fixture()
      test.setReadError({ status, message: "SECRET_COOKIE", payload: "SECRET_COOKIE" })
      const result = await test.invoke(["whoami"])
      expect(result.code).not.toBe(0)
      expect(result.stdout).not.toContain("SECRET_COOKIE")
      expect(lines(result.stdout)[0]!.error.fix).toBeTruthy()
    },
  )

  it("rejects an unexpected account response", async () => {
    const test = fixture()
    test.setMemberResponse({ memberId: "SECRET_WITHOUT_USERNAME" })
    const result = await test.invoke(["whoami"])
    expect(lines(result.stdout)[0]!.error.code).toBe("invalid_data")
    expect(result.stdout).not.toContain("SECRET_WITHOUT_USERNAME")
  })

  it("filters inclusively, sorts, and projects calendar rows", async () => {
    const test = fixture()
    const result = await test.invoke([
      "future",
      "--from",
      "2026-09-10",
      "--to",
      "2026-09-30",
      "--fields",
      "id,date",
    ])
    expect(result.code).toBe(0)
    expect(lines(result.stdout)[0]!.data).toEqual({
      count: 2,
      items: [
        { id: "planned-123", date: { year: 2026, month: 9, day: 10 } },
        { id: "planned-123", date: { year: 2026, month: 9, day: 30 } },
      ],
    })
    expect(test.writes).toEqual([])
  })

  it("streams rows followed by a terminal summary", async () => {
    const result = await fixture().invoke(
      ["future", "--from", "2026-09-01", "--to", "2026-09-30"],
      "ndjson",
    )
    expect(lines(result.stdout, "ndjson").map((event) => event.event)).toEqual([
      "item",
      "item",
      "item",
      "summary",
    ])
  })

  it.each([
    ["future", "--days", "0"],
    ["future", "--from", "2026-02-30", "--to", "2026-03-01"],
    ["future", "--from", "2026-09-30", "--to", "2026-09-01"],
    ["future", "--from", "2026-09-01T00:00:00Z", "--to", "2026-09-30"],
    ["move-workout", "--to", "2026-09-12", "--yes"],
    [...moveArgs, "--dry-run", "--yes"],
  ])("rejects invalid arguments before API access: %j", async (...argv) => {
    const test = fixture()
    const result = await test.invoke(argv)
    expect(result.code).toBe(64)
    expect(test.sessions).toEqual([])
    expect(test.writes).toEqual([])
  })

  it("rejects malformed remote dates instead of normalizing them silently", async () => {
    const test = fixture()
    test.setTimeline({ plannedActivities: [{ ...row(), date: { year: 2026, month: 2, day: 30 } }] })
    const result = await test.invoke(["future", "--from", "2026-01-01", "--to", "2026-12-31"])
    expect(lines(result.stdout)[0]!.error.code).toBe("invalid_data")
  })
})

describe("confirmed calendar moves", () => {
  it("returns a plan and guides without writing, then applies its confirmation once", async () => {
    const test = fixture()
    const preview = await test.invoke(moveArgs)
    const first = lines(preview.stdout)[0]!
    expect(preview.code).toBe(4)
    expect(first.guides).toContain("calendar-changes")
    expect(test.writes).toEqual([])
    const result = await test.invoke(
      (first.confirmation.confirmArgs as string[]).filter((arg) => arg !== "--json"),
    )
    expect(result.code).toBe(0)
    const output = lines(result.stdout)[0]!
    expect(output.data.after.date).toBe("2026-09-12")
    expect(output.data.changed).toBe(true)
    expect(output.next[0].args).toContain("future")
    expect(output.warnings).toEqual([])
    expect(test.writes).toEqual([{ id: "planned-123", to: "2026-09-12" }])
  })

  it("dry-run never writes", async () => {
    const test = fixture()
    const result = await test.invoke([...moveArgs, "--dry-run"])
    expect(result.code).toBe(0)
    expect(lines(result.stdout)[0]!.data.dryRun).toBe(true)
    expect(test.writes).toEqual([])
  })

  it("a changed activity invalidates an earlier token", async () => {
    const test = fixture()
    const preview = await test.invoke(moveArgs)
    const token = lines(preview.stdout)[0]!.confirmation.token as string
    test.setDate(11)
    const result = await test.invoke([...moveArgs, "--confirm", token])
    expect(lines(result.stdout)[0]!.error.code).toBe("stale_confirmation")
    expect(test.writes).toEqual([])
  })

  it.each(["--yes", "-y"])("detects a race between planning and apply with %s", async (control) => {
    const test = fixture()
    test.onPlannedRead(() => {
      if (test.plannedReads === 2) test.setDate(11)
    })
    const result = await test.invoke([...moveArgs, control])
    expect(lines(result.stdout)[0]!.error.code).toBe("stale_confirmation")
    expect(test.writes).toEqual([])
    const next = lines(result.stdout)[0]!.next[0].args
    expect(next).not.toContain("--yes")
    expect(next).not.toContain("-y")
    const preview = await test.invoke(next)
    expect(preview.code).toBe(4)
    expect(test.writes).toEqual([])
  })

  it("refuses to write through a different account", async () => {
    const test = fixture()
    test.onMemberRead(() => {
      if (test.memberReads === 2) test.setAccount()
    })
    const result = await test.invoke([...moveArgs, "--yes"])
    expect(lines(result.stdout)[0]!.error.code).toBe("stale_confirmation")
    expect(test.writes).toEqual([])
  })

  it("treats the target date as a no-op", async () => {
    const test = fixture()
    test.setDate(12)
    const result = await test.invoke([...moveArgs, "--yes"])
    expect(result.code).toBe(0)
    expect(lines(result.stdout)[0]!.data.changed).toBe(false)
    expect(test.writes).toEqual([])
  })

  it("refuses a non-movable activity", async () => {
    const test = fixture()
    test.setPlannedResponse({ ...row(), canMove: false })
    const result = await test.invoke([...moveArgs, "--yes"])
    expect(lines(result.stdout)[0]!.error.code).toBe("invalid_data")
    expect(test.writes).toEqual([])
  })

  it("rejects an endpoint response for the wrong planned id", async () => {
    const test = fixture()
    test.setPlannedResponse({ ...row(), id: "other-planned-id" })
    const result = await test.invoke([...moveArgs, "--yes"])
    expect(lines(result.stdout)[0]!.error.code).toBe("invalid_data")
    expect(test.writes).toEqual([])
  })

  it.each(["write", "verification"])("does not retry an uncertain %s failure", async (phase) => {
    const test = fixture()
    if (phase === "write") test.setWriteFailure()
    else test.setVerificationFailure()
    const result = await test.invoke([...moveArgs, "--yes"])
    const output = lines(result.stdout)[0]!
    expect(result.code).toBe(73)
    expect(output.error.code).toBe("cannot_write")
    expect(output.error.transient).toBe(false)
    expect(output.error.fix).toContain("read the calendar")
    expect(result.stdout).not.toContain("session-cookie-must-not-leak")
    expect(test.writes).toHaveLength(1)
  })

  it("introspection and guides do not load a session", async () => {
    const test = fixture()
    const describeResult = await test.invoke(["describe"])
    const guideResult = await test.invoke(["guide", "get", "calendar-changes"])
    expect(describeResult.code).toBe(0)
    expect(guideResult.code).toBe(0)
    expect(guideResult.stdout).toContain("atomic conditional update")
    expect(test.sessions).toEqual([])
  })
})
