import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildModel } from "../js/stats.js";
import {
  parseHash,
  sessionHeading,
  sessionPage,
  sessionTabLabel,
} from "../js/sessions.js";

const players = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
const sessions = JSON.parse(readFileSync(new URL("../data/sessions.json", import.meta.url), "utf8"));

test("session 1 is dated 6 Nov 2026 and that date is the heading", () => {
  assert.equal(sessions[0].date, "2026-11-06");
  const model = buildModel(players, sessions);
  const page = sessionPage(model.sessions, "");
  assert.equal(page.session.id, "session-1");
  assert.equal(page.heading, "Session 1 · 6 Nov 2026");
  assert.equal(page.showTabs, false);
  assert.equal(page.session.totalEarnings, 1790);
  assert.equal(model.byId.get("dom").history[0].date, "2026-11-06");
  assert.equal(sessionHeading(model.byId.get("dom").history[0]), "Session 1 · 6 Nov 2026");
});

test("the latest of two sessions is selected by default", () => {
  const roster = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ];
  const ledger = [
    {
      id: "session-1",
      label: "Session 1",
      date: "2026-11-06",
      entries: [
        { playerId: "a", buyIn: 400, net: 100 },
        { playerId: "b", buyIn: 400, net: -100 },
      ],
    },
    {
      id: "session-2",
      label: "Session 2",
      date: "2026-11-13",
      entries: [
        { playerId: "a", buyIn: 500, net: 40 },
        { playerId: "b", buyIn: 500, net: -40 },
      ],
    },
  ];
  const model = buildModel(roster, ledger);
  const page = sessionPage(model.sessions, "");

  assert.equal(page.index, 1);
  assert.equal(page.session.id, "session-2");
  assert.equal(page.session.totalEarnings, 40);
  assert.equal(model.totals.totalEarnings, 140);
  assert.deepEqual(page.session.rows.map((row) => [row.playerId, row.net]), [
    ["a", 40],
    ["b", -40],
  ]);
  assert.equal(page.showTabs, true);
  assert.equal(page.heading, "Session 2 · 13 Nov 2026");
  assert.deepEqual(page.tabs.map((tab) => [tab.label, tab.selected, tab.hash]), [
    ["S1 · 6 Nov", false, "#/sessions/1"],
    ["S2 · 13 Nov", true, "#/sessions/2"],
  ]);

  const earlier = sessionPage(model.sessions, "1");
  assert.equal(earlier.session.id, "session-1");
  assert.equal(earlier.heading, "Session 1 · 6 Nov 2026");
  assert.equal(earlier.session.totalEarnings, 100);
  assert.equal(earlier.tabs[0].selected, true);
  assert.equal(sessionPage(model.sessions, "session-2").session.id, "session-2");
  assert.equal(sessionPage(model.sessions, "missing").session.id, "session-2");

  const reversed = buildModel(roster, [ledger[1], ledger[0]]);
  assert.equal(sessionPage(reversed.sessions, "").session.id, "session-2");
});

test("the highest number wins, then the most recent date", () => {
  const olderNight = { id: "session-3", label: "Session 3", date: "2026-11-01" };
  const newerNight = { id: "session-2", label: "Session 2", date: "2026-12-01" };
  assert.equal(sessionPage([newerNight, olderNight], "").session.id, "session-3");

  const byDate = [
    { id: "night-a", label: "Friday", date: "2026-11-20" },
    { id: "night-b", label: "Monday", date: "2026-11-02" },
  ];
  const dated = sessionPage(byDate, "");
  assert.equal(dated.session.id, "night-a");
  assert.equal(sessionTabLabel(byDate[0]), "Friday · 20 Nov");

  const undated = [
    { id: "session-1", label: "Session 1" },
    { id: "session-4", label: "Session 4", date: "2026-01-01" },
  ];
  assert.equal(sessionPage(undated, "").session.id, "session-4");
  assert.equal(sessionHeading({ label: "Session 1", date: "2026-02-31" }), "Session 1");
  assert.equal(sessionHeading({ label: "Session 1" }), "Session 1");
  assert.equal(sessionPage([], "").session, null);
  assert.equal(sessionPage([], "").showTabs, false);
});

test("session links do not replace the other routes", () => {
  assert.deepEqual(parseHash("#/sessions/1"), { name: "home", section: "ledger", session: "1" });
  assert.deepEqual(parseHash("#/sessions"), { name: "home", section: "ledger", session: "" });
  assert.deepEqual(parseHash("#/ledger"), { name: "home", section: "ledger", session: "" });
  assert.deepEqual(parseHash("#/board"), { name: "home", section: "board", session: "" });
  assert.deepEqual(parseHash("#/charts"), { name: "home", section: "charts", session: "" });
  assert.deepEqual(parseHash("#/"), { name: "home", section: "", session: "" });
  assert.deepEqual(parseHash(""), { name: "home", section: "", session: "" });
  assert.deepEqual(parseHash("#/live"), { name: "live", section: "", session: "" });
  assert.deepEqual(parseHash("#/player/dom"), { name: "player", id: "dom", section: "", session: "" });
});
