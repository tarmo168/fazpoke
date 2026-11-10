/**
 * Plain-text messages and LINE share links.
 *
 * Figures in a results message come from the same lines as Copy results.
 * Nothing here is a currency amount.
 */

import { formatNight, formatResultsText, isIsoDate, localDate } from "./liveboard.js";

export const SITE_URL = "https://tarmo168.github.io/fazpoke/";

export const LIVE_BOARD_URL = "https://tarmo168.github.io/fazpoke/#/live";

const EN_DASH = "\u2013";

export function lineItShareUrl(pageUrl = SITE_URL) {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(pageUrl)}`;
}

export function lineTextShareUrl(text) {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

export function leaderboardShareText(pageUrl = SITE_URL) {
  return `Fazwazpoker leaderboard\n${pageUrl}`;
}

export function leaderboardShareData(pageUrl = SITE_URL) {
  return {
    title: "Fazwazpoker",
    text: "Fazwazpoker leaderboard",
    url: pageUrl,
  };
}

export function resultsShareData(text) {
  return { title: "Fazwazpoker", text };
}

/**
 * Header, then the same player lines Copy results uses, then the site link.
 * `isoDate` is the night on the live board. An unusable date omits the day.
 */
export function formatResultsShareText(rows, isoDate, pageUrl = SITE_URL) {
  const dateLabel = formatNight(isoDate);
  const header = dateLabel ? `Fazwazpoker ${EN_DASH} ${dateLabel}` : "Fazwazpoker";
  const lines = formatResultsText(rows || []);
  return [header, lines, pageUrl].filter((part) => part !== "").join("\n");
}

function oneLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The soonest date an invite can use. Today counts. */
export function nextUpcomingDate(now = new Date()) {
  return localDate(now);
}

export function isInviteDateAllowed(iso, now = new Date()) {
  return isIsoDate(iso) && iso >= nextUpcomingDate(now);
}

export function formatInviteText({
  isoDate,
  time = "",
  location = "",
  liveUrl = LIVE_BOARD_URL,
} = {}) {
  const dateLabel = formatNight(isoDate);
  const clock = oneLine(time);
  const place = oneLine(location);
  const when = [dateLabel, clock].filter(Boolean).join(" ");
  const lines = ["\u2660 Fazwazpoker game night"];
  if (when) lines.push(when);
  if (place) lines.push(place);
  lines.push("Who's in? Reply with \u{1F64B}");
  lines.push(`Live board: ${liveUrl}`);
  return lines.join("\n");
}

export function canWebShare(nav = globalThis.navigator) {
  return typeof nav?.share === "function";
}

/**
 * Asks the browser to share. "aborted" means the person closed the sheet.
 * Pass `nav` in tests. The live page uses the real navigator.
 */
export async function shareNative(data, nav = globalThis.navigator) {
  if (typeof nav?.share !== "function") return "unavailable";
  try {
    await nav.share(data);
    return "shared";
  } catch (error) {
    if (error?.name === "AbortError") return "aborted";
    return "failed";
  }
}
