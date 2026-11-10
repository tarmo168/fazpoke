/**
 * Live leaderboard math for one night.
 *
 * A player's live result is their current stack minus the buy-in they have
 * put in tonight. A re-buy adds the same amount to the buy-in and the stack,
 * so the result stays put until the stack is counted again. Final nets are
 * those results. On a finished game they should sum to 0.
 *
 * Figures are plain whole numbers. Nothing here is a currency amount.
 */

import { formatAmount, formatSigned } from "./format.js";

export const NIGHT_KEY = "fazpoke.liveboard";

export const MAX_AMOUNT = 99999999;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function digits(value) {
  if (!value) return null;
  let number = 0;
  for (const char of value) {
    if (char < "0" || char > "9") return null;
    number = number * 10 + (char.charCodeAt(0) - 48);
  }
  return number;
}

function isWholeAmount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT;
}

export function localDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isIsoDate(value) {
  if (typeof value !== "string" || value.length !== 10 || value[4] !== "-" || value[7] !== "-") return false;
  const year = digits(value.slice(0, 4));
  const month = digits(value.slice(5, 7));
  const day = digits(value.slice(8, 10));
  if (year == null || month == null || day == null) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function formatNight(iso) {
  if (!isIsoDate(iso)) return "";
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const date = new Date(year, month - 1, day);
  return `${WEEKDAYS[date.getDay()]} ${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatClock(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hours >= 12 ? "pm" : "am";
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

export function playerCountLabel(count) {
  return count === 1 ? "1 player" : `${count} players`;
}

function onlyDigits(value) {
  if (!value) return false;
  for (const char of value) {
    if (char < "0" || char > "9") return false;
  }
  return true;
}

export function parseWhole(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim().replace(/,/g, "");
  if (!onlyDigits(trimmed)) return null;
  const value = Number(trimmed);
  return isWholeAmount(value) ? value : null;
}

export function liveResult(stack, buyIn) {
  if (!isWholeAmount(stack) || !isWholeAmount(buyIn)) {
    throw new TypeError("Live result needs whole numbers.");
  }
  return stack - buyIn;
}

export function totalInPlay(players) {
  return players.reduce((sum, player) => (
    isWholeAmount(player.buyIn) ? sum + player.buyIn : sum
  ), 0);
}

export function describePlayers(players, roster) {
  const byId = new Map((roster || []).map((player) => [player.id, player]));
  return players.map((player) => {
    const person = byId.get(player.playerId);
    return {
      ...player,
      name: person?.name || player.name || player.playerId,
      photo: person?.photo || player.photo || "",
    };
  });
}

export function rankPlayers(players) {
  return players
    .map((player) => ({
      ...player,
      name: player.name || player.playerId,
      net: liveResult(player.stack, player.buyIn),
    }))
    .sort((a, b) => (b.net - a.net) || a.name.localeCompare(b.name))
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

export function rankedField(players, roster) {
  return rankPlayers(describePlayers(players, roster));
}

export function balanceNote(players) {
  const sum = players.reduce((total, player) => total + liveResult(player.stack, player.buyIn), 0);
  if (sum === 0) return { sum, balanced: true, text: "Nets sum to 0." };
  return {
    sum,
    balanced: false,
    text: `Nets sum to ${formatSigned(sum)}. They should sum to 0.`,
  };
}

export function finalResults(players) {
  const rows = rankPlayers(players).map((player) => ({
    playerId: player.playerId,
    name: player.name,
    buyIn: player.buyIn,
    stack: player.stack,
    net: player.net,
    rank: player.rank,
  }));
  const balance = balanceNote(players);
  return { rows, netSum: balance.sum, balanced: balance.balanced, note: balance.text };
}

export function formatResultLine(name, buyIn, net) {
  return `${name} ${formatAmount(buyIn)} ${formatSigned(net)}`;
}

export function formatResultsText(rows) {
  return rows.map((row) => formatResultLine(row.name, row.buyIn, row.net)).join("\n");
}

function prefixedNumber(value, prefix) {
  if (typeof value !== "string" || !value.startsWith(prefix)) return null;
  const rest = value.slice(prefix.length);
  if (!onlyDigits(rest)) return null;
  return Number(rest);
}

export function nextSessionMeta(sessions) {
  let max = 0;
  for (const session of sessions || []) {
    const id = prefixedNumber(session?.id, "session-");
    const label = prefixedNumber(session?.label, "Session ");
    if (id != null) max = Math.max(max, id);
    if (label != null) max = Math.max(max, label);
  }
  const n = max + 1;
  return { id: `session-${n}`, label: `Session ${n}` };
}

export function sessionEntry(players, sessions) {
  const meta = nextSessionMeta(sessions);
  const { rows } = finalResults(players);
  return {
    id: meta.id,
    label: meta.label,
    entries: rows.map((row) => ({
      playerId: row.playerId,
      buyIn: row.buyIn,
      net: row.net,
    })),
  };
}

export function formatSessionJson(entry) {
  const lines = entry.entries.map((row) => {
    if (typeof row.playerId !== "string" || !row.playerId) throw new TypeError("playerId");
    if (!Number.isSafeInteger(row.buyIn) || !Number.isSafeInteger(row.net)) throw new TypeError("amount");
    return `    { "playerId": ${JSON.stringify(row.playerId)}, "buyIn": ${row.buyIn}, "net": ${row.net} }`;
  });
  return [
    "{",
    `  "id": ${JSON.stringify(entry.id)},`,
    `  "label": ${JSON.stringify(entry.label)},`,
    "  \"entries\": [",
    lines.join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
}

export function emptyNight(date = localDate()) {
  return { date, phase: "setup", updatedAt: null, players: [] };
}

export function canStart(players) {
  return players.length > 0 && players.every((player) => isWholeAmount(player.buyIn));
}

export function startGame(players) {
  if (!canStart(players)) return null;
  return players.map((player) => ({
    playerId: player.playerId,
    buyIn: player.buyIn,
    stack: player.buyIn,
  }));
}

export function dropPick(players, playerId) {
  return players.filter((player) => player.playerId !== playerId);
}

export function setBuyIn(players, playerId, buyIn) {
  if (typeof playerId !== "string" || !playerId || !isWholeAmount(buyIn)) return players;
  let found = false;
  const next = players.map((player) => {
    if (player.playerId !== playerId) return player;
    found = true;
    return { ...player, buyIn, stack: buyIn };
  });
  if (!found) next.push({ playerId, buyIn, stack: buyIn });
  return next;
}

export function setStack(players, playerId, stack) {
  if (!isWholeAmount(stack)) return players;
  let found = false;
  const next = players.map((player) => {
    if (player.playerId !== playerId) return player;
    found = true;
    return { ...player, stack };
  });
  return found ? next : players;
}

export function addRebuy(players, playerId, amount) {
  if (!isWholeAmount(amount) || amount <= 0) return players;
  let changed = false;
  const next = players.map((player) => {
    if (player.playerId !== playerId) return player;
    if (!isWholeAmount(player.buyIn) || !isWholeAmount(player.stack)) return player;
    const buyIn = player.buyIn + amount;
    const stack = player.stack + amount;
    if (!isWholeAmount(buyIn) || !isWholeAmount(stack)) return player;
    changed = true;
    return { ...player, buyIn, stack };
  });
  return changed ? next : players;
}

export function withDate(night, date) {
  if (!isIsoDate(date) || date === night.date) return night;
  return { ...night, date };
}

function nightPlayer(item, phase) {
  if (!item || typeof item !== "object") return null;
  if (typeof item.playerId !== "string" || !item.playerId) return null;
  if (phase === "setup") {
    if (item.buyIn == null) return { playerId: item.playerId, buyIn: null, stack: null };
    if (!isWholeAmount(item.buyIn)) return null;
    const stack = item.stack == null ? item.buyIn : item.stack;
    if (!isWholeAmount(stack)) return null;
    return { playerId: item.playerId, buyIn: item.buyIn, stack };
  }
  if (!isWholeAmount(item.buyIn) || !isWholeAmount(item.stack)) return null;
  return { playerId: item.playerId, buyIn: item.buyIn, stack: item.stack };
}

export function parseNight(raw) {
  let value = raw;
  if (typeof raw === "string") {
    if (!raw) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!isIsoDate(value.date)) return null;
  if (value.phase !== "setup" && value.phase !== "play" && value.phase !== "final") return null;
  if (!Array.isArray(value.players)) return null;
  const updatedAt = value.updatedAt == null
    ? null
    : (typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : null);
  if (value.updatedAt != null && updatedAt == null) return null;
  const seen = new Set();
  const players = [];
  for (const item of value.players) {
    const player = nightPlayer(item, value.phase);
    if (!player || seen.has(player.playerId)) return null;
    seen.add(player.playerId);
    players.push(player);
  }
  if (value.phase !== "setup" && players.length === 0) return null;
  return { date: value.date, phase: value.phase, updatedAt, players };
}
