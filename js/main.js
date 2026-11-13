import { avatar, el } from "./dom.js";
import { formatAmount, formatSigned, signedClass } from "./format.js";
import { awardBadges, buildModel, cumulativeNets, findPlayer, rankMoves, sortStandings } from "./stats.js";
import { colorMap, mountChart, seriesFromPlayer } from "./chart.js";
import { mountLive, unmountLive, updateLiveSessions } from "./live.js";
import { SHEET_API_URL } from "./config.js";
import { loadSheetSessions, mergeSessions, onLedgerRefresh, sheetEnabled } from "./sheets.js";
import { closeInvite, openInvite } from "./invite.js";
import { parseHash, sessionHash, sessionHeading, sessionPage } from "./sessions.js";
import {
  SITE_URL,
  canWebShare,
  leaderboardShareData,
  lineItShareUrl,
  shareNative,
} from "./share.js";

const state = {
  players: [],
  sessions: [],
  fileSessions: [],
  ready: false,
  error: "",
  sheetNote: "",
  sortKey: "net",
  sortDir: "desc",
  highlightId: null,
  selectedId: null,
  route: { name: "home", section: "", session: "" },
};

let focusSessionTab = false;

const SORTS = [
  { key: "net", label: "Total earnings" },
  { key: "sessionsPlayed", label: "Sessions" },
];

