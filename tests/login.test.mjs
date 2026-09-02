import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TrainerRoadClient, camelizeKeys, looksPascalCase } from "../src/trainerroad-client.mjs";

async function tempSessionFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trcli-login-"));
  return path.join(dir, "session.json");
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const request = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(request);
    return handler(request);
  };
  return run(calls).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test("login posts JSON to /app/api/login/login and stores the auth cookie", async () => {
  const sessionFile = await tempSessionFile();
  await withFetch(
    (request) => {
      assert.equal(request.url, "https://www.trainerroad.com/app/api/login/login");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("content-type"), "application/json");
      assert.equal(request.headers.get("trainerroad-jsonformat"), "camel-case");
      assert.deepEqual(JSON.parse(request.body), {
        username: "quinnsprouse",
        password: "hunter2",
        returnUrl: "/app/career/quinnsprouse",
      });
      return jsonResponse(
        { success: true, redirectUrl: "/app/career/quinnsprouse" },
        { headers: { "set-cookie": "SharedTrainerRoadAuth=abc123; path=/; httponly" } },
      );
    },
    async (calls) => {
      const client = new TrainerRoadClient({ username: "quinnsprouse", password: "hunter2", sessionFile });
      const result = await client.login();
      assert.equal(calls.length, 1);
      assert.deepEqual(result, { ok: true, redirect: "/app/career/quinnsprouse", hasAuthCookie: true });
      const saved = JSON.parse(await fs.readFile(sessionFile, "utf8"));
      assert.equal(saved.cookies.SharedTrainerRoadAuth, "abc123");
      assert.ok(saved.authenticatedAt);
    },
  );
});

test("login accepts a PascalCase success payload", async () => {
  const sessionFile = await tempSessionFile();
  await withFetch(
    () =>
      jsonResponse(
        { Success: true, RedirectUrl: "/app/career/quinnsprouse" },
        { headers: { "set-cookie": "SharedTrainerRoadAuth=xyz; path=/" } },
      ),
    async () => {
      const client = new TrainerRoadClient({ username: "quinnsprouse", password: "hunter2", sessionFile });
      const result = await client.login();
      assert.equal(result.redirect, "/app/career/quinnsprouse");
      assert.equal(result.hasAuthCookie, true);
    },
  );
});

test("login reports rejected credentials without falling back to the form flow", async () => {
  const sessionFile = await tempSessionFile();
  await withFetch(
    () => jsonResponse({ success: false, redirectUrl: null }),
    async (calls) => {
      const client = new TrainerRoadClient({ username: "quinnsprouse", password: "wrong", sessionFile });
      await assert.rejects(() => client.login(), /rejected the username or password/);
      assert.equal(calls.length, 1);
      await assert.rejects(() => fs.access(sessionFile));
    },
  );
});

test("login falls back to the legacy form flow when the JSON route is gone", async () => {
  const sessionFile = await tempSessionFile();
  const formPage = `<form>
    <input name="__RequestVerificationToken" type="hidden" value="tok-1" />
    <input id="ReturnUrl" name="ReturnUrl" type="hidden" value="/app/career/quinnsprouse" />
  </form>`;
  await withFetch(
    (request) => {
      if (request.url.endsWith("/app/api/login/login")) {
        return new Response("Not Found", { status: 404 });
      }
      if (request.method === "GET") {
        return new Response(formPage, { status: 200, headers: { "content-type": "text/html" } });
      }
      assert.equal(request.url, "https://www.trainerroad.com/app/login");
      const form = new URLSearchParams(request.body);
      assert.equal(form.get("Username"), "quinnsprouse");
      assert.equal(form.get("__RequestVerificationToken"), "tok-1");
      return new Response(null, {
        status: 302,
        headers: { location: "/app/career/quinnsprouse", "set-cookie": "SharedTrainerRoadAuth=legacy; path=/" },
      });
    },
    async (calls) => {
      const client = new TrainerRoadClient({ username: "quinnsprouse", password: "hunter2", sessionFile });
      const result = await client.login();
      assert.equal(calls.length, 3);
      assert.deepEqual(result, { ok: true, redirect: "/app/career/quinnsprouse", hasAuthCookie: true });
    },
  );
});

test("login explains when neither flow is available", async () => {
  const sessionFile = await tempSessionFile();
  await withFetch(
    (request) =>
      request.url.endsWith("/app/api/login/login")
        ? new Response("Not Found", { status: 404 })
        : new Response("<html><body>react app</body></html>", { status: 200 }),
    async () => {
      const client = new TrainerRoadClient({ username: "quinnsprouse", password: "hunter2", sessionFile });
      await assert.rejects(() => client.login(), /changed its login flow/);
    },
  );
});

test("every API request sends the camel-case format header by default", async () => {
  await withFetch(
    (request) => {
      assert.equal(request.headers.get("trainerroad-jsonformat"), "camel-case");
      return jsonResponse({ memberId: 1, username: "athlete" });
    },
    async (calls) => {
      const client = new TrainerRoadClient({ sessionFile: "/dev/null" });
      await client.getMemberInfo();
      await client.getAllUserPlans(1, "athlete");
      await client.getPlanPhases(1, "athlete");
      assert.equal(calls.length, 3);
    },
  );
});

test("PascalCase payloads are normalised to camelCase when the format header is ignored", async () => {
  await withFetch(
    () =>
      jsonResponse([
        { Id: "p1", Name: "Plan", Start: "2026-05-31T00:00:00", Phases: [{ Id: 1, PlanName: "Base" }] },
      ]),
    async () => {
      const client = new TrainerRoadClient({ sessionFile: "/dev/null" });
      const plans = await client.getAllUserPlans(1, "athlete");
      assert.deepEqual(plans, [
        { id: "p1", name: "Plan", start: "2026-05-31T00:00:00", phases: [{ id: 1, planName: "Base" }] },
      ]);
    },
  );
});

test("camelizeKeys leaves camelCase payloads untouched and looksPascalCase is conservative", () => {
  const camel = { memberId: 1, nested: { planName: "x" }, list: [{ id: 2 }] };
  assert.deepEqual(camelizeKeys(camel), camel);
  assert.equal(looksPascalCase(camel), false);
  assert.equal(looksPascalCase({ MemberId: 1 }), true);
  assert.equal(looksPascalCase([{ Id: 1 }]), true);
  assert.equal(looksPascalCase({ MemberId: 1, username: "mixed" }), false);
  assert.equal(looksPascalCase([]), false);
  assert.equal(looksPascalCase("text"), false);
  assert.equal(looksPascalCase(null), false);
});

test("camelizeKeys normalises PascalCase objects nested inside a camelCase envelope", () => {
  const mixed = { results: [{ slot: 1, personalRecords: [{ Seconds: 5, Watts: 900, Ride: { Id: 1 } }] }] };
  assert.deepEqual(camelizeKeys(mixed), {
    results: [{ slot: 1, personalRecords: [{ seconds: 5, watts: 900, ride: { id: 1 } }] }],
  });
});
