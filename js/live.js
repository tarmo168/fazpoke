import { avatar, el } from "./dom.js";
import {
  SEAT_COUNT,
  SMALL_SAMPLE_HANDS,
  STREET_LABEL,
  advanceStreet,
  beginPick,
  cancelPick,
  cloneHand,
  confirmWinners,
  foldLabel,
  foldOf,
  foldPlayer,
  formatPct,
  freshHand,
  nextButtonSeat,
  seatPoint,
  stampHand,
  statsForPlayer,
  toggleVpip,
  toggleWinner,
} from "./handstats.js";
import { createHandId, createHandStore, emptySeating, isSessionDate, parseHandLog } from "./handstore.js";

const view = {
  booted: false,
  container: null,
  store: null,
  players: [],
  byId: new Map(),
  seating: null,
  hands: [],
  hand: null,
  undo: [],
  lastCommit: null,
  selectedSeat: null,
  armButton: false,
  scope: "all",
  h2hA: "",
  h2hB: "",
  message: "",
  messageTone: "",
  storeNote: "",
};

let bootPromise = null;
let paintGen = 0;
let saving = false;
let drag = null;
let swallowUntil = 0;
let screenListening = false;

const STAT_ROWS = [
  ["Hands", (stats) => String(stats.handsDealt)],
  ["VPIP", (stats) => formatPct(stats.vpipPct)],
  ["Fold pre-flop", (stats) => formatPct(stats.foldPct.preflop)],
  ["Fold flop", (stats) => formatPct(stats.foldPct.flop)],
  ["Fold turn", (stats) => formatPct(stats.foldPct.turn)],
  ["Fold river", (stats) => formatPct(stats.foldPct.river)],
  ["Showdown", (stats) => formatPct(stats.showdownPct)],
  ["Showdown win", (stats) => formatPct(stats.showdownWinPct)],
];

function setMessage(text, tone = "") {
  view.message = text;
  view.messageTone = tone;
}

function swallow(ms = 450) {
  swallowUntil = Date.now() + ms;
}

function swallowed() {
  return Date.now() < swallowUntil;
}

function nameOf(playerId) {
  if (!playerId) return "";
  return view.byId.get(playerId)?.name || playerId;
}

function personOf(playerId) {
  return view.byId.get(playerId) || { id: playerId, name: nameOf(playerId) };
}

function showStoreError(error) {
  setMessage(error?.message || "The log could not be saved on this device.", "warn");
  paint();
}

function ensureScreenListener() {
  if (screenListening) return;
  screenListening = true;
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) document.body.classList.remove("live-fullscreen");
    if (document.body.classList.contains("route-live")) paint();
  });
}

async function loadFromStore() {
  view.store = createHandStore();
  try {
    view.seating = await view.store.getSeating();
  } catch {
    view.seating = emptySeating();
    view.storeNote = "Saved hands could not be read on this device.";
  }
  try {
    view.hands = await view.store.getHands();
  } catch {
    view.hands = [];
    view.storeNote = "Saved hands could not be read on this device.";
  }
  try {
    const draft = await view.store.getDraft();
    if (draft?.hand) {
      view.hand = draft.hand;
      view.undo = draft.undo || [];
    }
    if (draft?.lastCommit && view.hands.some((hand) => hand.id === draft.lastCommit.id)) {
      view.lastCommit = draft.lastCommit;
    }
  } catch {
    view.hand = null;
    view.undo = [];
  }
  if (view.store?.memory && !view.storeNote) {
    view.storeNote = "This browser is not keeping the log. Export it before you leave.";
  }
  view.booted = true;
}

function ensureBoot() {
  if (!bootPromise) bootPromise = loadFromStore();
  return bootPromise;
}

export function mountLive(container, players) {
  view.container = container;
  view.players = players;
  view.byId = new Map(players.map((player) => [player.id, player]));
  document.body.classList.add("route-live");
  ensureScreenListener();
  if (view.booted) {
    paint();
    return;
  }
  const gen = ++paintGen;
  container.replaceChildren(el("p", { class: "note", text: "Loading the table…" }));
  ensureBoot().then(() => {
    if (gen !== paintGen || !view.booted) return;
    paint();
  });
}