function parseRoute() {
  return parseHash(location.hash);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const COUNT_MS = 800;
const ROW_STAGGER_MS = 40;
let motionGen = 0;
let boardEntered = false;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function formatCount(target, shown) {
  if (shown === 0) {
    if (target > 0) return "+0";
    if (target < 0) return "-0";
    return "0";
  }
  return formatSigned(shown);
}

function countUp(node, target, gen) {
  const started = performance.now();
  const frame = (now) => {
    if (gen !== motionGen || !node.isConnected) return;
    const t = Math.min(1, (now - started) / COUNT_MS);
    const shown = t >= 1 ? target : Math.round(target * easeOutCubic(t));
    node.textContent = t >= 1 ? formatSigned(target) : formatCount(target, shown);
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function countBoard(root, gen) {
  for (const node of root.querySelectorAll("[data-earnings]")) {
    const target = Number(node.dataset.earnings);
    if (!Number.isFinite(target)) continue;
    countUp(node, target, gen);
  }
}

function movementView(move) {
  if (!move) return null;
  if (move.change === "new") {
    return {
      text: "NEW",
      tone: "new",
      title: "First recorded result is in the latest session.",
      phrase: "New",
    };
  }
  if (move.change === "flat") {
    return {
      text: "–",
      tone: "flat",
      title: "No change in total earnings rank since the previous session.",
      phrase: "Rank unchanged",
    };
  }
  const places = `${move.places} ${move.places === 1 ? "place" : "places"}`;
  if (move.change === "up") {
    return {
      text: `▲${move.places}`,
      tone: "up",
      title: `Up ${places} by total earnings since the previous session.`,
      phrase: `Up ${places}`,
    };
  }
  return {
    text: `▼${move.places}`,
    tone: "down",
    title: `Down ${places} by total earnings since the previous session.`,
    phrase: `Down ${places}`,
  };
}

function sparkline(values) {
  if (!values.length) return null;
  const width = 64;
  const height = 20;
  const pad = 2;
  const ns = "http://www.w3.org/2000/svg";
  const end = values[values.length - 1];
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", `spark ${end >= 0 ? "up" : "down"}`);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  if (values.length === 1) {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", String(width / 2));
    dot.setAttribute("cy", String(height / 2));
    dot.setAttribute("r", "2.2");
    dot.setAttribute("fill", "currentColor");
    svg.append(dot);
    return svg;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = span === 0
      ? height / 2
      : pad + (1 - (value - min) / span) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", points.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  svg.append(line);
  return svg;
}

function badgeNodes(list) {
  if (!list?.length) return null;
  return el("span", { class: "badges" }, list.map((badge) => el("span", {
    class: `badge badge-${badge.id}`,
    title: badge.title,
  }, [
    el("span", { class: "badge-mark", "aria-hidden": "true", text: badge.mark }),
    el("span", { class: "badge-label", text: badge.label }),
  ])));
}

function scrollToSection(section) {
  const target = document.getElementById(section || "board");
  if (!target) return;
  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
}

function syncNav() {
  const current = state.route.name === "live"
    ? "live"
    : state.route.name === "home"
      ? state.route.section || "board"
      : "";
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function setSort(key) {
  if (state.sortKey === key) state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
  else {
    state.sortKey = key;
    state.sortDir = "desc";
  }
  render();
}

function openSession(hash) {
  if (location.hash === hash) return;
  focusSessionTab = true;
  location.hash = hash;
}

function summary(model) {
  const cells = [
    ["Sessions", String(model.totals.sessions), ""],
    ["Recorded", String(model.totals.recordedPlayers), ""],
    ["Buy-in", formatAmount(model.totals.buyIn), ""],
    ["Total earnings", formatAmount(model.totals.totalEarnings), ""],
  ];
  return el("div", { class: "ledger-totals" }, [
    el("p", { class: "section-kicker", text: "All time" }),
    el("div", { class: "summary", role: "group", "aria-label": "All-time totals" }, cells.map(([label, value, tone]) => el("div", {}, [
      el("span", { class: "label", text: label }),
      el("strong", { class: `num ${tone}`, text: value }),
    ]))),
    el("p", {
      class: "summary-note",
      text: "Total earnings adds the winnings in each session. Unrecorded results are left out.",
    }),
  ]);
}

function board(model, enter) {
  const ranked = sortStandings(model.standings, state.sortKey, state.sortDir);
  const sortLabel = SORTS.find((item) => item.key === state.sortKey)?.label || "Total earnings";
  const direction = state.sortDir === "desc" ? "high to low" : "low to high";
  const sessionsLabel = (count) => (count === 1 ? "1 session" : `${count} sessions`);
  const motion = enter && !prefersReducedMotion();
  const moves = rankMoves(model.standings, model.sessions);
  const badges = awardBadges(model.standings);

  const head = el("div", { class: "row row-head", "aria-hidden": "true" }, [
    el("span"),
    el("span"),
    el("span", { text: "Player" }),
    el("span", { class: "col-sessions", text: "Sessions" }),
    el("span", { class: "col-net", text: "Total earnings" }),
  ]);

  const rows = ranked.map((player, index) => {
    const move = movementView(moves.get(player.id));
    const playerBadges = badges.get(player.id) || [];
    const badgePhrase = playerBadges.map((badge) => badge.label).join(", ");
    const label = [
      `${index + 1}. ${player.name}`,
      move?.phrase,
      badgePhrase,
      sessionsLabel(player.sessionsPlayed),
      `Total earnings ${formatSigned(player.net)}`,
    ].filter(Boolean).join(". ");
    return el("a", {
      class: `row${index === 0 ? " lead" : ""}${motion ? " row-in" : ""}`,
      href: `#/player/${player.id}`,
      style: motion ? { "--row-delay": `${index * ROW_STAGGER_MS}ms` } : undefined,
      "aria-label": `${label}.`,
    }, [
      el("span", { class: "rank" }, [
        el("span", { class: "rank-num num", text: String(index + 1) }),
        move ? el("span", { class: `move move-${move.tone}`, title: move.title, text: move.text }) : null,
      ]),
      avatar(player),
      el("span", { class: "who" }, [
        el("span", { class: "name", text: player.name }),
        badgeNodes(playerBadges),
      ]),
      el("span", { class: "col-sessions num", text: String(player.sessionsPlayed) }),
      el("span", { class: "col-net" }, [
        sparkline(cumulativeNets(player)),
        el("span", {
          class: `earnings num ${signedClass(player.net)}`,
          dataset: motion ? { earnings: String(player.net) } : undefined,
          text: motion ? formatCount(player.net, 0) : formatSigned(player.net),
        }),
      ]),
    ]);
  });

  const unrecorded = model.unrecorded.map((player) => {
    const meta = player.history.length
      ? player.history.map((item) => item.label).join(", ")
      : "No session on record";
    return el("a", {
      class: "row quiet",
      href: `#/player/${player.id}`,
      "aria-label": `${player.name}. Unrecorded. ${meta}.`,
    }, [
      el("span", { class: "rank", "aria-hidden": "true" }),
      avatar(player, "dim"),
      el("span", { class: "who" }, [
        el("span", { class: "name", text: player.name }),
        el("span", { class: "row-meta", text: meta }),
      ]),
      el("span", { class: "pill", text: "Unrecorded" }),
    ]);
  });

  return el("section", { class: "panel", id: "board" }, [
    el("div", { class: "section-head" }, [
      el("h1", { text: "Leaderboard" }),
      el("div", { class: "sort", role: "group", "aria-label": "Sort the leaderboard" }, SORTS.map((item) => {
        const on = state.sortKey === item.key;
        const arrow = on ? (state.sortDir === "desc" ? "↓" : "↑") : "";
        return el("button", {
          type: "button",
          "aria-pressed": on ? "true" : "false",
          onclick: () => setSort(item.key),
        }, `${item.label}${arrow ? ` ${arrow}` : ""}`);
      })),
    ]),
    el("p", {
      class: "note",
      text: `Sorted by ${sortLabel.toLowerCase()}, ${direction}. Equal values fall back to total earnings, then name.`,
    }),
    ranked.length
      ? el("div", { class: "rows standings" }, [head, ...rows])
      : el("p", { class: "note", text: "No recorded results yet." }),
    el("h2", { class: "subhead", text: "Unrecorded" }),
    el("p", {
      class: "note",
      text: "Still on the roster. Left out of the ranking and the charts until a result is recorded.",
    }),
    el("div", { class: "rows" }, unrecorded),
  ]);
}

function charts(model, colors) {
  const section = el("section", { class: "panel charts", id: "charts" }, [
    el("p", { class: "section-kicker", text: "Charts" }),
    el("h2", { text: "Cumulative net" }),
    el("p", {
      class: "note",
      text: "Each line starts at zero before the first session and moves when a result is recorded. A hollow point means that session has no recorded result, so the cumulative total stays where it was.",
    }),
  ]);

  const ranked = sortStandings(model.standings, "net", "desc");
  if (!ranked.length) {
    section.append(el("p", { class: "note", text: "No recorded results to chart." }));
    return section;
  }

  if (!ranked.some((player) => player.id === state.selectedId)) {
    state.selectedId = ranked[0].id;
  }

  const categories = ranked[0].points.map((point) => point.label);
  const allHost = el("div", { class: "chart-host" });
  const oneHost = el("div", { class: "chart-host" });

  section.append(
    el("h3", { text: "Everyone" }),
    allHost,
    el("h3", { class: "chart-sub", text: "One player" }),
    el("div", { class: "picker", role: "group", "aria-label": "Choose a player" }, ranked.map((player) => el("button", {
      type: "button",
      class: state.selectedId === player.id ? "on" : "",
      "aria-pressed": state.selectedId === player.id ? "true" : "false",
      onclick: () => {
        state.selectedId = player.id;
        state.highlightId = player.id;
        render();
      },
    }, [
      avatar(player),
      el("span", { text: player.name }),
    ]))),
    oneHost,
  );

  const series = ranked.map((player) => seriesFromPlayer(player, colors.get(player.id)));
  allHost._pendingSpec = {
    label: "Cumulative net for every recorded player",
    categories,
    series,
    activeId: state.highlightId,
    onToggle: (id) => {
      state.highlightId = state.highlightId === id ? null : id;
      render();
    },
  };

  const selected = ranked.find((player) => player.id === state.selectedId);
  oneHost._pendingSpec = {
    label: `Cumulative net for ${selected.name}`,
    categories,
    series: [seriesFromPlayer(selected, colors.get(selected.id))],
    activeId: null,
    onToggle: () => {},
  };

  return section;
}

function ledger(model) {
  const page = sessionPage(model.sessions, state.route.session);
  const section = el("section", { class: "panel", id: "ledger" }, [
    el("p", { class: "section-kicker", text: "Sessions" }),
    el("h2", { id: "session-heading", text: page.heading || "Sessions" }),
    el("p", {
      class: "note",
      text: page.session
        ? "One session at a time. Entries stay in the order they were written down. Total earnings adds the winnings in this session. Unrecorded results are left out."
        : "Entries stay in the order they were written down. Total earnings adds the winnings in a session. Unrecorded results are left out.",
    }),
    summary(model),
  ]);

  if (!page.session) {
    section.append(el("p", { class: "note", text: "No sessions yet." }));
    return section;
  }

  if (page.showTabs) {
    section.append(el("div", {
      class: "session-tabs",
      role: "tablist",
      "aria-label": "Sessions",
    }, page.tabs.map((tab) => el("button", {
      type: "button",
      role: "tab",
      "aria-selected": tab.selected ? "true" : "false",
      "aria-controls": "session-sheet",
      onclick: () => openSession(tab.hash),
    }, tab.label))));
  }

  const session = page.session;
  const table = el("table", { id: "session-sheet", "aria-labelledby": "session-heading" }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col", text: "Player" }),
        el("th", { scope: "col", class: "num", text: "Buy-in" }),
        el("th", { scope: "col", class: "num", text: "Net" }),
      ]),
    ]),
    el("tbody", {}, session.rows.map((row) => {
      const person = model.byId.get(row.playerId);
      const name = person?.name || row.playerId;
      const who = el("span", { class: "who" }, [
        avatar(person || { name }),
        person
          ? el("a", { href: `#/player/${person.id}`, text: name })
          : el("span", { text: name }),
      ]);
      const netCell = row.recorded
        ? el("td", { class: `num ${signedClass(row.net)}`, text: formatSigned(row.net) })
        : el("td", { class: "pending", text: "Unrecorded" });
      const buyCell = row.buyIn == null
        ? el("td", { class: "num", text: "—" })
        : el("td", { class: "num", text: formatAmount(row.buyIn) });
      return el("tr", {}, [
        el("th", { scope: "row" }, who),
        buyCell,
        netCell,
      ]);
    })),
    el("tfoot", {}, [
      el("tr", {}, [
        el("th", { scope: "row", text: "Recorded total" }),
        el("td", { class: "num", text: formatAmount(session.buyIn) }),
        el("td"),
      ]),
      el("tr", {}, [
        el("th", { scope: "row", text: "Total earnings" }),
        el("td"),
        el("td", { class: "num", text: formatAmount(session.totalEarnings) }),
      ]),
    ]),
  ]);
  section.append(el("div", { class: "table-wrap" }, table));

  return section;
}

