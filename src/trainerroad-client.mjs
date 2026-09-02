import fs from "node:fs/promises";
import path from "node:path";
import { normalizeTimeZone, toDateOnlyInTimeZone } from "./lib/timezone.mjs";

const BASE_URL = "https://www.trainerroad.com";
const APP_URL = `${BASE_URL}/app`;
const DEFAULT_USER_AGENT =
  "trainerroad-cli/0.1 (unofficial; personal data export; +https://www.trainerroad.com)";
const JSON_FORMAT_HEADER = "trainerroad-jsonformat";
const AUTH_COOKIE = "SharedTrainerRoadAuth";

function lowerFirst(key) {
  return key.length > 0 ? key[0].toLowerCase() + key.slice(1) : key;
}

/**
 * TrainerRoad serialises with PascalCase keys unless the `trainerroad-jsonformat: camel-case`
 * header is honoured. Every consumer in this CLI expects camelCase, so if a payload comes back
 * PascalCase anyway (header dropped, endpoint changed) the first letter of each key is lowered.
 * Payloads that are already camelCase pass through untouched.
 */
export function camelizeKeys(value) {
  if (Array.isArray(value)) return value.map((item) => camelizeKeys(item));
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[lowerFirst(key)] = camelizeKeys(inner);
  }
  return out;
}

export function looksPascalCase(value) {
  const sample = Array.isArray(value) ? value.find((item) => item && typeof item === "object") : value;
  if (!sample || typeof sample !== "object") return false;
  const keys = Object.keys(sample);
  return keys.length > 0 && keys.every((key) => /^[A-Z]/.test(key));
}

export class HttpError extends Error {
  constructor(message, { status, statusText = "", path = "", payload = null } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.path = path;
    this.payload = payload;
  }
}

export function isHttpStatus(error, status) {
  return error instanceof HttpError && error.status === status;
}

function ensureLeadingSlash(value) {
  if (!value.startsWith("/")) return `/${value}`;
  return value;
}

