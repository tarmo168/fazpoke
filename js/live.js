import { avatar, el } from "./dom.js";
import { formatAmount, formatSigned, signedClass } from "./format.js";
import {
  NIGHT_KEY,
  addPlayer,
  addRebuy,
  balanceNote,
  canRemovePlayer,
  canStart,
  describePlayers,
  dropPick,
  emptyNight,
  formatClock,
  formatNight,
  formatSessionJson,
  localDate,
  parseNight,
  parseWhole,
  rankedField,
  removeBuyIn,
  removePlayer,
  sessionEntry,
  setBuyIn,
  setStack,
  startGame,
  totalInPlay,
  withDate,
} from "./liveboard.js";
import { SHEET_API_URL } from "./config.js";
import { openInvite } from "./invite.js";
import {
  canWebShare,
  formatResultsShareText,
  lineTextShareUrl,
  resultsShareData,
  shareNative,
} from "./share.js";
import {
  buildSaveBody,
  buildSessionPayload,
  maxSessionNumber,
  mergeSessions,
  postSession,
  requestLedgerRefresh,
  sheetEnabled,
} from "./sheets.js";

const OLD_KEYS = [
  "fazpoke.live.seating",
  "fazpoke.live.hands",
  "fazpoke.live.draft",
  "fazpoke.live.probe",
];

const PIN_KEY = "fazpoke.hostPin";
const SAVE_KEY = "fazpoke.liveboard.saveKey";

const PAD_COPY = {
  stack: { kicker: "Current stack", done: "Set stack" },
  rebuy: { kicker: "Re-buy", note: "Adds to the buy-in and the stack.", done: "Add re-buy" },
  fix: {
    kicker: "Remove buy-in",
    note: "Subtracts this amount from the buy-in and the stack. The result stays the same.",
    done: "Remove buy-in",
  },
  buyin: { kicker: "Starting buy-in", done: "Set buy-in" },
};

const view = {
  booted: false,
  container: null,
  roster: [],
  sessions: [],
  night: null,
  pad: null,
  padFocus: false,
  message: "",
  saveError: "",
  copyText: "",
  focusCopy: false,
  focus: "",
  focusPin: false,
  paintedPhase: "",
  nativeFullscreen: false,
  saveStatus: "",
  sheetMessage: "",
  pinDraft: "",
};

let listening = false;
let saving = false;

function personOf(playerId) {
  return view.roster.find((player) => player.id === playerId) || {
    id: playerId,
    name: playerId,
    photo: "",
  };
}

function pickOf(playerId) {
  return view.night.players.find((player) => player.playerId === playerId) || null;
}

function screenIsFull() {
  return document.body.classList.contains("live-fullscreen");
}

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  document.addEventListener("keydown", onKeyDown);
}

function onFullscreenChange() {
  const native = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!native && view.nativeFullscreen) document.body.classList.remove("live-fullscreen");
  view.nativeFullscreen = native;
  if (document.body.classList.contains("route-live")) paint();
}

function padInput() {
  return view.container?.querySelector(".lb-pad-input") || null;
}

function onKeyDown(event) {
  if (document.body.dataset.inviteOpen === "true") return;
  if (!view.pad || !document.body.classList.contains("route-live")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closePad();
    return;
  }
  if (event.key === "Tab") {
    trapTab(event);
    return;
  }
  const inField = document.activeElement?.classList?.contains("lb-pad-input");
  if (event.key === "Enter") {
    if (event.target?.closest?.(".lb-pad") && event.target.tagName === "BUTTON") return;
    event.preventDefault();
    commitPad();
    return;
  }
  if (inField) return;
  if (event.key.length === 1 && event.key >= "0" && event.key <= "9") {
    event.preventDefault();
    appendDigit(event.key);
  } else if (event.key === "Backspace") {
    event.preventDefault();
    backspace();
  }
}