function stat(label, value, tone = "") {
  return el("div", {}, [
    el("dt", { text: label }),
    el("dd", { class: `num ${tone}`, text: value }),
  ]);
}

function profile(model, colors) {
  const player = findPlayer(model, state.route.id);
  const page = el("article", { class: "profile panel" });
  page.append(el("a", { class: "back", href: "#/board" }, "← Board"));

  if (!player) {
    document.title = "Fazwazpoker";
    page.append(el("h1", { text: "Player not found" }), el("p", { class: "note", text: "That id is not in the roster." }));
    return page;
  }

  document.title = `${player.name} · Fazwazpoker`;
  const heroValue = player.recorded ? formatSigned(player.net) : "Unrecorded";
  const heroTone = player.recorded ? signedClass(player.net) : "pending";

  page.append(el("header", { class: "hero" }, [
    avatar(player, player.recorded ? "hero-photo" : "hero-photo dim"),
    el("div", {}, [
      el("p", { class: "section-kicker", text: "Player" }),
      el("h1", { text: player.name }),
      el("p", { class: `hero-net ${heroTone}`, text: heroValue }),
      el("p", {
        class: "note",
        text: player.recorded
          ? "Cumulative net from recorded sessions."
          : "No recorded result, so this player is off the board and off the charts.",
      }),
    ]),
  ]));

  if (player.recorded) {
    page.append(el("dl", { class: "stats" }, [
      stat("Net", formatSigned(player.net), signedClass(player.net)),
      stat("Buy-in", formatAmount(player.buyIn)),
      stat("Sessions", String(player.sessionsPlayed)),
      stat("Best session", formatSigned(player.best), signedClass(player.best)),
      stat("Worst session", formatSigned(player.worst), signedClass(player.worst)),
    ]));

    const host = el("div", { class: "chart-host" });
    host._pendingSpec = {
      label: `Cumulative net for ${player.name}`,
      categories: player.points.map((point) => point.label),
      series: [seriesFromPlayer(player, colors.get(player.id))],
      activeId: null,
      onToggle: () => {},
    };
    page.append(
      el("h2", { text: "Cumulative net" }),
      el("p", {
        class: "note",
        text: "The line starts at zero before the first session.",
      }),
      host,
    );
  }

  const history = el("section", {}, [
    el("h2", { text: "Sessions" }),
  ]);
  if (!player.history.length) {
    history.append(el("p", { class: "note", text: "No session on record." }));
  } else {
    history.append(el("ul", { class: "history" }, player.history.map((item) => el("li", {}, [
      el("a", {
        href: sessionHash({ id: item.sessionId, label: item.label }),
        text: sessionHeading(item),
      }),
      el("span", {
        class: "num",
        text: item.buyIn == null ? "Buy-in —" : `Buy-in ${formatAmount(item.buyIn)}`,
      }),
      item.recorded
        ? el("span", { class: `num ${signedClass(item.net)}`, text: formatSigned(item.net) })
        : el("span", { class: "pending", text: "Unrecorded" }),
    ]))));
  }
  page.append(history);
  return page;
}