function toApiDateOnly(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
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
    // The web app sends this on every API call; without it responses come back PascalCase.
    if (!headers.has(JSON_FORMAT_HEADER)) headers.set(JSON_FORMAT_HEADER, "camel-case");
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
      throw new HttpError(
        `Request failed: ${response.status} ${response.statusText} for ${urlOrPath} -> ${detail}`,
        { status: response.status, statusText: response.statusText, path: urlOrPath, payload },
      );
    }
    return looksPascalCase(payload) ? camelizeKeys(payload) : payload;
  }

  async login({
    username = this.username,
    password = this.password,
    returnPath = username ? `/app/career/${username}` : "/app/career",
  } = {}) {
    if (!username || !password) {
      throw new Error("Username and password are required for login.");
    }

    const normalizedReturnPath = ensureLeadingSlash(returnPath);

    // The current web app authenticates through a JSON endpoint. The older server-rendered form
    // flow is kept as a fallback so the CLI keeps working if that route disappears again.
    const jsonResult = await this.#loginJson({ username, password, returnPath: normalizedReturnPath });
    if (jsonResult.handled) return this.#finishLogin(jsonResult.redirect);

    return this.#loginLegacyForm({ username, password, returnPath: normalizedReturnPath });
  }

  async #loginJson({ username, password, returnPath }) {
    const loginPath = "/app/api/login/login";
    const response = await this.#request(loginPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        referer: `${APP_URL}/login`,
      },
      body: JSON.stringify({ username, password, returnUrl: returnPath }),
      redirect: "manual",
    });
    const text = await response.text();
    let payload;
    try {
      payload = camelizeKeys(JSON.parse(text));
    } catch {
      return { handled: false };
    }
    if (response.status === 404 || response.status === 405 || payload === null || typeof payload !== "object") {
      return { handled: false };
    }
    if (payload.success === true || this.jar.has(AUTH_COOKIE)) {
      return { handled: true, redirect: payload.redirectUrl ?? "" };
    }
    if (payload.success === false) {
      throw new Error("Login failed: TrainerRoad rejected the username or password.");
    }
    throw new Error(
      `Login failed: unexpected response from ${loginPath} (status ${response.status}): ${text.slice(0, 300)}`,
    );
  }

  async #loginLegacyForm({ username, password, returnPath }) {
    const loginPath = `/app/login?ReturnUrl=${encodeURIComponent(returnPath)}`;

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
      throw new Error(
        "Login failed: the JSON login API did not answer and the login page has no __RequestVerificationToken form. TrainerRoad may have changed its login flow again.",
      );
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

    return this.#finishLogin(response.headers.get("location") ?? "");
  }

  async #finishLogin(redirect) {
    if (!this.jar.has(AUTH_COOKIE)) {
      throw new Error(`Login succeeded, but the ${AUTH_COOKIE} cookie is missing.`);
    }
    await this.saveSession({
      authenticatedAt: new Date().toISOString(),
      lastLoginRedirect: redirect,
    });
    return {
      ok: true,
      redirect,
      hasAuthCookie: this.jar.has(AUTH_COOKIE),
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

  async getAllUserPlans(memberId, usernameForReferer) {
    return this.#requestJson(`/app/api/plan-builder/${encodeURIComponent(memberId)}/all-user-plans`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getCurrentCustomPlan(memberId, usernameForReferer) {
    return this.#requestJson(
      `/app/api/plan-builder/current-custom-plan/${encodeURIComponent(memberId)}`,
      {
        headers: {
          "trainerroad-jsonformat": "camel-case",
          referer: `${APP_URL}/career/${usernameForReferer}`,
        },
      },
    );
  }

  async getPlanPhases(memberId, usernameForReferer) {
    return this.#requestJson(`/app/api/plan-builder/${encodeURIComponent(memberId)}/plan-phases`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
    });
  }

  async getCareerSummary(memberId, usernameForReferer) {
    return this.#requestJson(`/app/api/career/${memberId}/new`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        referer: `${APP_URL}/career/${usernameForReferer}`,
      },
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

  async getWorkoutProfilesByZone(usernameForReferer = null) {
    return this.#requestJson("/app/api/workouts/workout-profiles-by-zone", {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/workouts/list`,
        ...(usernameForReferer ? { "x-trainerroad-username": usernameForReferer } : {}),
      },
    });
  }

  async searchWorkoutLibrary(predicate, usernameForReferer = null) {
    return this.#requestJson("/app/api/workouts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "no-cache",
        referer: `${APP_URL}/workouts/list`,
        ...(usernameForReferer ? { "x-trainerroad-username": usernameForReferer } : {}),
      },
      body: JSON.stringify(predicate),
    });
  }

  async getWorkoutsByIds(workoutIds, usernameForReferer = null) {
    return this.#requestJson("/app/api/workouts/by-id", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/workouts/list`,
        ...(usernameForReferer ? { "x-trainerroad-username": usernameForReferer } : {}),
      },
      body: JSON.stringify(workoutIds),
    });
  }

  async getWorkoutSummary(workoutId, usernameForReferer = null) {
    return this.#requestJson(`/app/api/workouts/${encodeURIComponent(workoutId)}/summary`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/workouts/list`,
        ...(usernameForReferer ? { "x-trainerroad-username": usernameForReferer } : {}),
      },
    });
  }

  async getWorkoutLevels(workoutId, usernameForReferer = null) {
    return this.#requestJson(`/app/api/workouts/${encodeURIComponent(workoutId)}/levels`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/workouts/list`,
        ...(usernameForReferer ? { "x-trainerroad-username": usernameForReferer } : {}),
      },
    });
  }

  async getWorkoutChartData(workoutId, usernameForReferer = null) {
    return this.#requestJson(`/app/api/workouts/${encodeURIComponent(workoutId)}/chart-data`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/workouts/list`,
        ...(usernameForReferer ? { "x-trainerroad-username": usernameForReferer } : {}),
      },
    });
  }

  async getWorkoutInformation(workoutIds, usernameForReferer = null) {
    const ids = (Array.isArray(workoutIds) ? workoutIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    const params = new URLSearchParams({ ids: ids.join(",") });
    return this.#requestJson(`/app/api/workout-information?${params.toString()}`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/cycling/train-now`,
        ...(usernameForReferer ? { "x-trainerroad-username": usernameForReferer } : {}),
      },
    });
  }

  async getTrainNowStatus(usernameForReferer = null) {
    return this.#requestJson("/app/api/train-now", {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/cycling/train-now`,
        ...(usernameForReferer ? { "x-trainerroad-username": usernameForReferer } : {}),
      },
    });
  }

  async getTrainNowSuggestions({ duration, numSuggestions = 10 } = {}, usernameForReferer = null) {
    return this.#requestJson("/app/api/train-now", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "no-cache",
        referer: `${APP_URL}/cycling/train-now`,
        ...(usernameForReferer ? { "x-trainerroad-username": usernameForReferer } : {}),
      },
      body: JSON.stringify({ duration, numSuggestions }),
    });
  }

  async tryAddWorkoutToCalendar(
    workoutId,
    dateIso,
    { timeOfDay = null, isManualComplete = false, outside = false, usernameForReferer } = {},
  ) {
    const attempts = [
      {
        endpoint: "react-calendar",
        path: "/app/api/react-calendar/planned-tr-workout",
        body: {
          date: toApiDateOnly(dateIso),
          time: timeOfDay,
          workoutId: Number(workoutId),
          type: outside ? 1 : 0,
          recommendationReason: null,
        },
      },
      {
        endpoint: "legacy-plannedactivities",
        path: "/app/api/calendar/plannedactivities/workout",
        body: {
          id: Number(workoutId),
          date: dateIso,
          timeOfDay,
          isManualComplete: Boolean(isManualComplete),
          recommendationReason: null,
        },
      },
    ];

    const results = [];
    for (const attempt of attempts) {
      const response = await this.#request(attempt.path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "trainerroad-jsonformat": "camel-case",
          "tr-cache-control": "no-cache",
          referer: `${APP_URL}/calendar/${usernameForReferer}`,
        },
        body: JSON.stringify(attempt.body),
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
      results.push({
        endpoint: attempt.endpoint,
        status: response.status,
        ok: response.ok,
        requestBody: attempt.body,
        response: payload,
      });
      if (response.ok) break;
    }
    return results;
  }

  async copyPlannedActivity(plannedActivityId, dateIso, usernameForReferer) {
    const response = await this.#request(
      `/app/api/calendar/plannedactivities/${encodeURIComponent(plannedActivityId)}/copy/${encodeURIComponent(dateIso)}`,
      {
        method: "POST",
        headers: {
          "trainerroad-jsonformat": "camel-case",
          "tr-cache-control": "no-cache",
          referer: `${APP_URL}/calendar/${usernameForReferer}`,
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Request failed: ${response.status} ${response.statusText} for copy planned activity -> ${text}`,
      );
    }

    const text = await response.text();
    if (!text) {
      return { ok: true, status: response.status, empty: true };
    }

    try {
      return JSON.parse(text);
    } catch {
      return { ok: true, status: response.status, raw: text };
    }
  }

  async getPlannedActivity(plannedActivityId, usernameForReferer) {
    return this.#requestJson(`/app/api/calendar/plannedactivities/${encodeURIComponent(plannedActivityId)}`, {
      headers: {
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "use-cache",
        referer: `${APP_URL}/calendar/${usernameForReferer}`,
      },
    });
  }

  async getPlannedActivityAlternates(plannedActivityId, category, usernameForReferer) {
    return this.#requestJson(
      `/app/api/calendar/plannedactivities/${encodeURIComponent(plannedActivityId)}/alternates/${encodeURIComponent(category)}`,
      {
        headers: {
          "trainerroad-jsonformat": "camel-case",
          "tr-cache-control": "use-cache",
          referer: `${APP_URL}/calendar/${usernameForReferer}`,
        },
      },
    );
  }

  async movePlannedActivity(plannedActivityId, newDateIso, usernameForReferer) {
    return this.#requestJson(`/app/api/react-calendar/planned-activity/${encodeURIComponent(plannedActivityId)}/move`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "trainerroad-jsonformat": "camel-case",
        "tr-cache-control": "no-cache",
        referer: `${APP_URL}/calendar/${usernameForReferer}`,
      },
      body: JSON.stringify({ newDate: toApiDateOnly(newDateIso) }),
    });
  }

  async replacePlannedActivityWithAlternate(
    plannedActivityId,
    alternateWorkoutId,
    { updateDuration = false, usernameForReferer } = {},
  ) {
    return this.#requestJson(
      `/app/api/react-calendar/planned-activity/${encodeURIComponent(plannedActivityId)}/replace-with-alternate`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "trainerroad-jsonformat": "camel-case",
          "tr-cache-control": "no-cache",
          referer: `${APP_URL}/calendar/${usernameForReferer}`,
        },
        body: JSON.stringify({
          alternateWorkoutId: Number(alternateWorkoutId),
          updateDuration: Boolean(updateDuration),
        }),
      },
    );
  }

  async switchPlannedActivityMode(plannedActivityId, mode, usernameForReferer) {
    const normalizedMode = String(mode ?? "").trim().toLowerCase();
    if (!["inside", "outside"].includes(normalizedMode)) {
      throw new Error(`Invalid mode "${mode}". Expected "inside" or "outside".`);
    }
    return this.#requestJson(
      `/app/api/react-calendar/planned-activity/${encodeURIComponent(plannedActivityId)}/switch-to-${normalizedMode}`,
      {
        method: "PUT",
        headers: {
          "trainerroad-jsonformat": "camel-case",
          "tr-cache-control": "no-cache",
          referer: `${APP_URL}/calendar/${usernameForReferer}`,
        },
      },
    );
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