function trapTab(event) {
  const pad = view.container?.querySelector(".lb-pad");
  if (!pad) return;
  const items = [...pad.querySelectorAll("button, input, textarea")].filter((node) => !node.disabled);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function clearRetiredKeys() {
  try {
    for (const key of OLD_KEYS) localStorage.removeItem(key);
  } catch {
    /* The old table keys can stay if this browser blocks storage. */
  }
}

function readStoredNight() {
  try {
    return parseNight(localStorage.getItem(NIGHT_KEY)) || emptyNight(localDate());
  } catch {
    return emptyNight(localDate());
  }
}

function persist() {
  try {
    localStorage.setItem(NIGHT_KEY, JSON.stringify(view.night));
    view.saveError = "";
  } catch {
    view.saveError = "This browser could not keep tonight's game.";
  }
}

function readStorage(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStorage(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* The next attempt can ask again. */
  }
}

function readPin() {
  return readStorage(PIN_KEY);
}

function rememberPin(pin) {
  writeStorage(PIN_KEY, pin);
}

function forgetPin() {
  writeStorage(PIN_KEY, "");
  view.pinDraft = "";
}

function ensureSaveKey() {
  const existing = readStorage(SAVE_KEY);
  if (existing) return existing;
  const key = globalThis.crypto?.randomUUID?.()
    || `save-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeStorage(SAVE_KEY, key);
  return key;
}

function clearSavedNote() {
  if (view.saveStatus !== "saved") return;
  view.saveStatus = "";
  view.message = "";
  view.sheetMessage = "";
}

function syncPadDraft() {
  if (!view.pad) return;
  const input = padInput();
  if (input) view.pad.initial = input.value;
}

function openPad(mode, playerId) {
  const player = pickOf(playerId);
  let initial = "";
  if (mode === "stack" && player) initial = String(player.stack ?? "");
  if (mode === "buyin" && player?.buyIn != null) initial = String(player.buyIn);
  view.pad = {
    mode,
    playerId,
    initial,
    error: "",
    replace: initial !== "",
  };
  view.padFocus = true;
}

function closePad() {
  if (!view.pad) return;
  const { mode, playerId } = view.pad;
  view.focus = mode === "stack"
    ? `main-${playerId}`
    : mode === "rebuy"
      ? `rebuy-${playerId}`
      : mode === "fix"
        ? `fix-${playerId}`
        : mode === "join"
          ? "add-player"
          : `buy-${playerId}`;
  view.pad = null;
  paint();
}

function writePad(next) {
  const input = padInput();
  if (!input || !view.pad) return;
  input.value = next;
  view.pad.initial = next;
  view.pad.error = "";
  const error = view.container.querySelector(".lb-pad-error");
  if (error) error.textContent = "";
  input.focus();
  const end = next.length;
  input.setSelectionRange(end, end);
}

function appendDigit(digit) {
  const input = padInput();
  if (!input || !view.pad) return;
  const allSelected = input.selectionStart === 0
    && input.selectionEnd === input.value.length
    && input.value.length > 0;
  const replace = view.pad.replace || allSelected;
  const start = replace ? 0 : (input.selectionStart ?? input.value.length);
  const end = replace ? input.value.length : (input.selectionEnd ?? input.value.length);
  const raw = `${input.value.slice(0, start)}${digit}${input.value.slice(end)}`;
  const next = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 8);
  view.pad.replace = false;
  writePad(next);
}

function backspace() {
  const input = padInput();
  if (!input || !view.pad) return;
  if (view.pad.replace) {
    view.pad.replace = false;
    writePad("");
    return;
  }
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const raw = start === end
    ? `${input.value.slice(0, Math.max(0, start - 1))}${input.value.slice(end)}`
    : `${input.value.slice(0, start)}${input.value.slice(end)}`;
  writePad(raw.replace(/\D/g, "").replace(/^0+(?=\d)/, ""));
}

function clearPad() {
  if (view.pad) view.pad.replace = false;
  writePad("");
}

function keepFocus(event) {
  event.preventDefault();
}

function failPad(input, error) {
  view.pad.error = error;
  view.pad.replace = false;
  if (input) view.pad.initial = input.value;
  view.padFocus = true;
  paint();
}

function commitPad() {
  if (!view.pad) return;
  const input = padInput();
  const amount = parseWhole(input ? input.value : view.pad.initial);
  const { mode, playerId } = view.pad;
  if (mode === "join") {
    if (!playerId) {
      failPad(input, "Pick a player.");
      return;
    }
    if (amount == null) {
      failPad(input, "Enter the buy-in.");
      return;
    }
    const players = addPlayer(view.night.players, playerId, amount);
    if (players === view.night.players) {
      failPad(input, "That player is already in the game.");
      return;
    }
    view.night = { ...view.night, players, updatedAt: Date.now() };
    view.focus = `main-${playerId}`;
    view.pad = null;
    view.message = `${personOf(playerId).name} joined.`;
    persist();
    paint();
    return;
  }
  if (mode === "rebuy") {
    if (amount == null || amount <= 0) {
      failPad(input, "Enter the re-buy.");
      return;
    }
    const players = addRebuy(view.night.players, playerId, amount);
    if (players === view.night.players) {
      failPad(input, "That re-buy is too large.");
      return;
    }
    view.night = { ...view.night, players, updatedAt: Date.now() };
  } else if (mode === "fix") {
    if (amount == null || amount <= 0) {
      failPad(input, "Enter the amount to remove.");
      return;
    }
    const players = removeBuyIn(view.night.players, playerId, amount);
    if (players === view.night.players) {
      failPad(input, fixRefusal(pickOf(playerId), amount));
      return;
    }
    view.night = { ...view.night, players, updatedAt: Date.now() };
  } else if (mode === "stack") {
    if (amount == null) {
      failPad(input, "Enter the stack.");
      return;
    }
    const players = setStack(view.night.players, playerId, amount);
    if (players === view.night.players) {
      failPad(input, "Enter the stack.");
      return;
    }
    view.night = { ...view.night, players, updatedAt: Date.now() };
  } else if (amount == null) {
    failPad(input, "Enter the buy-in.");
    return;
  } else {
    view.night = { ...view.night, players: setBuyIn(view.night.players, playerId, amount) };
  }
  view.focus = mode === "stack"
    ? `main-${playerId}`
    : mode === "rebuy"
      ? `rebuy-${playerId}`
      : mode === "fix"
        ? `fix-${playerId}`
        : `buy-${playerId}`;
  view.pad = null;
  view.message = "";
  persist();
  paint();
}

function fixRefusal(player, amount) {
  const buyShort = !!player && typeof player.buyIn === "number" && amount > player.buyIn;
  const stackShort = !!player && typeof player.stack === "number" && amount > player.stack;
  if (buyShort && stackShort) return "That would make the buy-in and the stack negative.";
  if (buyShort) return "That would make the buy-in negative.";
  if (stackShort) return "That would make the stack negative.";
  return "That would make the buy-in or the stack negative.";
}

function togglePlayer(playerId) {
  clearSavedNote();
  view.message = "";
  if (pickOf(playerId)) {
    view.night = { ...view.night, players: dropPick(view.night.players, playerId) };
    if (view.pad?.playerId === playerId) view.pad = null;
    persist();
    paint();
    return;
  }
  view.night = {
    ...view.night,
    players: [...view.night.players, { playerId, buyIn: null, stack: null }],
  };
  openPad("buyin", playerId);
  persist();
  paint();
}

function waitingPlayers() {
  const playing = new Set(view.night.players.map((player) => player.playerId));
  return view.roster.filter((person) => (
    person && typeof person.id === "string" && person.id && !playing.has(person.id)
  ));
}

function openAdd() {
  if (!waitingPlayers().length) return;
  view.message = "";
  view.pad = {
    mode: "join",
    playerId: "",
    initial: "",
    error: "",
    replace: false,
  };
  view.padFocus = true;
  paint();
}

function chooseJoin(playerId) {
  if (!view.pad || view.pad.mode !== "join") return;
  if (!waitingPlayers().some((person) => person.id === playerId)) return;
  view.pad.playerId = playerId;
  view.pad.error = "";
  view.padFocus = true;
  paint();
}

function onRemove(playerId) {
  const player = pickOf(playerId);
  if (!canRemovePlayer(player)) return;
  const name = personOf(playerId).name;
  if (!window.confirm(`Remove ${name} from tonight's game?`)) return;
  const players = removePlayer(view.night.players, playerId);
  if (players === view.night.players) return;
  if (view.pad?.playerId === playerId) view.pad = null;
  view.night = { ...view.night, players, updatedAt: Date.now() };
  view.message = `${name} was removed.`;
  persist();
  paint();
}

function onStart() {
  const players = startGame(view.night.players);
  if (!players) return;
  view.night = { ...view.night, phase: "play", updatedAt: Date.now(), players };
  view.pad = null;
  view.message = "";
  persist();
  paint();
}

function onEnd() {
  const canSave = sheetEnabled() && balanceNote(view.night.players).balanced;
  const pin = canSave ? readPin() : "";
  if (pin && !window.confirm("End the game and save this session?")) return;
  view.night = { ...view.night, phase: "final" };
  view.pad = null;
  view.copyText = "";
  view.message = "";
  view.sheetMessage = "";
  view.saveStatus = pin ? "saving" : canSave ? "need-pin" : "";
  view.focusPin = view.saveStatus === "need-pin";
  persist();
  paint();
  if (view.saveStatus === "saving") void submitSession(pin);
}

function onBack() {
  if (view.saveStatus === "saving") return;
  view.night = { ...view.night, phase: "play" };
  view.copyText = "";
  view.message = "";
  view.sheetMessage = "";
  view.saveStatus = "";
  persist();
  paint();
}

function onReset() {
  if (view.saveStatus === "saving") return;
  const approved = window.confirm("Clear tonight's players, buy-ins, and stacks?");
  if (!approved) return;
  view.night = emptyNight(localDate());
  view.pad = null;
  view.copyText = "";
  view.message = "Tonight's game was cleared.";
  view.sheetMessage = "";
  view.saveStatus = "";
  view.pinDraft = "";
  view.paintedPhase = "";
  writeStorage(SAVE_KEY, "");
  persist();
  paint();
}

async function submitSession(pin) {
  if (saving) return;
  const players = view.night?.players;
  if (!players || !balanceNote(players).balanced) {
    view.saveStatus = "";
    view.sheetMessage = "Saving stays off until the nets sum to 0. Go back and fix the stacks.";
    paint();
    return;
  }
  saving = true;
  view.saveStatus = "saving";
  view.sheetMessage = "";
  paint();
  try {
    const ranked = rankedField(players, view.roster);
    const base = maxSessionNumber(view.sessions);
    const session = buildSessionPayload(ranked, view.night?.date, base);
    const result = await postSession(SHEET_API_URL, buildSaveBody({
      pin,
      key: ensureSaveKey(),
      base,
      session,
    }));
    rememberPin(pin);
    const saved = {
      id: `session-${result.sessionNumber}`,
      number: result.sessionNumber,
      label: `Session ${result.sessionNumber}`,
      entries: session.entries.map((entry) => ({ ...entry })),
    };
    if (session.date) saved.date = session.date;
    writeStorage(SAVE_KEY, "");
    view.night = emptyNight(localDate());
    view.pad = null;
    view.copyText = "";
    view.pinDraft = "";
    view.paintedPhase = "";
    view.saveStatus = "saved";
    view.sheetMessage = `Saved as Session ${result.sessionNumber}`;
    view.message = view.sheetMessage;
    view.sessions = mergeSessions(view.sessions, [saved]);
    persist();
    paint();
    try {
      await requestLedgerRefresh(saved);
    } catch {
      /* The session is already on the sheet. The next load will pick it up. */
    }
  } catch (error) {
    view.sheetMessage = error?.message || "The session was not saved.";
    view.message = "";
    if (error?.pin) {
      forgetPin();
      view.saveStatus = "need-pin";
      view.focusPin = true;
    } else {
      view.saveStatus = "error";
    }
    paint();
  } finally {
    saving = false;
  }
}

function onDate(event) {
  const next = withDate(view.night, event.target.value);
  if (next === view.night) {
    event.target.value = view.night.date;
    return;
  }
  view.night = next;
  persist();
  paint();
}

async function toggleScreen() {
  if (screenIsFull()) {
    document.body.classList.remove("live-fullscreen");
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
      try {
        const result = exit.call(document);
        if (result?.catch) result.catch(() => {});
      } catch {
        /* The class is already off. */
      }
    }
  } else {
    document.body.classList.add("live-fullscreen");
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (request) {
      try {
        await request.call(root);
      } catch {
        /* The class still fills the window when fullscreen is blocked. */
      }
    }
  }
  paint();
}