function pinSelectedTab(row) {
  const current = row.querySelector("[aria-selected='true']");
  if (!current) return;
  const rowBox = row.getBoundingClientRect();
  const tabBox = current.getBoundingClientRect();
  const left = tabBox.left - rowBox.left + row.scrollLeft;
  const padding = 8;
  if (left < row.scrollLeft) row.scrollLeft = Math.max(0, left - padding);
  else if (left + tabBox.width > row.scrollLeft + row.clientWidth) {
    row.scrollLeft = left + tabBox.width - row.clientWidth + padding;
  }
}

function render() {
  const focusTab = focusSessionTab;
  focusSessionTab = false;
  const gen = ++motionGen;
  const main = document.querySelector("#content");
  const live = state.route.name === "live";
  syncNav();
  if (!live) unmountLive();
  if (state.error) {
    document.title = "Fazwazpoker";
    main.replaceChildren(el("p", { class: "banner", role: "alert", text: state.error }));
    return;
  }
  if (!state.ready) {
    main.replaceChildren(el("p", { class: "note", text: live ? "Loading the leaderboard…" : "Loading ledger…" }));
    return;
  }

  if (live) {
    document.title = "Live leaderboard · Fazwazpoker";
    mountLive(main, state.players, state.sessions);
    return;
  }

  const model = buildModel(state.players, state.sessions);
  const colors = colorMap(state.players, model.standings);
  const nodes = [];
  if (state.sheetNote) {
    nodes.push(el("div", { class: "banner", role: "status", text: state.sheetNote }));
  }
  if (model.warnings.length) {
    nodes.push(el("div", { class: "banner", role: "status", text: model.warnings.join(" ") }));
  }

  let enterBoard = false;
  if (state.route.name === "player") {
    nodes.push(profile(model, colors));
  } else {
    document.title = "Fazwazpoker";
    enterBoard = !boardEntered;
    boardEntered = true;
    const layout = el("div", { class: "layout" }, [
      board(model, enterBoard),
      charts(model, colors),
      ledger(model),
    ]);
    nodes.push(layout);
  }
  main.replaceChildren(...nodes);
  const tabRow = main.querySelector(".session-tabs");
  if (tabRow) pinSelectedTab(tabRow);
  if (focusTab) tabRow?.querySelector("[aria-selected='true']")?.focus({ preventScroll: true });
  if (enterBoard && !prefersReducedMotion()) countBoard(main, gen);
  for (const host of document.querySelectorAll(".chart-host")) {
    if (host._pendingSpec) mountChart(host, host._pendingSpec);
  }
}