export function unmountLive() {
  const wasLive = document.body.classList.contains("route-live")
    || document.body.classList.contains("live-fullscreen");
  document.body.classList.remove("route-live", "live-fullscreen");
  view.container = null;
  document.querySelector(".live-ghost")?.remove();
  drag = null;
  if (wasLive && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

function paint() {
  const container = view.container;
  if (!container || !view.seating || !document.body.classList.contains("route-live")) return;
  container.replaceChildren(el("div", { class: "live-app" }, [
    view.storeNote ? el("p", { class: "banner", role: "status", text: view.storeNote }) : null,
    renderTop(),
    el("p", {
      class: `live-message${view.messageTone === "warn" ? " is-warn" : ""}`,
      role: "status",
      "aria-live": "polite",
      text: view.message,
    }),
    renderStage(),
    renderActions(),
    view.hand ? null : renderRoster(),
    renderStats(),
    renderHeadToHead(),
    renderLog(),
  ]));
}

function renderTop() {
  const full = document.body.classList.contains("live-fullscreen");
  return el("div", { class: "live-top" }, [
    el("div", {}, [
      el("p", { class: "section-kicker", text: "Live" }),
      el("h1", { text: "Live table" }),
    ]),
    el("div", { class: "live-top-tools" }, [
      el("label", { class: "live-date" }, [
        "Session date",
        el("input", {
          type: "date",
          value: view.seating.sessionDate,
          onchange: (event) => setSessionDate(event.target.value),
        }),
      ]),
      el("button", {
        type: "button",
        class: "live-btn live-screen",
        "aria-pressed": full ? "true" : "false",
        onclick: () => { void toggleScreen(); },
      }, full ? "Exit full screen" : "Full screen"),
    ]),
  ]);
}

function renderStage() {
  const copy = feltCopy();
  const seats = [];
  for (let index = 0; index < SEAT_COUNT; index += 1) seats.push(renderSeat(index));
  return el("div", { class: `live-stage${view.armButton ? " is-arming" : ""}` }, [
    el("div", { class: "live-oval" }, [
      el("div", { class: "live-felt" }, [
        el("p", { class: "live-felt-kicker", text: copy.kicker }),
        el("p", { class: "live-felt-title", text: copy.title }),
        copy.detail ? el("p", { class: "live-felt-detail", text: copy.detail }) : null,
      ]),
      el("div", {
        class: "live-seats",
        role: "group",
        "aria-label": "Seats, clockwise from the bottom",
      }, seats),
    ]),
  ]);
}

function feltCopy() {
  if (view.hand?.phase === "pick") {
    const count = view.hand.winners.length;
    return {
      kicker: "Winners",
      title: count > 1 ? "Split" : "Tap winners",
      detail: count === 1 ? nameOf(view.hand.winners[0]) : "",
    };
  }
  if (view.hand) {
    return { kicker: "Street", title: STREET_LABEL[view.hand.street], detail: "" };
  }
  const count = view.seating.seats.filter(Boolean).length;
  const buttonId = view.seating.buttonSeat == null ? "" : view.seating.seats[view.seating.buttonSeat];
  return {
    kicker: "Fazwazpoker",
    title: count === 1 ? "1 player" : `${count} players`,
    detail: buttonId ? `Button · ${nameOf(buttonId)}` : "No dealer button",
  };
}

function placeClass(index) {
  if (index === 2 || index === 3) return "place-left";
  if (index >= 4 && index <= 6) return "place-top";
  if (index === 7 || index === 8) return "place-right";
  return "place-bottom";
}

function renderSeat(index) {
  const playerId = view.seating.seats[index];
  const point = seatPoint(index);
  const fold = view.hand && playerId ? foldOf(view.hand, playerId) : null;
  const winner = Boolean(view.hand && playerId && view.hand.phase === "pick" && view.hand.winners.includes(playerId));
  const vpipOn = Boolean(view.hand && playerId && view.hand.vpip[playerId] === true);
  const showVpip = Boolean(
    view.hand && playerId && !fold && view.hand.phase === "play" && view.hand.street === "preflop",
  );
  const classes = [
    "live-seat",
    placeClass(index),
    playerId ? "" : "is-empty",
    view.selectedSeat === index && !view.hand ? "is-selected" : "",
    fold ? "is-folded" : "",
    winner ? "is-winner" : "",
    vpipOn ? "is-vpip" : "",
  ].filter(Boolean).join(" ");

  const caption = [el("span", { class: "live-seat-name", text: playerId ? nameOf(playerId) : "Empty" })];
  if (fold) caption.push(el("span", { class: "live-fold", text: foldLabel(fold.street) }));
  else if (winner) caption.push(el("span", { class: "live-wins", text: "Wins" }));

  const hit = el("button", {
    type: "button",
    class: "live-seat-hit",
    "aria-label": seatLabel(index, playerId, fold, winner),
  }, [
    avatarWrap(index, playerId),
    el("span", { class: "live-caption" }, caption),
  ]);
  bindPress(hit, {
    playerId: playerId && !view.hand ? playerId : null,
    fromSeat: playerId ? index : null,
    onTap: () => onSeatClick(index),
    onHold: showVpip ? () => onSeatHold(index) : null,
  });

  const extras = [];
  if (showVpip) {
    extras.push(el("button", {
      type: "button",
      class: "live-vpip",
      "aria-pressed": vpipOn ? "true" : "false",
      "aria-label": `${nameOf(playerId)} voluntarily entered the pot`,
      onpointerdown: (event) => event.stopPropagation(),
      onclick: (event) => {
        event.stopPropagation();
        apply((hand) => toggleVpip(hand, view.seating.seats, playerId));
      },
    }, "VPIP"));
  } else if (vpipOn) {
    extras.push(el("span", { class: "live-vpip-dot", "aria-hidden": "true" }));
  }

  return el("div", {
    class: classes,
    dataset: { seat: String(index) },
    style: { left: `${point.x}%`, top: `${point.y}%` },
  }, [hit, ...extras]);
}

function seatLabel(index, playerId, fold, winner) {
  const number = index + 1;
  if (!playerId) return `Seat ${number}, empty`;
  const bits = [`${nameOf(playerId)}, seat ${number}`];
  if (view.seating.buttonSeat === index) bits.push("dealer button");
  if (fold) bits.push(foldLabel(fold.street));
  else if (winner) bits.push("winner");
  else if (view.hand?.vpip[playerId] === true) bits.push("entered the pot");
  return bits.join(", ");
}

function avatarWrap(index, playerId) {
  const children = [];
  if (playerId) {
    const photo = avatar(personOf(playerId));
    photo.draggable = false;
    children.push(photo);
    children.push(el("span", { class: "live-seat-index", "aria-hidden": "true", text: String(index + 1) }));
  } else {
    children.push(el("span", { class: "live-empty-num", text: String(index + 1) }));
  }
  if (view.seating.buttonSeat === index && playerId) {
    children.push(el("span", { class: "live-dealer", "aria-hidden": "true", text: "D" }));
  }
  return el("span", { class: "live-avatar-wrap" }, children);
}

function renderActions() {
  if (!view.hand) return renderSetupActions();
  const pick = view.hand.phase === "pick";
  const showdown = view.hand.street === "showdown";
  let primaryLabel = "Next street";
  let primary = () => onNextStreet();
  if (pick) {
    primaryLabel = "Save hand";
    primary = () => onSave();
  } else if (showdown) {
    primaryLabel = "Name winners";
    primary = () => onNameWinners();
  }
  const row = [
    !pick && !showdown
      ? el("button", { type: "button", class: "live-btn", onclick: () => onNameWinners() }, "Name winners")
      : null,
    pick ? el("button", { type: "button", class: "live-btn", onclick: () => onBack() }, "Back") : null,
    el("button", { type: "button", class: "live-btn", onclick: () => onUndo() }, "Undo"),
    el("button", { type: "button", class: "live-btn", onclick: () => cancelHand() }, "Cancel hand"),
  ];
  return el("div", { class: "live-actions is-active" }, [
    el("p", { class: "live-hint", text: hint() }),
    el("button", { type: "button", class: "live-next", onclick: primary }, primaryLabel),
    el("div", { class: "live-action-row" }, row),
  ]);
}

function renderSetupActions() {
  const selected = view.selectedSeat != null && view.seating.seats[view.selectedSeat];
  return el("div", { class: "live-actions" }, [
    el("p", { class: "live-hint", text: hint() }),
    el("button", { type: "button", class: "live-next", onclick: () => startHand() }, "Start hand"),
    el("div", { class: "live-action-row" }, [
      el("button", {
        type: "button",
        class: "live-btn",
        "aria-pressed": view.armButton ? "true" : "false",
        onclick: () => {
          view.armButton = !view.armButton;
          setMessage(view.armButton ? "Tap the player who has the dealer button." : "");
          paint();
        },
      }, view.seating.buttonSeat == null ? "Place dealer button" : "Move dealer button"),
      selected ? el("button", {
        type: "button",
        class: "live-btn",
        onclick: () => clearSeat(view.selectedSeat),
      }, "Clear seat") : null,
      el("button", { type: "button", class: "live-btn", onclick: () => clearSeats() }, "Clear seats"),
      view.lastCommit ? el("button", {
        type: "button",
        class: "live-btn",
        onclick: () => { void undoLastHand(); },
      }, "Undo last hand") : null,
    ]),
  ]);
}

function hint() {
  if (!view.hand) {
    if (view.armButton) return "Tap the player who has the dealer button.";
    if (view.selectedSeat == null) {
      return "Tap a seat, then a player. Or drag a player onto a seat. Seats run clockwise from the bottom.";
    }
    const playerId = view.seating.seats[view.selectedSeat];
    const number = view.selectedSeat + 1;
    if (!playerId) return `Seat ${number} selected. Tap a player to seat them.`;
    return `Seat ${number}, ${nameOf(playerId)}. Tap a player to replace them, or clear the seat.`;
  }
  if (view.hand.phase === "pick") {
    return view.hand.winners.length > 1
      ? "More than one winner splits the hand. Save when the list is right."
      : "Tap each winner. Tap again to take them off.";
  }
  if (view.hand.street === "preflop") {
    return "Tap a player to fold. Hold the seat, or tap VPIP, if they entered the pot.";
  }
  if (view.hand.street === "showdown") return "Tap a player to fold. Name winners when the cards are shown.";
  return "Tap a player to fold.";
}

function renderRoster() {
  return el("div", { class: "live-roster" }, [
    el("h2", { text: "Players" }),
    el("div", { class: "live-roster-list", role: "list" }, view.players.map((player) => {
      const seatedAt = view.seating.seats.indexOf(player.id);
      const chip = el("button", {
        type: "button",
        class: `live-chip${seatedAt >= 0 ? " is-seated" : ""}${view.selectedSeat === seatedAt ? " is-chosen" : ""}`,
        role: "listitem",
        "aria-label": seatedAt >= 0 ? `${player.name}, seated` : player.name,
      }, [
        avatar(player),
        el("span", { text: player.name }),
      ]);
      const photo = chip.querySelector("img");
      if (photo) photo.draggable = false;
      bindPress(chip, {
        playerId: player.id,
        fromSeat: null,
        onTap: () => onRosterTap(player.id),
      });
      return chip;
    })),
  ]);
}

function renderStats() {
  const scoped = scopedHands();
  const small = scoped.length > 0 && scoped.length < SMALL_SAMPLE_HANDS;
  const people = playersInScope(scoped);
  return el("section", { class: "panel live-stats", id: "hand-stats" }, [
    el("div", { class: "section-head" }, [
      el("div", {}, [
        el("p", { class: "section-kicker", text: "From the logged hands" }),
        el("h2", { text: "Hand stats" }),
      ]),
      el("div", { class: "sort", role: "group", "aria-label": "Which hands to count" }, [
        scopeButton("all", "All hands"),
        scopeButton("session", "This session"),
      ]),
    ]),
    el("p", {
      class: "note",
      text: `${scoped.length === 1 ? "1 hand" : `${scoped.length} hands`} in this view.`,
    }),
    small ? el("p", {
      class: "note live-sample",
      text: `Under ${SMALL_SAMPLE_HANDS} hands in this log. Treat the percentages as a rough read.`,
    }) : null,
    scoped.length === 0
      ? el("p", { class: "note", text: "No hands logged yet. Stats fill in as hands are saved." })
      : statsTable(people, scoped, small),
    el("p", {
      class: "note",
      text: "Fold percentage is folds on that street divided by hands where the player was still in when the street was dealt. VPIP is voluntary pre-flop entries divided by hands dealt. Showdown is hands that reached a showdown divided by hands dealt. Showdown win is wins at showdown divided by hands that reached it.",
    }),
  ]);
}

function scopeButton(scope, label) {
  const on = view.scope === scope;
  return el("button", {
    type: "button",
    "aria-pressed": on ? "true" : "false",
    onclick: () => {
      view.scope = scope;
      paint();
    },
  }, label);
}

function statsTable(people, hands, panelSmall) {
  return el("div", { class: "live-table-wrap" }, [
    el("table", { class: "live-stats-table" }, [
      el("caption", { class: "sr-only", text: "Hand stats" }),
      el("thead", {}, [
        el("tr", {}, [
          el("th", { scope: "col", text: "Player" }),
          ...STAT_ROWS.map(([label]) => el("th", { scope: "col", class: "num", text: label })),
        ]),
      ]),
      el("tbody", {}, people.map((player) => {
        const stats = statsForPlayer(hands, player.id);
        const quiet = !panelSmall && stats.handsDealt > 0 && stats.smallSample;
        return el("tr", {}, [
          el("th", { scope: "row" }, [
            el("span", { class: "who" }, [
              avatar(personOf(player.id)),
              el("span", {}, [
                el("span", { class: "name", text: player.name }),
                quiet ? el("span", { class: "row-meta", text: `Under ${SMALL_SAMPLE_HANDS} hands` }) : null,
              ]),
            ]),
          ]),
          ...STAT_ROWS.map(([, read]) => el("td", { class: "num", text: read(stats) })),
        ]);
      })),
    ]),
  ]);
}

function renderHeadToHead() {
  const options = pickerPeople();
  return el("section", { class: "panel live-h2h" }, [
    el("p", { class: "section-kicker", text: "Side by side" }),
    el("h2", { text: "Head to head" }),
    el("div", { class: "live-picks" }, [
      playerSelect("Player A", view.h2hA, view.h2hB, options, (id) => setMatchup("a", id)),
      playerSelect("Player B", view.h2hB, view.h2hA, options, (id) => setMatchup("b", id)),
    ]),
    view.h2hA && view.h2hB
      ? el("div", { class: "live-versus" }, [
        matchColumn(view.h2hA),
        matchColumn(view.h2hB),
      ])
      : el("p", { class: "note", text: "Choose two players to compare the same stats." }),
  ]);
}

function playerSelect(label, current, other, options, onChange) {
  return el("label", { class: "live-pick" }, [
    el("span", { text: label }),
    el("select", {
      onchange: (event) => onChange(event.target.value),
    }, [
      el("option", { value: "", text: "Choose", selected: current === "" }),
      ...options.map((player) => el("option", {
        value: player.id,
        text: player.name,
        selected: player.id === current,
        disabled: player.id === other,
      })),
    ]),
  ]);
}

function matchColumn(playerId) {
  const stats = statsForPlayer(scopedHands(), playerId);
  const note = stats.handsDealt === 0
    ? "No hands in this view."
    : stats.smallSample
      ? `Under ${SMALL_SAMPLE_HANDS} hands. These rates can swing.`
      : "";
  return el("article", {}, [
    el("div", { class: "live-person" }, [
      avatar(personOf(playerId)),
      el("h3", { text: nameOf(playerId) }),
    ]),
    note ? el("p", { class: "note", text: note }) : null,
    el("dl", {}, STAT_ROWS.map(([label, read]) => el("div", {}, [
      el("dt", { text: label }),
      el("dd", { class: "num", text: read(stats) }),
    ]))),
  ]);
}

function renderLog() {
  return el("section", { class: "panel live-log" }, [
    el("p", { class: "section-kicker", text: "On this device" }),
    el("h2", { text: "Hand log" }),
    el("p", {
      class: "note",
      text: "Hands stay in this browser. Export a copy to keep them. A remote log can replace the storage module later. No chip counts are stored.",
    }),
    el("div", { class: "live-action-row" }, [
      el("button", { type: "button", class: "live-btn", onclick: () => { void onExport(); } }, "Export JSON"),
      el("button", { type: "button", class: "live-btn", onclick: () => pickFile() }, "Import JSON"),
      el("button", { type: "button", class: "live-btn", onclick: () => { void clearLog(); } }, "Clear log"),
    ]),
  ]);
}

function scopedHands() {
  if (view.scope === "session") {
    return view.hands.filter((hand) => hand.sessionDate === view.seating.sessionDate);
  }
  return view.hands;
}

function playersInScope(hands) {
  const ids = new Set(view.seating.seats.filter(Boolean));
  for (const hand of hands) {
    for (const seat of hand.seats || []) {
      if (seat?.playerId) ids.add(seat.playerId);
    }
  }
  const ordered = [];
  for (const player of view.players) {
    if (ids.has(player.id)) ordered.push(player);
  }
  for (const id of ids) {
    if (!view.byId.has(id)) ordered.push({ id, name: id });
  }
  return ordered;
}

function pickerPeople() {
  const ids = new Set(view.players.map((player) => player.id));
  const extras = [];
  for (const hand of view.hands) {
    for (const seat of hand.seats || []) {
      if (seat?.playerId && !ids.has(seat.playerId)) {
        ids.add(seat.playerId);
        extras.push({ id: seat.playerId, name: seat.playerId });
      }
    }
  }
  return [...view.players, ...extras];
}

function setMatchup(side, id) {
  if (side === "a") {
    view.h2hA = id;
    if (view.h2hB === id) view.h2hB = "";
  } else {
    view.h2hB = id;
    if (view.h2hA === id) view.h2hA = "";
  }
  paint();
}

function setSessionDate(value) {
  if (!isSessionDate(value)) return;
  view.seating.sessionDate = value;
  view.store.putSeating(view.seating).catch(showStoreError);
  paint();
}

function onSeatClick(index) {
  if (swallowed()) return;
  if (!view.hand) {
    if (view.armButton) {
      if (!view.seating.seats[index]) {
        setMessage("The dealer button sits on a player.", "warn");
        paint();
        return;
      }
      view.seating.buttonSeat = index;
      view.armButton = false;
      view.selectedSeat = index;
      setMessage(`Dealer button on seat ${index + 1}, ${nameOf(view.seating.seats[index])}.`);
      view.store.putSeating(view.seating).catch(showStoreError);
      paint();
      return;
    }
    view.selectedSeat = index;
    setMessage("");
    paint();
    return;
  }
  const playerId = view.seating.seats[index];
  if (!playerId) return;
  if (view.hand.phase === "pick") {
    apply((hand) => toggleWinner(hand, view.seating.seats, playerId));
    return;
  }
  apply((hand) => foldPlayer(hand, view.seating.seats, playerId, view.seating.buttonSeat));
}

function onSeatHold(index) {
  const playerId = view.seating.seats[index];
  if (!playerId) return;
  apply((hand) => toggleVpip(hand, view.seating.seats, playerId));
}

function onRosterTap(playerId) {
  if (swallowed() || view.hand) return;
  const from = view.seating.seats.indexOf(playerId);
  if (view.selectedSeat == null) {
    if (from >= 0) view.selectedSeat = from;
    else setMessage("Tap a seat, then tap a player.", "warn");
    paint();
    return;
  }
  placePlayer(playerId, view.selectedSeat, { swap: false });
}

function placePlayer(playerId, seatIndex, { swap = false } = {}) {
  if (view.hand) return;
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= SEAT_COUNT) return;
  const seats = view.seating.seats.slice();
  const from = seats.indexOf(playerId);
  if (from === seatIndex) return;
  const occupant = seats[seatIndex];
  if (from >= 0) seats[from] = swap && occupant ? occupant : null;
  seats[seatIndex] = playerId;
  const lostButton = view.seating.buttonSeat != null && !seats[view.seating.buttonSeat];
  view.seating.seats = seats;
  if (lostButton) view.seating.buttonSeat = null;
  view.selectedSeat = seatIndex;
  view.armButton = false;
  setMessage(lostButton ? "Dealer button cleared. Place it on a seated player." : "", lostButton ? "warn" : "");
  view.store.putSeating(view.seating).catch(showStoreError);
  paint();
}

function clearSeat(index) {
  if (view.hand || index == null) return;
  const seats = view.seating.seats.slice();
  seats[index] = null;
  view.seating.seats = seats;
  if (view.seating.buttonSeat === index) view.seating.buttonSeat = null;
  view.store.putSeating(view.seating).catch(showStoreError);
  setMessage(`Seat ${index + 1} cleared.`);
  paint();
}

function clearSeats() {
  if (view.hand) return;
  if (!view.seating.seats.some(Boolean) && view.seating.buttonSeat == null) return;
  if (!window.confirm("Clear every seat and the dealer button?")) return;
  view.seating.seats = Array.from({ length: SEAT_COUNT }, () => null);
  view.seating.buttonSeat = null;
  view.selectedSeat = null;
  view.armButton = false;
  view.store.putSeating(view.seating).catch(showStoreError);
  setMessage("Table cleared.");
  paint();
}

function startHand() {
  const seated = view.seating.seats.filter(Boolean).length;
  if (seated < 2) {
    setMessage("Seat at least two players.", "warn");
    paint();
    return;
  }
  if (view.seating.buttonSeat == null || !view.seating.seats[view.seating.buttonSeat]) {
    setMessage("Choose the dealer button.", "warn");
    paint();
    return;
  }
  view.hand = freshHand();
  view.undo = [];
  view.lastCommit = null;
  view.selectedSeat = null;
  view.armButton = false;
  setMessage("Pre-flop. Tap a player to fold.");
  persistDraft().catch(showStoreError);
  paint();
}

function cancelHand() {
  if (!view.hand) return;
  if (!window.confirm("Throw out this hand without saving?")) return;
  view.hand = null;
  view.undo = [];
  setMessage("Hand thrown out.");
  persistDraft().catch(showStoreError);
  paint();
}

function onNextStreet() {
  apply((hand) => advanceStreet(hand));
}

function onNameWinners() {
  apply((hand) => beginPick(hand));
}

function onBack() {
  apply((hand) => cancelPick(hand));
}

function onSave() {
  if (!view.hand?.winners.length) {
    setMessage("Tap at least one winner.", "warn");
    paint();
    return;
  }
  apply((hand) => confirmWinners(hand, view.seating.seats, view.seating.buttonSeat));
}

function onUndo() {
  if (!view.hand) return;
  if (view.undo.length === 0) {
    setMessage("Nothing to undo.", "warn");
    paint();
    return;
  }
  view.hand = view.undo.pop();
  setMessage(view.hand.phase === "pick" ? "Tap each winner." : STREET_LABEL[view.hand.street]);
  persistDraft().catch(showStoreError);
  paint();
}

function apply(mutator) {
  if (!view.hand || saving) return;
  const before = cloneHand(view.hand);
  const next = mutator(view.hand);
  if (next === view.hand) return;
  if (next.phase === "done") {
    void commitFinished(next, before);
    return;
  }
  if (next.street !== view.hand.street) setMessage(STREET_LABEL[next.street]);
  else if (next.phase === "pick" && view.hand.phase !== "pick") setMessage("Tap each winner.");
  else if (next.phase === "play" && view.hand.phase === "pick") setMessage(STREET_LABEL[next.street]);
  view.undo.push(before);
  if (view.undo.length > 30) view.undo.shift();
  view.hand = next;
  view.lastCommit = null;
  persistDraft().catch(showStoreError);
  paint();
}

async function commitFinished(next, before) {
  if (saving) return;
  saving = true;
  try {
    const record = stampHand(next.result, {
      id: createHandId(),
      sessionDate: view.seating.sessionDate,
      timestamp: new Date().toISOString(),
    });
    const hands = [...view.hands, record];
    await view.store.putHands(hands);
    const buttonBefore = view.seating.buttonSeat;
    view.hands = hands;
    view.lastCommit = {
      id: record.id,
      handBefore: before,
      undoStack: view.undo.slice(),
      buttonSeat: buttonBefore,
    };
    view.hand = null;
    view.undo = [];
    view.seating.buttonSeat = nextButtonSeat(view.seating.seats, buttonBefore);
    await view.store.putSeating(view.seating);
    await view.store.putDraft({ hand: null, undo: [], lastCommit: view.lastCommit });
    setMessage(winMessage(record));
  } catch (error) {
    setMessage(error?.message || "The hand could not be saved.", "warn");
  } finally {
    saving = false;
    paint();
  }
}

function winMessage(record) {
  const who = joinNames(record.winners);
  const line = record.winners.length > 1 ? `${who} split the hand.` : `${who} wins.`;
  const seat = view.seating.buttonSeat;
  const playerId = seat == null ? "" : view.seating.seats[seat];
  return playerId ? `${line} Button moves to ${nameOf(playerId)}.` : line;
}

function joinNames(ids) {
  const names = ids.map((id) => nameOf(id));
  if (names.length <= 1) return names[0] || "No one";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

async function undoLastHand() {
  const commit = view.lastCommit;
  if (!commit || view.hand) return;
  try {
    const hands = view.hands.filter((hand) => hand.id !== commit.id);
    await view.store.putHands(hands);
    view.hands = hands;
    view.hand = commit.handBefore;
    view.undo = commit.undoStack.slice();
    view.seating.buttonSeat = commit.buttonSeat;
    view.lastCommit = null;
    await view.store.putSeating(view.seating);
    await persistDraft();
    setMessage("Last hand is back on the table.");
  } catch (error) {
    setMessage(error?.message || "Could not undo that hand.", "warn");
  }
  paint();
}

async function persistDraft() {
  if (!view.store) return;
  if (!view.hand && !view.lastCommit) {
    await view.store.putDraft(null);
    return;
  }
  await view.store.putDraft({
    hand: view.hand,
    undo: view.undo,
    lastCommit: view.hand ? null : view.lastCommit,
  });
}

async function toggleScreen() {
  const on = document.body.classList.contains("live-fullscreen");
  if (on) {
    document.body.classList.remove("live-fullscreen");
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* the class is already off */ }
    }
  } else {
    document.body.classList.add("live-fullscreen");
    try { await document.documentElement.requestFullscreen(); } catch { /* the class still fills the window */ }
  }
  paint();
}

