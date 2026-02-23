import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const DEFAULT_TARGETS = [
  "https://www.trainerroad.com/app/career/quinnsprouse",
  "https://www.trainerroad.com/app/calendar",
  "https://www.trainerroad.com/app/career",
];

const username = process.env.TR_USERNAME ?? "";
const password = process.env.TR_PASSWORD ?? "";
const headed = process.env.TR_HEADED !== "0";
const waitAfterPageMs = Number(process.env.TR_WAIT_AFTER_PAGE_MS ?? "6000");
const outputDir =
  process.env.TR_OUTPUT_DIR ??
  path.resolve(
    "captures",
    new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19),
  );
const manualLoginMs = Number(process.env.TR_MANUAL_LOGIN_WAIT_MS ?? "120000");

const fromEnvTargets = (process.env.TR_TARGETS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const targets = fromEnvTargets.length > 0 ? fromEnvTargets : DEFAULT_TARGETS;

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

function redactHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (SENSITIVE_HEADER_KEYS.has(normalized)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = value;
  }
  return out;
}

function redactBody(text) {
  if (!text) return text;
  return text
    .replace(
      /("?(password|passwd|token|access_token|refresh_token|client_secret)"?\s*[:=]\s*")([^"&\s}]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/(password=)([^&]+)/gi, "$1[REDACTED]");
}

function hostIsTrainerRoad(rawUrl) {
  try {
    const { host } = new URL(rawUrl);
    return host === "trainerroad.com" || host.endsWith(".trainerroad.com");
  } catch {
    return false;
  }
}

function isInterestingUrl(rawUrl) {
  if (!hostIsTrainerRoad(rawUrl)) return false;
  const normalized = rawUrl.toLowerCase();
  if (normalized.includes(".js") || normalized.includes(".css") || normalized.includes(".svg")) {
    return false;
  }
  return true;
}

function looksLikeApi(rawUrl) {
  return /api|graphql|workout|calendar|career|ride|activity|athlete|plan/i.test(rawUrl);
}

async function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 5000);
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryFill(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 750 })) {
        await locator.fill(value);
        return true;
      }
    } catch {
      // Skip selector that is absent or detached.
    }
  }
  return false;
}

async function maybeLogin(page) {
  const currentUrl = page.url().toLowerCase();
  const passwordField = page.locator("input[type='password']");
  const hasPassword = (await passwordField.count()) > 0;
  const looksLoggedOut = currentUrl.includes("login") || currentUrl.includes("signin") || hasPassword;
  if (!looksLoggedOut) return;

  console.log("Login page detected.");

  if (username && password) {
    const userFilled = await tryFill(
      page,
      [
        "input[name='username']",
        "input[name='email']",
        "input[type='email']",
        "input[autocomplete='username']",
        "input[type='text']",
      ],
      username,
    );
    const passFilled = await tryFill(
      page,
      ["input[name='password']", "input[type='password']", "input[autocomplete='current-password']"],
      password,
    );

    if (userFilled && passFilled) {
      const submitCandidates = [
        "button[type='submit']",
        "button:has-text('Log In')",
        "button:has-text('Sign In')",
        "input[type='submit']",
      ];
      let submitted = false;
      for (const selector of submitCandidates) {
        const button = page.locator(selector).first();
        try {
          if (await button.isVisible({ timeout: 500 })) {
            await button.click();
            submitted = true;
            break;
          }
        } catch {
          // Try next selector.
        }
      }
      if (!submitted) {
        await page.keyboard.press("Enter");
      }
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    }
  }

  const stillOnLogin =
    page.url().toLowerCase().includes("login") ||
    page.url().toLowerCase().includes("signin") ||
    (await page.locator("input[type='password']").count()) > 0;
  if (stillOnLogin) {
    console.log(
      `Still on login flow. Waiting ${manualLoginMs / 1000}s for manual login in the headed browser...`,
    );
    await sleep(manualLoginMs);
  }
}

const records = [];
const apiRecords = [];
const seenUrls = new Set();

await fs.mkdir(outputDir, { recursive: true });
console.log(`Capture output: ${outputDir}`);

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({
  recordHar: {
    path: path.join(outputDir, "session.har"),
    mode: "minimal",
  },
});
const page = await context.newPage();

page.on("response", async (response) => {
  const request = response.request();
  const url = request.url();
  if (!isInterestingUrl(url)) return;

  const requestHeaders = redactHeaders(await request.allHeaders().catch(() => ({})));
  const responseHeaders = redactHeaders(await response.allHeaders().catch(() => ({})));
  const contentType = (responseHeaders["content-type"] ?? responseHeaders["Content-Type"] ?? "").toLowerCase();

  const record = {
    ts: new Date().toISOString(),
    url,
    method: request.method(),
    resourceType: request.resourceType(),
    requestHeaders,
    requestBody: redactBody(request.postData() ?? null),
    status: response.status(),
    responseHeaders,
  };

  if (contentType.includes("application/json")) {
    try {
      const body = await response.text();
      if (body.length <= 300_000) {
        record.responseBody = await safeJsonParse(body);
      } else {
        record.responseBody = `[omitted ${body.length} bytes]`;
      }
    } catch {
      record.responseBody = "[unavailable]";
    }
  }

  records.push(record);
  if (looksLikeApi(url)) {
    apiRecords.push(record);
  }
  seenUrls.add(url);
});

for (const target of targets) {
  console.log(`Navigating: ${target}`);
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
  await maybeLogin(page);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await sleep(waitAfterPageMs);
}

await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
await sleep(2000);

const cookies = (await context.cookies()).filter((cookie) =>
  cookie.domain.includes("trainerroad.com"),
);

const storage = await page
  .evaluate(() => ({
    localStorage: Object.fromEntries(Object.entries(localStorage)),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
    userAgent: navigator.userAgent,
  }))
  .catch(() => ({ localStorage: {}, sessionStorage: {}, userAgent: "unknown" }));

const urlList = Array.from(seenUrls).sort();
const apiUrlList = Array.from(new Set(apiRecords.map((record) => record.url))).sort();

await writeJson(path.join(outputDir, "all-records.json"), records);
await writeJson(path.join(outputDir, "api-records.json"), apiRecords);
await writeJson(path.join(outputDir, "cookies.json"), cookies);
await writeJson(path.join(outputDir, "storage.json"), storage);
await writeJson(path.join(outputDir, "urls.json"), urlList);
await writeJson(path.join(outputDir, "api-urls.json"), apiUrlList);

await browser.close();

console.log(`Captured ${records.length} TrainerRoad responses (${apiRecords.length} API-like).`);
console.log(`Files written under: ${outputDir}`);