async function sessionsWithSheet(fileSessions) {
  if (!sheetEnabled()) return fileSessions;
  try {
    const remote = await loadSheetSessions(SHEET_API_URL);
    state.sheetNote = "";
    return mergeSessions(fileSessions, remote);
  } catch {
    state.sheetNote = "The Google Sheet could not be loaded. Showing the saved ledger only.";
    return fileSessions;
  }
}

function ledgerDataUrl(path) {
  const url = new URL(path, import.meta.url);
  url.searchParams.set("v", String(Date.now()));
  return url;
}

async function load() {
  try {
    // Pages sends Cache-Control: max-age=600. Skip that cache so a refresh
    // shows the latest roster and sessions, including on the Live board.
    const fresh = { cache: "no-store" };
    const [playersRes, sessionsRes] = await Promise.all([
      fetch(ledgerDataUrl("../data/players.json"), fresh),
      fetch(ledgerDataUrl("../data/sessions.json"), fresh),
    ]);
    if (!playersRes.ok || !sessionsRes.ok) throw new Error("missing");
    const players = await playersRes.json();
    const sessions = await sessionsRes.json();
    if (!Array.isArray(players) || !Array.isArray(sessions)) throw new Error("shape");
    state.players = players;
    state.fileSessions = sessions;
    state.sessions = await sessionsWithSheet(sessions);
    state.ready = true;
  } catch {
    state.error = "The ledger could not be loaded. Serve this folder over HTTP, or open it on GitHub Pages.";
  }
  render();
}

