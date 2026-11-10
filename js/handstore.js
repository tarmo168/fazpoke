/**
 * Persistence for the live table.
 *
 * The default adapter writes JSON to localStorage. A remote backend implements
 * the same two methods and is passed to createHandStore. Google Sheets, via
 * an Apps Script web app, is one possible backend:
 *
 *   const sheets = {
 *     async read(key) {
 *       const response = await fetch(`${webAppUrl}?key=${encodeURIComponent(key)}`);
 *       if (response.status === 404) return null;
 *       if (!response.ok) throw new Error("read failed");
 *       return response.json();
 *     },
 *     async write(key, value) {
 *       const response = await fetch(webAppUrl, {
 *         method: "POST",
 *         headers: { "content-type": "application/json" },
 *         body: JSON.stringify({ key, value }),
 *       });
 *       if (!response.ok) throw new Error("write failed");
 *     },
 *   };
 *   const store = createHandStore(sheets);
 *
 * Logical keys are "seating", "hands", and "draft". The local adapter prefixes
 * them so they do not collide with anything else in the browser. Records do
 * not contain chip counts.
 */

import { SEAT_COUNT, STREETS } from "./handstats.js";

export const EXPORT_VERSION = 1;

const PREFIX = "fazpoke.live.";
const STREET_SET = new Set(STREETS);
const PHASES = new Set(["play", "pick"]);

function digits(value) {
  let number = 0;
  if (!value) return null;
  for (const char of value) {
    if (char < "0" || char > "9") return null;
    number = number * 10 + (char.charCodeAt(0) - 48);
  }
  return number;
}