function resultsPlainText() {
  return formatResultsShareText(rankedField(view.night.players, view.roster), view.night.date);
}

async function onCopy() {
  const text = resultsPlainText();
  try {
    if (!navigator.clipboard?.writeText) throw new Error("unavailable");
    await navigator.clipboard.writeText(text);
    view.copyText = "";
    view.message = "Copied.";
  } catch {
    view.copyText = text;
    view.message = "Copy the lines below.";
    view.focusCopy = true;
  }
  paint();
}

async function onShareResults() {
  const result = await shareNative(resultsShareData(resultsPlainText()));
  if (result === "failed") {
    view.message = "Sharing is not available in this browser.";
    paint();
  }
}

function onInvite(event) {
  let opener = event.currentTarget;
  if (view.pad) {
    view.pad = null;
    paint();
    opener = view.container?.querySelector("[data-invite-open]") || opener;
  }
  openInvite(opener);
}

function onDownload() {
  const entry = sessionEntry(describePlayers(view.night.players, view.roster), view.sessions);
  const json = formatSessionJson(entry);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: `${entry.id}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  view.copyText = "";
  view.message = `Downloaded ${entry.id}.json.`;
  paint();
}

function rowTops() {
  const map = new Map();
  if (!view.container) return map;
  for (const row of view.container.querySelectorAll(".lb-row[data-player]")) {
    const transform = row.style.transform;
    if (transform) row.style.transform = "none";
    map.set(row.dataset.player, row.getBoundingClientRect().top);
    if (transform) row.style.transform = transform;
  }
  return map;
}

function slideRows(before) {
  if (!before.size || !view.container) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rows = [...view.container.querySelectorAll(".lb-row[data-player]")];
  const moves = [];
  for (const row of rows) {
    const previous = before.get(row.dataset.player);
    if (previous == null) continue;
    const delta = previous - row.getBoundingClientRect().top;
    if (Math.abs(delta) >= 1) moves.push({ row, delta });
  }
  if (moves.length < 2) return;
  const shift = moves[0].delta;
  if (moves.every((item) => Math.abs(item.delta - shift) < 1)) return;
  for (const { row, delta } of moves) {
    row.style.transition = "none";
    row.style.transform = `translateY(${delta}px)`;
    row.style.zIndex = "1";
  }
  view.container.getBoundingClientRect();
  for (const { row } of moves) {
    row.style.transition = "transform 520ms cubic-bezier(.22, .8, .24, 1)";
    row.style.transform = "translateY(0)";
    row.addEventListener("transitionend", () => {
      row.style.transition = "";
      row.style.transform = "";
      row.style.zIndex = "";
    }, { once: true });
  }
}

function focusAfterPaint() {
  const root = view.container;
  if (!root) return;
  if (view.pad && view.padFocus) {
    const joinList = view.pad.mode === "join" && !view.pad.playerId;
    const input = joinList ? root.querySelector(".lb-join") : root.querySelector(".lb-pad-input");
    if (input) {
      input.focus();
      if (!joinList && view.pad.replace) input.select();
      else if (!joinList) {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }
    }
    view.padFocus = false;
    return;
  }
  if (view.focusPin) {
    root.querySelector(".lb-pin input")?.focus();
    view.focusPin = false;
    return;
  }
  if (view.focusCopy) {
    const box = root.querySelector(".lb-copy");
    box?.focus();
    box?.select();
    view.focusCopy = false;
    return;
  }
  if (view.focus) {
    root.querySelector(`[data-focus="${CSS.escape(view.focus)}"]`)?.focus();
    view.focus = "";
  }
}

function paint() {
  const container = view.container;
  if (!container || !view.night || !document.body.classList.contains("route-live")) return;
  syncPadDraft();
  const before = view.night.phase === "play" && view.paintedPhase === "play" ? rowTops() : new Map();
  container.replaceChildren(renderApp());
  view.paintedPhase = view.night.phase;
  slideRows(before);
  focusAfterPaint();
}

function toolButton(label, attrs) {
  return el("button", { type: "button", class: "lb-btn", ...attrs }, label);
}

function renderTools() {
  const phase = view.night.phase;
  const full = screenIsFull();
  const busy = view.saveStatus === "saving";
  return el("div", { class: "lb-tools" }, [
    toolButton(full ? "Exit full screen" : "Full screen", {
      "aria-pressed": full ? "true" : "false",
      onclick: () => { toggleScreen(); },
    }),
    phase === "play" ? toolButton("End game", { class: "lb-btn lb-btn-primary", onclick: onEnd }) : null,
    phase === "final" ? toolButton("Back to board", {
      disabled: busy ? true : null,
      onclick: onBack,
    }) : null,
    toolButton("Reset", {
      class: "lb-btn lb-btn-quiet",
      disabled: busy ? true : null,
      onclick: onReset,
    }),
  ]);
}

function renderHeader() {
  const players = view.night.players;
  const clock = formatClock(view.night.updatedAt);
  return el("header", { class: "lb-top" }, [
    el("div", { class: "lb-heading" }, [
      el("p", { class: "section-kicker", text: "Tonight" }),
      el("h1", { text: "Live leaderboard" }),
    ]),
    renderTools(),
    view.night.phase === "play" ? renderAddPlayer() : null,
    el("div", { class: "lb-facts", role: "group", "aria-label": "Tonight" }, [
      el("div", { class: "lb-fact" }, [
        el("span", { class: "lb-k", text: "Date" }),
        el("strong", { text: formatNight(view.night.date) }),
        el("label", { class: "lb-date-edit" }, [
          el("span", { class: "sr-only", text: "Change the date" }),
          el("input", {
            type: "date",
            value: view.night.date,
            onchange: onDate,
          }),
        ]),
      ]),
      el("div", { class: "lb-fact" }, [
        el("span", { class: "lb-k", text: "Players" }),
        el("strong", { class: "num", text: String(players.length) }),
      ]),
      el("div", { class: "lb-fact" }, [
        el("span", { class: "lb-k", text: "In play" }),
        el("strong", { class: "num", text: formatAmount(totalInPlay(players)) }),
      ]),
    ]),
    clock && view.night.phase !== "setup"
      ? el("p", { class: "lb-updated", text: `Last updated ${clock}` })
      : null,
  ]);
}

function renderSetup() {
  const known = new Set(view.roster.map((player) => player.id));
  const extras = view.night.players
    .filter((player) => !known.has(player.playerId))
    .map((player) => ({ id: player.playerId, name: player.playerId, photo: "" }));
  const people = [...view.roster, ...extras];
  const ready = canStart(view.night.players);
  const waiting = view.night.players.some((player) => player.buyIn == null);
  let note = "Pick who is playing tonight and enter each starting buy-in. The stack starts equal to that buy-in.";
  if (view.night.players.length && waiting) note = "Enter a starting buy-in for each player.";
  return el("section", { class: "lb-setup" }, [
    el("p", { class: "note", text: note }),
    el("div", { class: "lb-setup-tools" }, [
      el("button", {
        type: "button",
        class: "lb-btn",
        dataset: { inviteOpen: "true" },
        onclick: onInvite,
      }, "Who's in?"),
    ]),
    el("ul", { class: "lb-roster" }, people.map((person) => {
      const pick = pickOf(person.id);
      const on = !!pick;
      return el("li", { class: `lb-card${on ? " is-on" : ""}` }, [
        el("button", {
          type: "button",
          class: "lb-person",
          "aria-pressed": on ? "true" : "false",
          onclick: () => togglePlayer(person.id),
        }, [
          avatar(person, "lb-photo"),
          el("span", { class: "lb-name", text: person.name }),
          on ? el("span", { class: "lb-playing", text: "Playing" }) : null,
        ]),
        on ? el("button", {
          type: "button",
          class: "lb-buy",
          dataset: { focus: `buy-${person.id}` },
          onclick: () => {
            view.message = "";
            openPad("buyin", person.id);
            paint();
          },
        }, pick.buyIn == null ? "Set buy-in" : `Buy-in ${formatAmount(pick.buyIn)}`) : null,
      ]);
    })),
    el("button", {
      type: "button",
      class: "lb-btn lb-btn-primary lb-start",
      disabled: ready ? null : true,
      onclick: onStart,
    }, "Start"),
  ]);
}

function renderAddPlayer() {
  const open = waitingPlayers().length > 0;
  return el("div", { class: "lb-add-wrap" }, [
    el("button", {
      type: "button",
      class: "lb-btn lb-btn-primary lb-add",
      dataset: { focus: "add-player" },
      disabled: open ? null : true,
      "aria-describedby": open ? null : "lb-add-full",
      onclick: openAdd,
    }, "+ Add player"),
    open ? null : el("p", {
      id: "lb-add-full",
      class: "note",
      text: "Everyone on the roster is already in tonight's game.",
    }),
  ]);
}

function renderBoard() {
  const ranked = rankedField(view.night.players, view.roster);
  const strictLead = ranked.length > 0 && (ranked.length === 1 || ranked[0].net > ranked[1].net);
  return el("section", { class: "lb-live" }, [
    el("p", {
      class: "lb-hint",
      text: "Tap a player to set the stack. Re-buy adds to the buy-in and the stack. Fix buy-in removes an amount from both.",
    }),
    ranked.length
      ? el("ol", { class: "lb-board", "aria-label": "Standings" }, ranked.map((player) => {
        const person = {
          id: player.playerId,
          name: player.name,
          photo: player.photo,
        };
        return el("li", {
          class: `lb-row${strictLead && player.rank === 1 ? " is-lead" : ""}`,
          dataset: { player: player.playerId },
        }, [
          el("button", {
            type: "button",
            class: "lb-main",
            dataset: { focus: `main-${player.playerId}` },
            "aria-label": `${player.name}, rank ${player.rank}, ${formatSigned(player.net)}. Stack ${formatAmount(player.stack)}. Buy-in ${formatAmount(player.buyIn)}. Set the stack.`,
            onclick: () => {
              view.message = "";
              openPad("stack", player.playerId);
              paint();
            },
          }, [
            el("span", { class: "lb-rank", text: String(player.rank) }),
            avatar(person, "lb-photo"),
            el("span", { class: "lb-who" }, [
              el("span", { class: "lb-name", text: player.name }),
              el("span", {
                class: "lb-meta",
                text: `Stack ${formatAmount(player.stack)} · Buy-in ${formatAmount(player.buyIn)}`,
              }),
            ]),
            el("span", {
              class: `lb-result num ${signedClass(player.net)}`,
              text: formatSigned(player.net),
            }),
          ]),
          el("div", { class: "lb-row-actions" }, [
            el("button", {
              type: "button",
              class: "lb-rebuy",
              dataset: { focus: `rebuy-${player.playerId}` },
              "aria-label": `Re-buy for ${player.name}`,
              onclick: () => {
                view.message = "";
                openPad("rebuy", player.playerId);
                paint();
              },
            }, "+ Re-buy"),
            el("button", {
              type: "button",
              class: "lb-fix",
              dataset: { focus: `fix-${player.playerId}` },
              "aria-label": `Fix buy-in for ${player.name}`,
              onclick: () => {
                view.message = "";
                openPad("fix", player.playerId);
                paint();
              },
            }, "Fix buy-in"),
            canRemovePlayer(player)
              ? el("button", {
                type: "button",
                class: "lb-btn lb-btn-quiet lb-remove",
                "aria-label": `Remove ${player.name}`,
                onclick: () => onRemove(player.playerId),
              }, "Remove")
              : null,
          ]),
        ]);
      }))
      : el("p", { class: "note", text: "No players in tonight's game." }),
  ]);
}

function renderFinal() {
  const ranked = rankedField(view.night.players, view.roster);
  const balance = balanceNote(view.night.players);
  const text = formatResultsShareText(ranked, view.night.date);
  return el("section", { class: "lb-final" }, [
    el("h2", { text: "Final results" }),
    el("p", {
      class: balance.balanced ? "lb-ok" : "lb-warn",
      role: balance.balanced ? "status" : "alert",
      text: balance.note,
    }),
    el("ol", { class: "lb-board", "aria-label": "Final results" }, ranked.map((player) => el("li", {
      class: "lb-row lb-row-final",
      dataset: { player: player.playerId },
    }, [
      el("span", { class: "lb-rank", text: String(player.rank) }),
      avatar({ name: player.name, photo: player.photo }, "lb-photo"),
      el("span", { class: "lb-who" }, [
        el("span", { class: "lb-name", text: player.name }),
        el("span", { class: "lb-meta", text: `Buy-in ${formatAmount(player.buyIn)}` }),
      ]),
      el("span", {
        class: `lb-result num ${signedClass(player.net)}`,
        text: formatSigned(player.net),
      }),
    ]))),
    renderSave(balance),
    el("div", { class: "lb-export" }, [
      el("button", {
        type: "button",
        class: sheetEnabled() ? "lb-btn" : "lb-btn lb-btn-primary",
        onclick: () => { onCopy(); },
      }, "Copy results"),
      el("a", {
        class: "line-share",
        href: lineTextShareUrl(text),
        target: "_blank",
        rel: "noopener noreferrer",
      }, "Share results to LINE"),
      canWebShare() ? el("button", {
        type: "button",
        class: "lb-btn",
        onclick: () => { void onShareResults(); },
      }, "Share…") : null,
      el("button", { type: "button", class: "lb-btn", onclick: onDownload }, "Download JSON"),
    ]),
    el("p", {
      class: "note",
      text: sheetEnabled()
        ? "Copy and Share results to LINE use the same text: the date, one line per player, and the site link. Copy and download stay available if the sheet does not save."
        : "Copy and Share results to LINE use the same text: the date, one line per player, and the site link. Download JSON is one session to paste into data/sessions.json.",
    }),
    view.copyText
      ? el("textarea", {
        class: "lb-copy",
        readonly: true,
        rows: String(Math.max(4, view.copyText.split("\n").length)),
        "aria-label": "Results to copy",
        spellcheck: "false",
        text: view.copyText,
      })
      : null,
  ]);
}

function renderSave(balance) {
  if (!sheetEnabled()) return null;
  if (!balance.balanced) {
    return el("p", {
      class: "note",
      text: view.sheetMessage || "Saving stays off until the nets sum to 0. Go back and fix the stacks.",
    });
  }
  if (view.saveStatus === "saving") {
    return el("p", { class: "lb-ok", role: "status", text: "Saving session…" });
  }
  const pin = readPin();
  if (!pin || view.saveStatus === "need-pin") {
    return pinForm(view.sheetMessage ? "Retry" : "Save session");
  }
  if (view.saveStatus === "error") {
    return el("div", { class: "lb-save" }, [
      el("p", { class: "lb-warn", role: "alert", text: view.sheetMessage || "The session was not saved." }),
      el("button", {
        type: "button",
        class: "lb-btn lb-btn-primary",
        onclick: () => { void submitSession(pin); },
      }, "Retry"),
    ]);
  }
  if (view.saveStatus === "saved") return null;
  return el("button", {
    type: "button",
    class: "lb-btn lb-btn-primary lb-save-btn",
    onclick: () => { void submitSession(pin); },
  }, "Save session");
}

function pinForm(label) {
  return el("form", {
    class: "lb-save",
    onsubmit: (event) => {
      event.preventDefault();
      const input = event.currentTarget.querySelector("input");
      const pin = (input?.value || "").trim();
      view.pinDraft = pin;
      if (!pin) {
        view.sheetMessage = "Enter the host PIN.";
        view.saveStatus = "need-pin";
        view.focusPin = true;
        paint();
        return;
      }
      void submitSession(pin);
    },
  }, [
    el("label", { class: "lb-pin" }, [
      el("span", { text: "Host PIN" }),
      el("input", {
        type: "password",
        autocomplete: "off",
        spellcheck: "false",
        value: view.pinDraft,
        oninput: (event) => {
          view.pinDraft = event.target.value;
        },
      }),
    ]),
    view.sheetMessage
      ? el("p", { class: "lb-warn", role: "alert", text: view.sheetMessage })
      : null,
    el("button", { type: "submit", class: "lb-btn lb-btn-primary" }, label),
  ]);
}

function padAside(player) {
  if (!view.pad || !player) return "";
  if (view.pad.mode === "stack" && player.stack != null) return `Was ${formatAmount(player.stack)}`;
  if ((view.pad.mode === "rebuy" || view.pad.mode === "fix") && player.buyIn != null && player.stack != null) {
    return `Buy-in ${formatAmount(player.buyIn)} · Stack ${formatAmount(player.stack)}`;
  }
  if (view.pad.mode === "buyin" && player.buyIn != null) return `Current buy-in ${formatAmount(player.buyIn)}`;
  return "";
}

function onPadInput(event) {
  const clean = event.target.value.replace(/\D/g, "").slice(0, 8).replace(/^0+(?=\d)/, "");
  if (clean !== event.target.value) event.target.value = clean;
  if (!view.pad) return;
  view.pad.initial = event.target.value;
  view.pad.replace = false;
  view.pad.error = "";
  const error = view.container?.querySelector(".lb-pad-error");
  if (error) error.textContent = "";
}

function renderKeys() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"];
  return el("div", { class: "lb-keys" }, keys.map((key) => {
    if (key === "clear") {
      return el("button", {
        type: "button",
        class: "lb-key lb-key-text",
        onmousedown: keepFocus,
        onclick: clearPad,
      }, "Clear");
    }
    if (key === "delete") {
      return el("button", {
        type: "button",
        class: "lb-key lb-key-text",
        onmousedown: keepFocus,
        "aria-label": "Delete last digit",
        onclick: backspace,
      }, "Delete");
    }
    return el("button", {
      type: "button",
      class: "lb-key",
      onmousedown: keepFocus,
      onclick: () => appendDigit(key),
    }, key);
  }));
}

function renderAmountField(label, value) {
  return el("input", {
    class: "lb-pad-input",
    inputmode: "numeric",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    enterkeyhint: "done",
    "aria-label": label,
    value,
    oninput: onPadInput,
  });
}

function renderJoinPad(pad) {
  const waiting = waitingPlayers();
  const chosen = waiting.find((person) => person.id === pad.playerId) || null;
  return el("div", {
    class: "lb-shade",
    onclick: (event) => {
      if (event.target === event.currentTarget) closePad();
    },
  }, [
    el("div", {
      class: "lb-pad lb-pad-join",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "lb-pad-title",
    }, [
      el("p", { class: "lb-k", text: "Late join" }),
      el("h2", { id: "lb-pad-title", text: chosen ? chosen.name : "Add player" }),
      el("p", {
        class: "lb-pad-note",
        text: "Pick someone who is not in tonight's game. Their stack starts equal to the buy-in.",
      }),
      waiting.length
        ? el("ul", { class: "lb-join-list" }, waiting.map((person) => el("li", {}, [
          el("button", {
            type: "button",
            class: "lb-join",
            "aria-pressed": person.id === pad.playerId ? "true" : "false",
            onclick: () => chooseJoin(person.id),
          }, [
            avatar(person, "lb-join-photo"),
            el("span", { class: "lb-name", text: person.name || person.id }),
          ]),
        ])))
        : el("p", { class: "note", text: "Everyone on the roster is already in tonight's game." }),
      renderAmountField(chosen ? `Buy-in for ${chosen.name || chosen.id}` : "Buy-in", pad.initial),
      el("p", { class: "lb-pad-error", role: "alert", text: pad.error }),
      renderKeys(),
      el("div", { class: "lb-pad-actions" }, [
        el("button", { type: "button", class: "lb-btn lb-btn-quiet", onclick: closePad }, "Cancel"),
        el("button", {
          type: "button",
          class: "lb-btn lb-btn-primary",
          disabled: waiting.length ? null : true,
          onclick: commitPad,
        }, "Add player"),
      ]),
    ]),
  ]);
}

function renderPad() {
  const pad = view.pad;
  if (!pad) return null;
  if (pad.mode === "join") return renderJoinPad(pad);
  const person = personOf(pad.playerId);
  const player = pickOf(pad.playerId);
  const copy = PAD_COPY[pad.mode];
  const aside = padAside(player);
  return el("div", {
    class: "lb-shade",
    onclick: (event) => {
      if (event.target === event.currentTarget) closePad();
    },
  }, [
    el("div", {
      class: "lb-pad",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "lb-pad-title",
    }, [
      el("div", { class: "lb-pad-who" }, [
        avatar(person, "lb-pad-photo"),
        el("div", {}, [
          el("p", { class: "lb-k", text: copy.kicker }),
          el("h2", { id: "lb-pad-title", text: person.name }),
        ]),
      ]),
      copy.note ? el("p", { class: "lb-pad-note", text: copy.note }) : null,
      aside ? el("p", { class: "lb-pad-was", text: aside }) : null,
      renderAmountField(copy.kicker, pad.initial),
      el("p", { class: "lb-pad-error", role: "alert", text: pad.error }),
      renderKeys(),
      el("div", { class: "lb-pad-actions" }, [
        el("button", { type: "button", class: "lb-btn lb-btn-quiet", onclick: closePad }, "Cancel"),
        el("button", { type: "button", class: "lb-btn lb-btn-primary", onclick: commitPad }, copy.done),
      ]),
    ]),
  ]);
}

function renderApp() {
  const phase = view.night.phase;
  return el("div", { class: "lb" }, [
    view.saveError ? el("p", { class: "banner", role: "alert", text: view.saveError }) : null,
    renderHeader(),
    el("p", {
      class: `lb-message${view.saveStatus === "saved" ? " is-ok" : ""}`,
      role: "status",
      "aria-live": "polite",
      text: view.message,
    }),
    el("div", { class: "lb-body", inert: view.pad ? true : null }, [
      phase === "setup" ? renderSetup() : null,
      phase === "play" ? renderBoard() : null,
      phase === "final" ? renderFinal() : null,
    ]),
    renderPad(),
  ]);
}

export function updateLiveSessions(sessions) {
  view.sessions = Array.isArray(sessions) ? sessions : [];
}

export function mountLive(container, players, sessions) {
  view.container = container;
  view.roster = Array.isArray(players) ? players : [];
  view.sessions = Array.isArray(sessions) ? sessions : [];
  document.body.classList.add("route-live");
  listen();
  if (!view.booted) {
    clearRetiredKeys();
    view.night = readStoredNight();
    view.booted = true;
  }
  paint();
}

export function unmountLive() {
  const wasLive = document.body.classList.contains("route-live")
    || document.body.classList.contains("live-fullscreen");
  document.body.classList.remove("route-live", "live-fullscreen");
  view.container = null;
  view.pad = null;
  if (!wasLive) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
    try {
      const result = exit.call(document);
      if (result?.catch) result.catch(() => {});
    } catch {
      /* Already left fullscreen. */
    }
  }
}
