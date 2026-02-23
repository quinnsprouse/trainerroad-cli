import fs from "node:fs/promises";
import path from "node:path";
import { normalizeTimeZone, toDateOnlyInTimeZone } from "./lib/timezone.mjs";

const BASE_URL = "https://www.trainerroad.com";
const APP_URL = `${BASE_URL}/app`;
const DEFAULT_USER_AGENT =
  "trainerroad-cli/0.1 (unofficial; personal data export; +https://www.trainerroad.com)";

function ensureLeadingSlash(value) {
  if (!value.startsWith("/")) return `/${value}`;
  return value;
}

function plannedDateToIso(item) {
  const year = String(item.date?.year ?? "").padStart(4, "0");
  const month = String(item.date?.month ?? "").padStart(2, "0");
  const day = String(item.date?.day ?? "").padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export function filterFuturePlanned(plannedActivities, fromDateIso, toDateIso = null) {
  return plannedActivities.filter((item) => {
    const date = plannedDateToIso(item);
    if (date < fromDateIso) return false;
    if (toDateIso && date > toDateIso) return false;
    return true;
  });
}

export function filterPastActivities(activities, fromDateIso = null, toDateIso = null, timeZone = null) {
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  return activities
    .filter((item) => {
      const startedDate = toDateOnlyInTimeZone(item.started, resolvedTimeZone, {
        assumeUtcForOffsetlessDateTime: true,
      });
      if (!startedDate) return false;
      if (fromDateIso && startedDate < fromDateIso) return false;
      if (toDateIso && startedDate > toDateIso) return false;
      return true;
    })
    .sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime());
}

export class CookieJar {
  constructor(raw = {}) {
    this.cookies = new Map(Object.entries(raw));
  }

  static fromJson(value) {
    return new CookieJar(value ?? {});
  }

  toJson() {
    return Object.fromEntries(this.cookies.entries());
  }

  get(name) {
    return this.cookies.get(name);
  }

  has(name) {
    return this.cookies.has(name);
  }

  cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  applySetCookies(setCookieHeaders) {
    for (const setCookie of setCookieHeaders) {
      const firstSegment = setCookie.split(";")[0];
      const separator = firstSegment.indexOf("=");
      if (separator <= 0) continue;
      const name = firstSegment.slice(0, separator).trim();
      const value = firstSegment.slice(separator + 1).trim();
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }
}

export class TrainerRoadClient {
  constructor({
    username = null,
    password = null,
    userAgent = DEFAULT_USER_AGENT,
    sessionFile = path.resolve(".trainerroad", "session.json"),
  } = {}) {
    this.username = username;
    this.password = password;
    this.userAgent = userAgent;
    this.sessionFile = sessionFile;
    this.jar = new CookieJar();
  }

  async loadSession() {
    try {
      const raw = await fs.readFile(this.sessionFile, "utf8");
      const parsed = JSON.parse(raw);
      this.jar = CookieJar.fromJson(parsed.cookies ?? {});
      return true;
    } catch {
      return false;
    }
  }

  async saveSession(extra = {}) {
    const dir = path.dirname(this.sessionFile);
    await fs.mkdir(dir, { recursive: true });
    const payload = {
      cookies: this.jar.toJson(),
      updatedAt: new Date().toISOString(),
      ...extra,
    };
    await fs.writeFile(this.sessionFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  async clearSession() {
    this.jar = new CookieJar();
    try {
      await fs.unlink(this.sessionFile);
    } catch {
      // Ignore if no session file exists.
    }
  }

  async #request(urlOrPath, options = {}) {
    const url = urlOrPath.startsWith("http") ? urlOrPath : `${BASE_URL}${urlOrPath}`;
    const headers = new Headers(options.headers ?? {});
    headers.set("user-agent", this.userAgent);
    if (!headers.has("accept")) headers.set("accept", "application/json, text/plain, */*");
    const cookieHeader = this.jar.cookieHeader();
    if (cookieHeader) headers.set("cookie", cookieHeader);

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body ?? null,
      redirect: options.redirect ?? "follow",
    });

    const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
    this.jar.applySetCookies(setCookieHeaders);
    return response;
  }

