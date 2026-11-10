/**
 * Google Sheet ledger.
 *
 * An empty SHEET_API_URL means the site uses data/sessions.json only.
 * A set URL is an Apps Script web app. Sessions from the sheet are merged
 * in by id. Saving sends text/plain so the browser skips the CORS preflight.
 */

import { SHEET_API_URL } from "./config.js";

let refresher = null;

function digits(value) {
  if (!value) return null;
  let number = 0;
  for (const char of value) {
    if (char < "0" || char > "9") return null;
    number = number * 10 + (char.charCodeAt(0) - 48);
    if (!Number.isSafeInteger(number)) return null;
  }
  return number;
}

export function sheetEnabled(url = SHEET_API_URL) {
  return typeof url === "string" && url.trim() !== "";
}

export function onLedgerRefresh(fn) {
  refresher = fn;
}

export function requestLedgerRefresh(saved) {
  return refresher ? refresher(saved) : Promise.resolve();
}

function prefixedNumber(value, prefix) {
  if (typeof value !== "string" || !value.startsWith(prefix)) return null;
  const number = digits(value.slice(prefix.length));
  return number != null && number > 0 ? number : null;
}

export function sessionNumberOf(session) {
  if (!session || typeof session !== "object") return null;
  const values = [];
  if (Number.isSafeInteger(session.number) && session.number > 0) values.push(session.number);
  const fromId = prefixedNumber(session.id, "session-");
  const fromLabel = prefixedNumber(session.label, "Session ");
  if (fromId != null) values.push(fromId);
  if (fromLabel != null) values.push(fromLabel);
  if (!values.length) return null;
  return Math.max(...values);
}

export function maxSessionNumber(sessions) {
  let max = 0;
  for (const session of sessions || []) {
    const number = sessionNumberOf(session);
    if (number != null) max = Math.max(max, number);
  }
  return max;
}

/** Next number is max(sheet, client base) + 1. Non-positive inputs count as 0. */
export function nextSessionNumber(sheetMax, base) {
  const sheet = Number.isSafeInteger(sheetMax) && sheetMax > 0 ? sheetMax : 0;
  const known = Number.isSafeInteger(base) && base > 0 ? base : 0;
  return Math.max(sheet, known) + 1;
}

function hasId(session) {
  return !!session && typeof session === "object" && typeof session.id === "string" && session.id !== "";
}

export function mergeSessions(fileSessions, sheetSessions) {
  const file = Array.isArray(fileSessions) ? fileSessions : [];
  const sheet = Array.isArray(sheetSessions) ? sheetSessions : [];
  const byId = new Map();
  const order = [];

  for (const session of [...file, ...sheet]) {
    if (!hasId(session) || byId.has(session.id)) continue;
    byId.set(session.id, { ...session });
    order.push(session.id);
  }

  const numbered = [];
  const plain = [];
  for (const id of order) {
    const session = byId.get(id);
    if (sessionNumberOf(session) == null) plain.push(session);
    else numbered.push(session);
  }
  numbered.sort((a, b) => sessionNumberOf(a) - sessionNumberOf(b) || a.id.localeCompare(b.id));
  return numbered.concat(plain);
}

function cleanEntry(entry) {
  if (!entry || typeof entry.playerId !== "string" || entry.playerId === "") return null;
  const buyIn = typeof entry.buyIn === "number" && Number.isFinite(entry.buyIn) ? entry.buyIn : null;
  let net = null;
  if (entry.net != null && entry.net !== "") {
    if (typeof entry.net !== "number" || !Number.isFinite(entry.net)) return null;
    net = entry.net;
  }
  return { playerId: entry.playerId, buyIn, net };
}

function isoDate(value) {
  if (typeof value !== "string" || value.length !== 10 || value[4] !== "-" || value[7] !== "-") return "";
  const year = digits(value.slice(0, 4));
  const month = digits(value.slice(5, 7));
  const day = digits(value.slice(8, 10));
  if (year == null || month == null || day == null) return "";
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return value;
}

export function normalizeSheetSessions(value) {
  if (!Array.isArray(value)) return [];
  const sessions = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const list = Array.isArray(item.entries) ? item.entries : item.results;
    if (!Array.isArray(list)) continue;
    const entries = [];
    let valid = true;
    for (const entry of list) {
      const clean = cleanEntry(entry);
      if (!clean) {
        valid = false;
        break;
      }
      entries.push(clean);
    }
    if (!valid) continue;
    const number = sessionNumberOf(item);
    const id = typeof item.id === "string" && item.id ? item.id : (number ? `session-${number}` : "");
    if (!id) continue;
    const label = typeof item.label === "string" && item.label
      ? item.label
      : (number ? `Session ${number}` : id);
    const session = { id, label, entries };
    if (number) session.number = number;
    const date = isoDate(item.date);
    if (date) session.date = date;
    sessions.push(session);
  }
  return sessions;
}