async function onExport() {
  try {
    const json = await view.store.exportJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a", {
      href: url,
      download: `fazpoke-hands-${view.seating.sessionDate}.json`,
    });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("Hand log exported.");
  } catch (error) {
    setMessage(error?.message || "Could not export the log.", "warn");
  }
  paint();
}

function pickFile() {
  const input = el("input", {
    type: "file",
    accept: "application/json,.json",
    class: "sr-only",
    onchange: () => {
      const file = input.files?.[0];
      input.remove();
      if (file) void onImport(file);
    },
  });
  document.body.append(input);
  input.click();
}

async function onImport(file) {
  let text = "";
  try {
    text = await file.text();
    parseHandLog(text);
  } catch (error) {
    setMessage(error?.message || "That file is not a hand log.", "warn");
    paint();
    return;
  }
  const seatingNote = JSON.parse(text).seating ? " and the saved seating" : "";
  const extra = view.hand ? " The hand in progress will be thrown out." : "";
  if (!window.confirm(`Replace the logged hands${seatingNote} with this file?${extra}`)) return;
  try {
    const result = await view.store.importJSON(text);
    view.hands = result.hands;
    if (result.seating) view.seating = result.seating;
    view.hand = null;
    view.undo = [];
    view.lastCommit = null;
    view.selectedSeat = null;
    view.armButton = false;
    const count = result.hands.length;
    setMessage(`Imported ${count === 1 ? "1 hand" : `${count} hands`}.`);
  } catch (error) {
    setMessage(error?.message || "That file is not a hand log.", "warn");
  }
  paint();
}