  async #requestJson(urlOrPath, options = {}) {
    const response = await this.#request(urlOrPath, options);
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }

    if (!response.ok) {
      const detail =
        typeof payload === "object" && payload !== null
          ? JSON.stringify(payload)
          : String(payload);
      throw new Error(
        `Request failed: ${response.status} ${response.statusText} for ${urlOrPath} -> ${detail}`,
      );
    }
    return payload;
  }

  async login({
    username = this.username,
    password = this.password,
    returnPath = "/app/career/quinnsprouse",
  } = {}) {
    if (!username || !password) {
      throw new Error("Username and password are required for login.");
    }

    const normalizedReturnPath = ensureLeadingSlash(returnPath);
    const loginPath = `/app/login?ReturnUrl=${encodeURIComponent(normalizedReturnPath)}`;

    const loginPage = await this.#request(loginPath, {
      method: "GET",
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "manual",
    });
    const html = await loginPage.text();

    const tokenMatch = html.match(
      /name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/i,
    );
    const returnUrlMatch = html.match(/id="ReturnUrl"\s+name="ReturnUrl"\s+type="hidden"\s+value="([^"]+)"/i);

    if (!tokenMatch) {
      throw new Error("Could not locate __RequestVerificationToken on login page.");
    }
    if (!returnUrlMatch) {
      throw new Error("Could not locate ReturnUrl hidden input on login page.");
    }

    const form = new URLSearchParams({
      Username: username,
      Password: password,
      ReturnUrl: returnUrlMatch[1],
      __RequestVerificationToken: tokenMatch[1],
    });

    const response = await this.#request("/app/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: BASE_URL,
        referer: `${BASE_URL}${loginPath}`,
      },
      body: form.toString(),
      redirect: "manual",
    });

    if (!(response.status >= 300 && response.status < 400)) {
      const body = await response.text();
      throw new Error(`Login did not redirect. Status=${response.status}. Body preview=${body.slice(0, 300)}`);
    }

    if (!this.jar.has("SharedTrainerRoadAuth")) {
      throw new Error("Login redirect succeeded, but SharedTrainerRoadAuth cookie is missing.");
    }

    const location = response.headers.get("location") ?? "";
    await this.saveSession({
      authenticatedAt: new Date().toISOString(),
      lastLoginRedirect: location,
    });

    return {
      ok: true,
      redirect: location,
      hasAuthCookie: this.jar.has("SharedTrainerRoadAuth"),
    };
  }

  async getMemberInfo() {
    return this.#requestJson("/app/api/member-info", {
      headers: { "trainerroad-jsonformat": "camel-case" },
    });
  }

  async getPublicTssByUsername(username) {
    return this.#requestJson(`/app/api/tss/${encodeURIComponent(username)}`, {
      headers: { "trainerroad-jsonformat": "camel-case" },
    });
  }

  async getWeightHistory(memberId, usernameForReferer) {
    return this.#requestJson(`/app/api/weight-history/${memberId}/all`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getAllUserPlans(usernameForPath) {
    return this.#requestJson(`/app/api/plan-builder/${encodeURIComponent(usernameForPath)}/all-user-plans`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForPath}`,
      },
    });
  }

  async getCurrentCustomPlan(usernameForPath) {
    return this.#requestJson(
      `/app/api/plan-builder/current-custom-plan/${encodeURIComponent(usernameForPath)}`,
      {
        headers: {
          "trainerroad-jsonformat": "camel-case",
          referer: `${APP_URL}/career/${usernameForPath}`,
        },
      },
    );
  }

  async getPlanPhases(usernameForPath) {
    return this.#requestJson(`/app/api/plan-builder/${encodeURIComponent(usernameForPath)}/plan-phases`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForPath}`,
      },
    });
  }

  async getCareerSummary(usernameForPath) {
    return this.#requestJson(`/app/api/career/${encodeURIComponent(usernameForPath)}/new`, {
      headers: { "trainerroad-jsonformat": "camel-case" },
    });
  }

  async getCareerLevels(memberId, usernameForReferer) {
    return this.#requestJson(`/app/api/career/${memberId}/levels`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getAiFtpEligibility(memberId, usernameForReferer) {
    return this.#requestJson(`/app/api/ai-ftp-detection/can-use-ai-ftp/${memberId}`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getAiFtpFailureStatus(memberId, usernameForReferer) {
    return this.#requestJson(`/app/api/calendar/aiftp/${memberId}/ai-failure-status`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getPowerRanking(memberId, usernameForReferer) {
    const params = new URLSearchParams({ memberId: String(memberId) });
    return this.#requestJson(`/app/api/onboarding/power-ranking?${params.toString()}`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getOnboardingPersonalRecords({ startTimeIso = null, endTimeIso = null, usernameForReferer } = {}) {
    const params = new URLSearchParams();
    if (startTimeIso) params.set("startTime", startTimeIso);
    if (endTimeIso) params.set("endTime", endTimeIso);
    const query = params.toString();
    const pathWithQuery = query ? `/app/api/onboarding/personal-records?${query}` : "/app/api/onboarding/personal-records";
    return this.#requestJson(pathWithQuery, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getSeasons(memberId, usernameForReferer) {
    return this.#requestJson(`/app/api/seasons/${memberId}`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getPersonalRecordsForDateRange(
    memberId,
    usernameForReferer,
    { startDate, endDate, rowType = 101, indoorOnly = false, slot = 1 } = {},
  ) {
    if (!startDate || !endDate) {
      throw new Error("startDate and endDate are required (YYYY-MM-DD) for personal record date-range queries.");
    }

    const params = new URLSearchParams({
      rowType: String(rowType),
      indoorOnly: String(Boolean(indoorOnly)),
    });
    const payload = [
      {
        Slot: Number.isFinite(Number(slot)) ? Number(slot) : 1,
        StartDate: startDate,
        EndDate: endDate,
      },
    ];
    return this.#requestJson(
      `/app/api/personal-records/for-date-range/${memberId}?${params.toString()}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "trainerroad-jsonformat": "camel-case",
          referer: `${APP_URL}/career/${usernameForReferer}`,
        },
        body: JSON.stringify(payload),
      },
    );
  }

  async getTimeline(memberId, usernameForReferer) {
    return this.#requestJson(`/app/api/react-calendar/${memberId}/timeline`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getActivitiesByIds(memberId, usernameForReferer, activityIds) {
    if (activityIds.length === 0) return [];
    const batches = chunk(activityIds, 100);
    const results = [];
    for (const batch of batches) {
      const payload = await this.#requestJson(`/app/api/react-calendar/${memberId}/activities`, {
        headers: {
          "trainerroad-jsonformat": "camel-case",
          "tr-cache-control": "use-cache",
          referer: `${APP_URL}/career/${usernameForReferer}`,
          ids: batch.join(","),
        },
      });
      results.push(...payload);
    }
    return results;
  }

  async getPlannedActivitiesByIds(memberId, usernameForReferer, plannedIds) {
    if (plannedIds.length === 0) return [];
    const batches = chunk(plannedIds, 100);
    const results = [];
    for (const batch of batches) {
      const payload = await this.#requestJson(`/app/api/react-calendar/${memberId}/planned-activities`, {
        headers: {
          "trainerroad-jsonformat": "camel-case",
          "tr-cache-control": "use-cache",
          referer: `${APP_URL}/career/${usernameForReferer}`,
          ids: batch.join(","),
        },
      });
      results.push(...payload);
    }
    return results;
  }

  async getPersonalRecordsByActivityIds(memberId, usernameForReferer, activityIds) {
    if (activityIds.length === 0) return {};
    const batches = chunk(activityIds, 100);
    const merged = {};
    for (const batch of batches) {
      const payload = await this.#requestJson(`/app/api/react-calendar/${memberId}/personal-records`, {
        headers: {
          "trainerroad-jsonformat": "camel-case",
          "tr-cache-control": "use-cache",
          referer: `${APP_URL}/career/${usernameForReferer}`,
          ids: batch.join(","),
        },
      });
      Object.assign(merged, payload);
    }
    return merged;
  }
}
