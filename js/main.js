import { avatar, el } from "./dom.js";
import { formatAmount, formatSigned, signedClass } from "./format.js";
import { buildModel, findPlayer, sortStandings } from "./stats.js";
import { colorMap, mountChart, seriesFromPlayer } from "./chart.js";
import { mountLive, unmountLive } from "./live.js";

const state = {
  players: [],
  sessions: [],
  ready: false,
  error: "",
  sortKey: "net",
  sortDir: "desc",
  highlightId: null,
  selectedId: null,
  route: { name: "home", section: "" },
};

const SORTS = [
  { key: "net", label: "Total earnings" },
  { key: "sessionsPlayed", label: "Sessions" },
];

function parseRoute() {
  const parts = decodeURIComponent(location.hash.replace(/^#/, ""))
    .split("/")
    .filter(Boolean);
  if (parts[0] === "player" && parts[1]) return { name: "player", id: parts[1] };
  if (parts[0] === "live") return { name: "live" };
  return { name: "home", section: parts[0] || "" };
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

function summary(model) {
  const cells = [
    ["Sessions", String(model.totals.sessions), ""],
    ["Recorded", String(model.totals.recordedPlayers), ""],
    ["Buy-in", formatAmount(model.totals.buyIn), ""],
    ["Total earnings", formatAmount(model.totals.totalEarnings), ""],
  ];
  return el("div", { class: "ledger-totals" }, [
    el("div", { class: "summary", role: "group", "aria-label": "Totals" }, cells.map(([label, value, tone]) => el("div", {}, [
      el("span", { class: "label", text: label }),
      el("strong", { class: `num ${tone}`, text: value }),
    ]))),
    el("p", {
      class: "summary-note",
      text: "Total earnings adds the winnings in each session. Unrecorded results are left out.",
    }),
  ]);
}

function board(model) {
  const ranked = sortStandings(model.standings, state.sortKey, state.sortDir);
  const sortLabel = SORTS.find((item) => item.key === state.sortKey)?.label || "Total earnings";
  const direction = state.sortDir === "desc" ? "high to low" : "low to high";
  const sessionsLabel = (count) => (count === 1 ? "1 session" : `${count} sessions`);

  const head = el("div", { class: "row row-head", "aria-hidden": "true" }, [
    el("span"),
    el("span"),
    el("span", { text: "Player" }),
    el("span", { class: "col-sessions", text: "Sessions" }),
    el("span", { class: "col-net", text: "Total earnings" }),
  ]);

  const rows = ranked.map((player, index) => el("a", {
    class: `row${index === 0 ? " lead" : ""}`,
    href: `#/player/${player.id}`,
    "aria-label": `${index + 1}. ${player.name}. ${sessionsLabel(player.sessionsPlayed)}. Total earnings ${formatSigned(player.net)}.`,
  }, [
    el("span", { class: "rank num", text: String(index + 1) }),
    avatar(player),
    el("span", { class: "who" }, [
      el("span", { class: "name", text: player.name }),
    ]),
    el("span", { class: "col-sessions num", text: String(player.sessionsPlayed) }),
    el("span", { class: `col-net num ${signedClass(player.net)}`, text: formatSigned(player.net) }),
  ]));

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
  const section = el("section", { class: "panel", id: "ledger" }, [
    el("p", { class: "section-kicker", text: "Ledger" }),
    el("h2", { text: "Sessions" }),
    el("p", {
      class: "note",
      text: "Entries stay in the order they were written down. Total earnings adds the winnings in that session. Unrecorded results are left out.",
    }),
    summary(model),
  ]);

  if (!model.sessions.length) {
    section.append(el("p", { class: "note", text: "No sessions yet." }));
    return section;
  }

  for (const session of model.sessions) {
    const table = el("table", {}, [
      el("caption", { text: session.label }),
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
  }

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
      el("a", { href: "#/ledger", text: item.label }),
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

function render() {
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
    main.replaceChildren(el("p", { class: "note", text: live ? "Loading the table…" : "Loading ledger…" }));
    return;
  }

  if (live) {
    document.title = "Live table · Fazwazpoker";
    mountLive(main, state.players);
    return;
  }

  const model = buildModel(state.players, state.sessions);
  const colors = colorMap(state.players, model.standings);
  const nodes = [];
  if (model.warnings.length) {
    nodes.push(el("div", { class: "banner", role: "status", text: model.warnings.join(" ") }));
  }

  if (state.route.name === "player") {
    nodes.push(profile(model, colors));
  } else {
    document.title = "Fazwazpoker";
    const layout = el("div", { class: "layout" }, [
      board(model),
      charts(model, colors),
      ledger(model),
    ]);
    nodes.push(layout);
  }
  main.replaceChildren(...nodes);
  for (const host of document.querySelectorAll(".chart-host")) {
    if (host._pendingSpec) mountChart(host, host._pendingSpec);
  }
}

async function load() {
  try {
    const playersUrl = new URL("../data/players.json", import.meta.url);
    const sessionsUrl = new URL("../data/sessions.json", import.meta.url);
    const [playersRes, sessionsRes] = await Promise.all([fetch(playersUrl), fetch(sessionsUrl)]);
    if (!playersRes.ok || !sessionsRes.ok) throw new Error("missing");
    const players = await playersRes.json();
    const sessions = await sessionsRes.json();
    if (!Array.isArray(players) || !Array.isArray(sessions)) throw new Error("shape");
    state.players = players;
    state.sessions = sessions;
    state.ready = true;
  } catch {
    state.error = "The ledger could not be loaded. Serve this folder over HTTP, or open it on GitHub Pages.";
  }
  render();
}

state.route = parseRoute();
window.addEventListener("hashchange", () => {
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

load();