async function clearLog() {
  if (!view.hands.length) {
    setMessage("The log is already empty.");
    paint();
    return;
  }
  if (!window.confirm("Delete every logged hand on this device?")) return;
  try {
    await view.store.putHands([]);
    view.hands = [];
    view.lastCommit = null;
    await persistDraft();
    setMessage("Hand log cleared.");
  } catch (error) {
    setMessage(error?.message || "The log could not be cleared.", "warn");
  }
  paint();
}

function bindPress(node, config) {
  let timer = 0;
  let start = null;
  let held = false;
  let moved = false;

  node.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    held = false;
    moved = false;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    if (config.onHold) {
      timer = window.setTimeout(() => {
        held = true;
        swallow();
        config.onHold();
      }, 480);
    }
    if (config.playerId && !view.hand) {
      drag = {
        playerId: config.playerId,
        fromSeat: config.fromSeat ?? null,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        active: false,
      };
      node.setPointerCapture?.(event.pointerId);
    }
  });

  node.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== start.id) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > 12) {
      moved = true;
      window.clearTimeout(timer);
    }
    if (!drag || drag.pointerId !== event.pointerId || view.hand) return;
    if (!drag.active && !moved) return;
    if (!drag.active) {
      drag.active = true;
      showGhost(drag.playerId, event.clientX, event.clientY);
    } else {
      moveGhost(event.clientX, event.clientY);
    }
    markDrop(seatAt(event.clientX, event.clientY));
  });

  const endPointer = (event, cancelled) => {
    if (start && event.pointerId !== start.id) return;
    window.clearTimeout(timer);
    if (moved) swallow();
    start = null;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const info = drag;
    drag = null;
    const seat = !cancelled && info.active ? seatAt(event.clientX, event.clientY) : null;
    hideGhost();
    markDrop(null);
    if (!info.active) return;
    if (seat != null) placePlayer(info.playerId, seat, { swap: info.fromSeat != null });
  };

  node.addEventListener("pointerup", (event) => endPointer(event, false));
  node.addEventListener("pointercancel", (event) => endPointer(event, true));
  node.addEventListener("click", (event) => {
    if (held || swallowed()) {
      held = false;
      event.preventDefault();
      return;
    }
    config.onTap?.();
  });
  node.addEventListener("contextmenu", (event) => event.preventDefault());
}