export function isSessionDate(value) {
  if (typeof value !== "string" || value.length !== 10 || value[4] !== "-" || value[7] !== "-") return false;
  const year = digits(value.slice(0, 4));
  const month = digits(value.slice(5, 7));
  const day = digits(value.slice(8, 10));
  if (year == null || month == null || day == null) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function localSessionDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createHandId(now = Date.now(), rand = Math.random()) {
  const time = Math.floor(now).toString(36);
  const noise = Math.floor(rand * 1e9).toString(36);
  return `hand-${time}-${noise}`;
}

export function emptySeating(sessionDate = localSessionDate()) {
  return {
    sessionDate,
    buttonSeat: null,
    seats: Array.from({ length: SEAT_COUNT }, () => null),
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function memoryAdapter(seed = {}) {
  const box = {};
  for (const [key, value] of Object.entries(seed)) box[key] = cloneJson(value);
  return {
    async read(key) {
      return box[key] === undefined ? null : cloneJson(box[key]);
    },
    async write(key, value) {
      if (value == null) delete box[key];
      else box[key] = cloneJson(value);
    },
  };
}

export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

export function storageAvailable(storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    const key = `${PREFIX}probe`;
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function localStorageAdapter(storage = globalThis.localStorage) {
  return {
    async read(key) {
      const raw = storage.getItem(PREFIX + key);
      if (raw == null || raw === "") return null;
      return JSON.parse(raw);
    },
    async write(key, value) {
      const full = PREFIX + key;
      if (value == null) storage.removeItem(full);
      else storage.setItem(full, JSON.stringify(value));
    },
  };
}

export function normalizeSeating(value, sessionDate = localSessionDate()) {
  const seating = emptySeating(sessionDate);
  if (!value || typeof value !== "object" || Array.isArray(value)) return seating;
  if (isSessionDate(value.sessionDate)) {
    seating.sessionDate = value.sessionDate;
  }
  if (Array.isArray(value.seats)) {
    const seen = new Set();
    for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
      const playerId = value.seats[seat];
      if (typeof playerId !== "string" || !playerId || seen.has(playerId)) continue;
      seen.add(playerId);
      seating.seats[seat] = playerId;
    }
  }
  const button = value.buttonSeat;
  if (Number.isInteger(button) && button >= 0 && button < SEAT_COUNT && seating.seats[button]) {
    seating.buttonSeat = button;
  }
  return seating;
}

function isStringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item);
}

export function normalizeHand(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (!isSessionDate(value.sessionDate)) return null;
  if (typeof value.timestamp !== "string" || Number.isNaN(Date.parse(value.timestamp))) return null;
  if (!Number.isInteger(value.buttonSeat) || value.buttonSeat < 0 || value.buttonSeat >= SEAT_COUNT) return null;
  if (!Array.isArray(value.seats) || value.seats.length === 0) return null;
  const seen = new Set();
  const seats = [];
  for (const seat of value.seats) {
    if (!seat || typeof seat !== "object") return null;
    if (!Number.isInteger(seat.seat) || seat.seat < 0 || seat.seat >= SEAT_COUNT) return null;
    if (typeof seat.playerId !== "string" || !seat.playerId) return null;
    if (seen.has(seat.playerId) || seen.has(seat.seat)) return null;
    seen.add(seat.playerId);
    seen.add(seat.seat);
    seats.push({ seat: seat.seat, playerId: seat.playerId });
  }
  if (!Array.isArray(value.actions)) return null;
  const actions = [];
  for (const action of value.actions) {
    if (!action || typeof action.playerId !== "string" || !STREET_SET.has(action.street)) return null;
    actions.push({ playerId: action.playerId, street: action.street });
  }
  if (!Array.isArray(value.vpip)) return null;
  const vpip = [];
  for (const row of value.vpip) {
    if (!row || typeof row.playerId !== "string" || typeof row.entered !== "boolean") return null;
    vpip.push({ playerId: row.playerId, entered: row.entered });
  }
  if (!isStringList(value.reachedShowdown || [])) return null;
  if (!isStringList(value.winners || [])) return null;
  if (!Array.isArray(value.reachedShowdown) || !Array.isArray(value.winners)) return null;
  if (value.endStreet != null && !STREET_SET.has(value.endStreet)) return null;

  const hand = {
    id: value.id,
    sessionDate: value.sessionDate,
    timestamp: value.timestamp,
    buttonSeat: value.buttonSeat,
    seats,
    actions,
    vpip,
    reachedShowdown: [...value.reachedShowdown],
    winners: [...value.winners],
  };
  if (STREET_SET.has(value.endStreet)) hand.endStreet = value.endStreet;
  return hand;
}

function isHandState(value) {
  if (!value || typeof value !== "object") return false;
  if (!STREET_SET.has(value.street) || !PHASES.has(value.phase)) return false;
  if (!Array.isArray(value.folds) || !Array.isArray(value.winners)) return false;
  if (!value.folds.every((fold) => fold && typeof fold.playerId === "string" && STREET_SET.has(fold.street))) {
    return false;
  }
  if (!value.winners.every((id) => typeof id === "string")) return false;
  if (!value.vpip || typeof value.vpip !== "object" || Array.isArray(value.vpip)) return false;
  return true;
}

export function normalizeDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = { hand: null, undo: [], lastCommit: null };
  if (value.hand != null) {
    if (!isHandState(value.hand)) return null;
    draft.hand = {
      street: value.hand.street,
      phase: value.hand.phase,
      folds: value.hand.folds.map((fold) => ({ playerId: fold.playerId, street: fold.street })),
      winners: [...value.hand.winners],
      vpip: { ...value.hand.vpip },
      result: null,
    };
  }
  if (value.undo != null) {
    if (!Array.isArray(value.undo) || !value.undo.every((item) => isHandState(item))) return null;
    draft.undo = value.undo.map((item) => ({
      street: item.street,
      phase: item.phase,
      folds: item.folds.map((fold) => ({ playerId: fold.playerId, street: fold.street })),
      winners: [...item.winners],
      vpip: { ...item.vpip },
      result: null,
    }));
  }
  if (value.lastCommit != null) {
    const commit = value.lastCommit;
    if (!commit || typeof commit !== "object") return null;
    if (typeof commit.id !== "string" || !commit.id) return null;
    if (!isHandState(commit.handBefore)) return null;
    if (!Array.isArray(commit.undoStack) || !commit.undoStack.every((item) => isHandState(item))) return null;
    if (!(commit.buttonSeat == null || (Number.isInteger(commit.buttonSeat) && commit.buttonSeat >= 0 && commit.buttonSeat < SEAT_COUNT))) {
      return null;
    }
    draft.lastCommit = {
      id: commit.id,
      buttonSeat: commit.buttonSeat ?? null,
      handBefore: {
        street: commit.handBefore.street,
        phase: commit.handBefore.phase,
        folds: commit.handBefore.folds.map((fold) => ({ playerId: fold.playerId, street: fold.street })),
        winners: [...commit.handBefore.winners],
        vpip: { ...commit.handBefore.vpip },
        result: null,
      },
      undoStack: commit.undoStack.map((item) => ({
        street: item.street,
        phase: item.phase,
        folds: item.folds.map((fold) => ({ playerId: fold.playerId, street: fold.street })),
        winners: [...item.winners],
        vpip: { ...item.vpip },
        result: null,
      })),
    };
  }
  if (!draft.hand && !draft.lastCommit) return null;
  return draft;
}