onLedgerRefresh(async (saved) => {
  if (!state.ready) return;
  try {
    const remote = await loadSheetSessions(SHEET_API_URL);
    state.sessions = mergeSessions(state.fileSessions, saved ? [...remote, saved] : remote);
    state.sheetNote = "";
  } catch {
    state.sessions = saved ? mergeSessions(state.sessions, [saved]) : state.sessions;
    state.sheetNote = "The Google Sheet could not be loaded. Showing the saved ledger only.";
  }
  updateLiveSessions(state.sessions);
  if (!document.body.classList.contains("route-live")) render();
});

state.route = parseRoute();
function bindShare() {
  const line = document.querySelector("[data-share-line]");
  if (line) line.href = lineItShareUrl(SITE_URL);
  const more = document.querySelector("[data-share-more]");
  if (more && canWebShare()) {
    more.hidden = false;
    more.addEventListener("click", () => {
      void shareNative(leaderboardShareData());
    });
  }
  document.querySelector("[data-invite-open]")?.addEventListener("click", (event) => {
    openInvite(event.currentTarget);
  });
}

window.addEventListener("hashchange", () => {
  closeInvite();
  const previous = state.route;
  state.route = parseRoute();
  render();
  if (state.route.name === "player" || state.route.name === "live") {
    window.scrollTo(0, 0);
    document.querySelector("#content")?.focus({ preventScroll: true });
    return;
  }
  if (state.route.section && (previous.name !== "home" || previous.section !== state.route.section)) {
    scrollToSection(state.route.section);
  }
});

bindShare();
load();