function ghostNode() {
  let node = document.querySelector(".live-ghost");
  if (!node) {
    node = el("div", { class: "live-ghost", hidden: true });
    document.body.append(node);
  }
  return node;
}

function showGhost(playerId, x, y) {
  const node = ghostNode();
  const person = personOf(playerId);
  const photo = avatar(person);
  photo.draggable = false;
  node.replaceChildren(photo, el("span", { text: person.name }));
  node.hidden = false;
  moveGhost(x, y);
}

function moveGhost(x, y) {
  const node = ghostNode();
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
}

function hideGhost() {
  const node = document.querySelector(".live-ghost");
  if (node) node.hidden = true;
}

function markDrop(index) {
  document.querySelectorAll(".live-seat").forEach((seat) => {
    seat.classList.toggle("is-drop", index != null && Number(seat.dataset.seat) === index);
  });
}

function seatAt(x, y) {
  const floating = document.querySelector(".live-ghost");
  const wasHidden = !floating || floating.hidden;
  if (floating) floating.hidden = true;
  const node = document.elementFromPoint(x, y);
  if (floating && !wasHidden) floating.hidden = false;
  const direct = node?.closest?.("[data-seat]");
  if (direct) return Number(direct.dataset.seat);
  let best = null;
  let bestDist = 78;
  document.querySelectorAll(".live-seat").forEach((seat) => {
    const rect = seat.getBoundingClientRect();
    const dist = Math.hypot(x - rect.left, y - rect.top);
    if (dist < bestDist) {
      bestDist = dist;
      best = Number(seat.dataset.seat);
    }
  });
  return best;
}