function handError(index, detail) {
  return new Error(`Hand ${index + 1} ${detail}`);
}

export function parseHandLog(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("That file is not a hand log.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("That file is not a hand log.");
  }
  if (payload.version !== EXPORT_VERSION) {
    throw new Error("That file uses an unsupported log version.");
  }
  if (!Array.isArray(payload.hands)) throw new Error("That file has no hand list.");
  const hands = payload.hands.map((hand, index) => {
    const clean = normalizeHand(hand);
    if (!clean) throw handError(index, "could not be read.");
    return clean;
  });
  const ids = new Set();
  for (let index = 0; index < hands.length; index += 1) {
    if (ids.has(hands[index].id)) throw handError(index, "repeats an id already in the file.");
    ids.add(hands[index].id);
  }
  let seating;
  if ("seating" in payload && payload.seating != null) {
    if (typeof payload.seating !== "object" || Array.isArray(payload.seating)) {
      throw new Error("Seating in that file could not be read.");
    }
    seating = normalizeSeating(payload.seating);
  }
  return { version: EXPORT_VERSION, hands, seating: seating ?? null };
}

export function createHandStore(adapter) {
  let memory = false;
  let used = adapter;
  if (!used) {
    if (storageAvailable()) used = localStorageAdapter();
    else {
      used = memoryAdapter();
      memory = true;
    }
  }

  async function write(key, value) {
    try {
      await used.write(key, value);
    } catch {
      throw new Error("The log could not be saved on this device.");
    }
  }

  return {
    memory,
    async getSeating() {
      const raw = await used.read("seating");
      return normalizeSeating(raw);
    },
    async putSeating(seating) {
      const clean = normalizeSeating(seating, seating?.sessionDate || localSessionDate());
      await write("seating", clean);
      return clean;
    },
    async getHands() {
      const raw = await used.read("hands");
      if (!Array.isArray(raw)) return [];
      const hands = [];
      const ids = new Set();
      for (const item of raw) {
        const hand = normalizeHand(item);
        if (!hand || ids.has(hand.id)) continue;
        ids.add(hand.id);
        hands.push(hand);
      }
      return hands;
    },
    async putHands(hands) {
      const clean = [];
      const ids = new Set();
      for (let index = 0; index < hands.length; index += 1) {
        const hand = normalizeHand(hands[index]);
        if (!hand) throw handError(index, "could not be saved.");
        if (ids.has(hand.id)) throw handError(index, "repeats an id already in the log.");
        ids.add(hand.id);
        clean.push(hand);
      }
      await write("hands", clean);
      return clean;
    },
    async getDraft() {
      const raw = await used.read("draft");
      return normalizeDraft(raw);
    },
    async putDraft(draft) {
      if (draft == null) {
        await write("draft", null);
        return null;
      }
      const clean = normalizeDraft(draft);
      if (!clean) throw new Error("The hand in progress could not be saved.");
      await write("draft", clean);
      return clean;
    },
    async exportJSON() {
      const seating = normalizeSeating(await used.read("seating"));
      const hands = await this.getHands();
      return JSON.stringify({
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        seating,
        hands,
      }, null, 2);
    },
    async importJSON(text) {
      const parsed = parseHandLog(text);
      await write("hands", parsed.hands);
      if (parsed.seating) await write("seating", parsed.seating);
      await write("draft", null);
      return {
        hands: parsed.hands,
        seating: parsed.seating,
      };
    },
  };
}