export function recordedNetSum(entries) {
  let sum = 0;
  let any = false;
  for (const entry of entries || []) {
    if (entry?.net == null) continue;
    if (typeof entry.net !== "number" || !Number.isFinite(entry.net)) return null;
    sum += entry.net;
    any = true;
  }
  return any ? sum : null;
}

export function netsBalance(entries) {
  return recordedNetSum(entries) === 0;
}

export function buildSessionPayload(players, date, base) {
  const number = nextSessionNumber(0, base);
  const entries = (players || []).map((player) => {
    if (!player || typeof player.playerId !== "string" || !player.playerId) {
      throw new TypeError("playerId");
    }
    if (typeof player.buyIn !== "number" || !Number.isFinite(player.buyIn)) {
      throw new TypeError("buyIn");
    }
    if (player.net != null && (typeof player.net !== "number" || !Number.isFinite(player.net))) {
      throw new TypeError("net");
    }
    return {
      playerId: player.playerId,
      buyIn: player.buyIn,
      net: player.net == null ? null : player.net,
    };
  });
  const session = {
    id: `session-${number}`,
    number,
    label: `Session ${number}`,
    entries,
  };
  const iso = isoDate(date);
  if (iso) session.date = iso;
  return session;
}

export function buildSaveBody({ pin, key, base, session }) {
  return {
    pin: typeof pin === "string" ? pin : "",
    key: typeof key === "string" ? key : "",
    base: Number.isSafeInteger(base) && base > 0 ? base : 0,
    session,
  };
}

export class SheetError extends Error {
  constructor(message, { pin = false } = {}) {
    super(message);
    this.name = "SheetError";
    this.pin = pin;
  }
}

function cacheBust(url) {
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}t=${Date.now()}`;
}

function errorFrom(data) {
  const message = data && typeof data.error === "string" && data.error.trim()
    ? data.error.trim()
    : "The session was not saved.";
  return new SheetError(message, { pin: /pin/i.test(message) });
}

function withTimeout(init) {
  if (typeof AbortSignal === "undefined" || !AbortSignal.timeout) return init;
  return { ...init, signal: AbortSignal.timeout(20000) };
}

async function fetchJson(url) {
  const response = await fetch(cacheBust(url), withTimeout({
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  }));
  if (!response.ok) throw new SheetError("The sheet could not be loaded.");
  const data = await response.json();
  if (!Array.isArray(data)) throw new SheetError("The sheet did not return sessions.");
  return data;
}

function fetchJsonp(url) {
  return new Promise((resolve, reject) => {
    const callback = `fazpokeSheet${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const script = document.createElement("script");
    let settled = false;
    const timer = setTimeout(() => finish(new SheetError("The sheet could not be loaded.")), 20000);

    function finish(error, data) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { delete window[callback]; } catch { /* already gone */ }
      script.remove();
      if (error) reject(error);
      else resolve(data);
    }

    window[callback] = (data) => finish(null, data);
    script.onerror = () => finish(new SheetError("The sheet could not be loaded."));
    script.src = `${cacheBust(url)}&callback=${encodeURIComponent(callback)}`;
    document.head.append(script);
  });
}

export async function loadSheetSessions(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return [];
  let payload;
  try {
    payload = await fetchJson(trimmed);
  } catch {
    payload = await fetchJsonp(trimmed);
  }
  if (!Array.isArray(payload)) throw new SheetError("The sheet did not return sessions.");
  return normalizeSheetSessions(payload);
}

export async function postSession(url, body) {
  let response;
  try {
    response = await fetch(String(url || "").trim(), withTimeout({
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    }));
  } catch {
    throw new SheetError("The session was not saved. Check the connection and retry.");
  }
  let data = null;
  try {
    data = JSON.parse(await response.text());
  } catch {
    throw new SheetError("The sheet did not accept the session.");
  }
  if (!response.ok || !data || data.ok !== true) throw errorFrom(data);
  if (!Number.isSafeInteger(data.sessionNumber) || data.sessionNumber <= 0) {
    throw new SheetError("The sheet did not accept the session.");
  }
  return data;
}
