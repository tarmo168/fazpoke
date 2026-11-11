/**
 * Which night the Sessions page shows.
 *
 * The latest session is the highest session number. When numbers are
 * missing, the most recent date wins, then the later entry in the list.
 * A hash such as #/sessions/1 picks that night. Other hashes are unchanged.
 */

import { isIsoDate } from "./liveboard.js";
import { sessionNumberOf } from "./sheets.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateOf(session) {
  return isIsoDate(session?.date) ? session.date : "";
}

export function formatSessionDate(iso) {
  if (!isIsoDate(iso)) return "";
  const day = Number(iso.slice(8, 10));
  const month = Number(iso.slice(5, 7));
  return `${day} ${MONTHS[month - 1]} ${iso.slice(0, 4)}`;
}

export function formatSessionDay(iso) {
  if (!isIsoDate(iso)) return "";
  const day = Number(iso.slice(8, 10));
  const month = Number(iso.slice(5, 7));
  return `${day} ${MONTHS[month - 1]}`;
}

export function sessionHeading(session) {
  const label = session?.label || "Session";
  const date = formatSessionDate(session?.date);
  return date ? `${label} · ${date}` : label;
}

export function sessionTabLabel(session) {
  const number = sessionNumberOf(session);
  const name = number != null ? `S${number}` : (session?.label || "Session");
  const day = formatSessionDay(session?.date);
  return day ? `${name} · ${day}` : name;
}

export function sessionHash(session) {
  const number = sessionNumberOf(session);
  const token = number != null ? String(number) : String(session?.id || "");
  return `#/sessions/${encodeURIComponent(token)}`;
}

function rankOf(session, index) {
  const number = sessionNumberOf(session);
  const date = dateOf(session);
  return {
    numbered: number != null ? 1 : 0,
    number: number ?? 0,
    dated: date ? 1 : 0,
    date,
    index,
  };
}

function laterThan(candidate, current) {
  if (candidate.numbered !== current.numbered) return candidate.numbered > current.numbered;
  if (candidate.number !== current.number) return candidate.number > current.number;
  if (candidate.dated !== current.dated) return candidate.dated > current.dated;
  if (candidate.date !== current.date) return candidate.date > current.date;
  return candidate.index > current.index;
}

export function latestSessionIndex(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  let best = -1;
  let bestRank = null;
  for (let index = 0; index < list.length; index++) {
    const rank = rankOf(list[index], index);
    if (best < 0 || laterThan(rank, bestRank)) {
      best = index;
      bestRank = rank;
    }
  }
  return best;
}

function digitsOnly(text) {
  if (!text) return false;
  for (const char of text) {
    if (char < "0" || char > "9") return false;
  }
  return true;
}

function matchSession(list, requested) {
  if (requested == null || requested === "") return -1;
  const text = String(requested);
  const asNumber = digitsOnly(text) ? Number(text) : null;
  for (let index = 0; index < list.length; index++) {
    const session = list[index];
    if (session?.id === text) return index;
    if (asNumber != null && sessionNumberOf(session) === asNumber) return index;
  }
  return -1;
}

export function resolveSessionIndex(sessions, requested) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return -1;
  const match = matchSession(list, requested);
  if (match >= 0) return match;
  return latestSessionIndex(list);
}

export function showSessionTabs(sessions) {
  return Array.isArray(sessions) && sessions.length > 1;
}

/** View model for the Sessions page: one night, latest unless a hash names another. */
export function sessionPage(sessions, requested) {
  const list = Array.isArray(sessions) ? sessions : [];
  const index = resolveSessionIndex(list, requested);
  const session = index >= 0 ? list[index] : null;
  return {
    index,
    session,
    showTabs: showSessionTabs(list),
    heading: session ? sessionHeading(session) : "",
    tabs: list.map((item, itemIndex) => ({
      id: item.id,
      label: sessionTabLabel(item),
      selected: itemIndex === index,
      hash: sessionHash(item),
    })),
  };
}

export function parseHash(hash) {
  let text = String(hash || "");
  if (text.startsWith("#")) text = text.slice(1);
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the raw text when the hash is not valid encoding.
  }
  const parts = text.split("/").filter(Boolean);
  if (parts[0] === "player" && parts[1]) {
    return { name: "player", id: parts[1], section: "", session: "" };
  }
  if (parts[0] === "live") return { name: "live", section: "", session: "" };
  if (parts[0] === "sessions") {
    return { name: "home", section: "ledger", session: parts[1] || "" };
  }
  return { name: "home", section: parts[0] || "", session: "" };
}
