import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { formatAmount, formatSigned } from "../js/format.js";
import { buildModel, sortStandings } from "../js/stats.js";

const root = new URL("..", import.meta.url);
const players = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
const sessions = JSON.parse(readFileSync(new URL("../data/sessions.json", import.meta.url), "utf8"));

test("roster and the recorded sessions match the sheet", () => {
  assert.deepEqual(players.map((player) => player.name), [
    "Taam", "Bank", "Chase", "Fah", "JJ", "Dom", "Na", "Tip", "Will", "Zack", "Guy", "Golf", "Eye", "James", "Wilson", "Him", "Tae",
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].label, "Session 1");
  assert.equal(sessions[0].date, "2026-11-06");
  assert.equal(sessions[1].label, "Session 2");
  assert.equal(sessions[1].date, "2026-11-13");
  const ids = new Set(players.map((player) => player.id));
  for (const session of sessions) {
    for (const entry of session.entries) assert.equal(ids.has(entry.playerId), true);
  }
  const blob = JSON.stringify(players) + JSON.stringify(sessions);
  assert.deepEqual(blob.match(/\d{4}-\d{2}-\d{2}/g), ["2026-11-06", "2026-11-13"]);
  assert.equal(/vpip|hourly/i.test(blob), false);
});

test("session 1 totals and the break-even stay exact", () => {
  const model = buildModel(players, sessions);
  assert.equal(model.sessions[0].buyIn, 3700);
  assert.equal(model.sessions[0].net, 0);
  assert.equal(model.sessions[0].totalEarnings, 1790);
  assert.equal(model.totals.sessions, 2);
  assert.equal(model.totals.buyIn, 12200);
  assert.equal(model.totals.net, 0);
  assert.equal(model.totals.totalEarnings, 7010);
  assert.equal(model.standings.reduce((sum, player) => sum + player.net, 0), 0);
  assert.equal(model.standings.reduce((sum, player) => sum + player.buyIn, 0), 12200);

  const taam = model.standings.find((player) => player.id === "taam");
  assert.equal(taam.net, 735);
  assert.equal(taam.buyIn, 900);
  assert.equal(taam.sessionsPlayed, 2);
  assert.deepEqual(taam.points.map((point) => point.kind), ["baseline", "played", "played"]);
  assert.equal(taam.points[1].value, 0);
  assert.equal(taam.points[1].delta, 0);
  assert.equal(taam.points[2].value, 735);
  assert.equal(taam.points[2].delta, 735);

  const will = model.standings.find((player) => player.id === "will");
  assert.equal(will.net, 880);
  assert.equal(will.sessionsPlayed, 2);
  assert.equal(will.history[1].net, 0);
  assert.equal(will.history[1].recorded, true);

  assert.deepEqual(model.unrecorded.map((player) => player.id), ["chase", "jj", "na"]);
  assert.equal(model.unrecorded.every((player) => player.net === null), true);
  assert.equal(model.unrecorded.every((player) => player.points === null), true);
  assert.equal(model.unrecorded.every((player) => player.sessionsPlayed === 0), true);
  assert.deepEqual(model.byId.get("chase").history.map((item) => item.net), [null]);
  assert.deepEqual(model.byId.get("jj").history.map((item) => [item.sessionId, item.recorded]), [["session-1", false]]);
  assert.deepEqual(model.byId.get("na").history, []);
  assert.equal(model.unrecorded.find((player) => player.id === "na").recorded, false);

  const absent = new Set(sessions[1].entries.map((entry) => entry.playerId));
  for (const id of ["chase", "jj", "dom", "na", "tip"]) assert.equal(absent.has(id), false);
  const dom = model.standings.find((player) => player.id === "dom");
  assert.equal(dom.sessionsPlayed, 1);
  assert.equal(dom.net, 910);
  assert.deepEqual(dom.history.map((item) => item.sessionId), ["session-1"]);
  const tip = model.standings.find((player) => player.id === "tip");
  assert.equal(tip.sessionsPlayed, 1);
  assert.equal(tip.net, -400);
  assert.deepEqual(tip.history.map((item) => item.sessionId), ["session-1"]);
});

test("total earnings sums positive recorded nets and ignores blanks", () => {
  const model = buildModel(
    [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    [
      {
        id: "s1",
        label: "Session 1",
        entries: [
          { playerId: "a", buyIn: 100, net: 50 },
          { playerId: "b", buyIn: 100, net: null },
          { playerId: "c", buyIn: 100, net: 0 },
        ],
      },
      {
        id: "s2",
        label: "Session 2",
        entries: [
          { playerId: "a", buyIn: 100, net: -20 },
          { playerId: "b", buyIn: 100, net: 20 },
          { playerId: "c", buyIn: 100, net: -15 },
        ],
      },
    ],
  );
  assert.equal(model.sessions[0].totalEarnings, 50);
  assert.equal(model.sessions[1].totalEarnings, 20);
  assert.equal(model.totals.totalEarnings, 70);
});

test("leaderboard orders by total earnings, then sessions", () => {
  const model = buildModel(players, sessions);
  const byEarnings = sortStandings(model.standings, "net", "desc");
  assert.deepEqual(byEarnings.map((player) => player.id), [
    "tae", "zack", "dom", "will", "taam", "guy", "fah", "him", "james", "tip", "bank", "golf", "eye", "wilson",
  ]);
  assert.deepEqual(byEarnings.map((player) => player.net), [
    1915, 1365, 910, 880, 735, 405, -250, -260, -400, -400, -1000, -1200, -1300, -1400,
  ]);
  assert.deepEqual(byEarnings.map((player) => player.sessionsPlayed), [
    1, 2, 1, 2, 2, 0, 2, 1, 1, 1, 2, 1, 1, 1,
  ]);

  const bySessions = sortStandings(model.standings, "sessionsPlayed", "desc");
  assert.deepEqual(bySessions.map((player) => player.id), [
    "zack", "will", "taam", "fah", "bank", "tae", "dom", "him", "james", "tip", "golf", "eye", "wilson", "guy",
  ]);
  assert.equal(bySessions.at(-1).sessionsPlayed, 0);
  assert.equal(bySessions.at(-1).recorded, true);

  const mixed = buildModel(
    [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    [
      {
        id: "s1",
        label: "Session 1",
        entries: [
          { playerId: "a", buyIn: 100, net: 10 },
          { playerId: "b", buyIn: 100, net: 40 },
          { playerId: "c", buyIn: 100, net: -50 },
        ],
      },
      {
        id: "s2",
        label: "Session 2",
        entries: [
          { playerId: "a", buyIn: 100, net: 5 },
          { playerId: "c", buyIn: 100, net: 20 },
        ],
      },
    ],
  );
  const mixedBySessions = sortStandings(mixed.standings, "sessionsPlayed", "desc");
  assert.deepEqual(mixedBySessions.map((player) => [player.id, player.sessionsPlayed, player.net]), [
    ["a", 2, 15],
    ["c", 2, -30],
    ["b", 1, 40],
  ]);
});

test("a blank result is never coerced to zero, and a skipped session carries the total", () => {
  const model = buildModel(
    [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    [
      {
        id: "s1",
        label: "Session 1",
        entries: [
          { playerId: "a", buyIn: 100, net: 50 },
          { playerId: "b", buyIn: 100, net: null },
        ],
      },
      {
        id: "s2",
        label: "Session 2",
        entries: [
          { playerId: "a", buyIn: 100, net: -20 },
          { playerId: "b", buyIn: 100, net: 20 },
        ],
      },
    ],
  );
  assert.equal(model.sessions[0].net, 50);
  assert.equal(model.sessions[0].buyIn, 100);
  const a = model.standings.find((player) => player.id === "a");
  const b = model.standings.find((player) => player.id === "b");
  assert.deepEqual(a.points.map((point) => [point.kind, point.value]), [
    ["baseline", 0],
    ["played", 50],
    ["played", 30],
  ]);
  assert.equal(b.sessionsPlayed, 1);
  assert.equal(b.buyIn, 100);
  assert.equal(b.net, 20);
  assert.deepEqual(b.points.map((point) => [point.kind, point.value]), [
    ["baseline", 0],
    ["carried", 0],
    ["played", 20],
  ]);
});

test("a dealer result counts toward earnings and not toward sessions played", () => {
  const roster = [
    { id: "ace", name: "Ace" },
    { id: "host", name: "Host" },
    { id: "pat", name: "Pat" },
  ];
  const model = buildModel(roster, [
    {
      id: "s1",
      label: "Session 1",
      entries: [
        { playerId: "ace", buyIn: 100, net: 30 },
        { playerId: "host", buyIn: 0, net: -20, dealer: true },
        { playerId: "pat", buyIn: 100, net: -10 },
      ],
    },
    {
      id: "s2",
      label: "Session 2",
      entries: [
        { playerId: "ace", buyIn: 100, net: -15 },
        { playerId: "host", buyIn: 0, net: 25, dealer: true },
        { playerId: "pat", buyIn: 0, net: -10, dealer: "true" },
      ],
    },
  ]);

  assert.equal(model.sessions[0].net, 0);
  assert.equal(model.sessions[1].net, 0);
  assert.equal(model.sessions[0].totalEarnings, 30);
  assert.equal(model.sessions[1].totalEarnings, 25);
  assert.equal(model.totals.totalEarnings, 55);
  assert.equal(model.sessions[0].rows.find((row) => row.playerId === "host").dealer, true);
  assert.equal(model.sessions[0].rows.find((row) => row.playerId === "ace").dealer, false);

  const host = model.standings.find((player) => player.id === "host");
  assert.equal(model.unrecorded.some((player) => player.id === "host"), false);
  assert.equal(host.recorded, true);
  assert.equal(host.sessionsPlayed, 0);
  assert.equal(host.net, 5);
  assert.equal(host.buyIn, 0);
  assert.equal(host.best, 25);
  assert.equal(host.worst, -20);
  assert.deepEqual(host.points.map((point) => [point.kind, point.value, point.dealer]), [
    ["baseline", 0, false],
    ["played", -20, true],
    ["played", 5, true],
  ]);

  const pat = model.standings.find((player) => player.id === "pat");
  assert.equal(pat.sessionsPlayed, 2);
  assert.equal(pat.net, -20);
  assert.equal(pat.history[1].dealer, false);

  const playedAndDealt = buildModel(
    [{ id: "pat", name: "Pat" }],
    [
      { id: "s1", label: "Session 1", entries: [{ playerId: "pat", buyIn: 10, net: 10 }] },
      { id: "s2", label: "Session 2", entries: [{ playerId: "pat", buyIn: 0, net: 4, dealer: true }] },
    ],
  );
  const mixed = playedAndDealt.standings[0];
  assert.equal(mixed.sessionsPlayed, 1);
  assert.equal(mixed.net, 14);
  assert.deepEqual(mixed.points.map((point) => [point.kind, point.value, point.dealer]), [
    ["baseline", 0, false],
    ["played", 10, false],
    ["played", 14, true],
  ]);
  assert.equal(playedAndDealt.sessions[1].totalEarnings, 4);
  assert.equal(playedAndDealt.sessions[1].net, 4);
});

test("session 2 keeps Guy's dealer earnings off the session count", () => {
  const model = buildModel(players, sessions);
  const night = model.sessions[1];
  assert.equal(night.id, "session-2");
  assert.equal(night.date, "2026-11-13");
  assert.equal(night.buyIn, 8500);
  assert.equal(night.net, 0);
  assert.equal(night.totalEarnings, 5220);
  assert.equal(night.rows.reduce((sum, row) => sum + row.net, 0), 0);
  assert.deepEqual(night.rows.at(-1), {
    playerId: "guy",
    buyIn: 0,
    net: 405,
    recorded: true,
    dealer: true,
  });
  assert.equal(night.rows.some((row) => row.playerId !== "guy" && row.dealer), false);

  const guy = model.standings.find((player) => player.id === "guy");
  assert.equal(guy.name, "Guy");
  assert.equal(guy.photo, "assets/players/guy.png");
  assert.equal(guy.recorded, true);
  assert.equal(guy.sessionsPlayed, 0);
  assert.equal(guy.net, 405);
  assert.equal(guy.buyIn, 0);
  assert.equal(guy.best, 405);
  assert.equal(guy.worst, 405);
  assert.equal(guy.history.length, 1);
  assert.equal(guy.history[0].dealer, true);
  assert.equal(guy.history[0].sessionId, "session-2");
  assert.deepEqual(guy.points.map((point) => [point.kind, point.value, point.dealer]), [
    ["baseline", 0, false],
    ["carried", 0, false],
    ["played", 405, true],
  ]);
  assert.equal(model.unrecorded.some((player) => player.id === "guy"), false);

  const tae = model.standings.find((player) => player.id === "tae");
  assert.equal(tae.name, "Tae");
  assert.equal(Object.hasOwn(tae, "photo"), false);
  assert.equal(tae.net, 1915);
  assert.equal(tae.sessionsPlayed, 1);
});

test("figures are plain signed numbers", () => {
  assert.equal(formatSigned(910), "+910");
  assert.equal(formatSigned(-190), "-190");
  assert.equal(formatSigned(0), "0");
  assert.equal(formatSigned(-0), "0");
  assert.equal(formatSigned(3700), "+3,700");
  assert.equal(formatSigned(-1800), "-1,800");
  assert.equal(formatAmount(3700), "3,700");
  assert.equal(formatAmount(0), "0");
  for (const sample of [formatSigned(910), formatSigned(-190), formatSigned(0), formatAmount(3700)]) {
    assert.equal(/[$€£¥฿]/.test(sample), false);
  }
});

test("the site copy does not name a currency", () => {
  const banned = /[$€£¥฿₱₩₽₹]|\b(USD|THB|EUR|GBP|JPY|AUD|CAD|SGD|CNY|HKD)\b|\b(dollar|dollars|baht|euro|euros|pound|pounds|yen)s?\b/i;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "tests" || name === ".git") continue;
      const path = join(dir, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (/\.(html|css|js|json|md|svg)$/.test(name)) files.push(path);
    }
  };
  walk(new URL(root).pathname);
  const hits = [];
  for (const path of files) {
    const text = readFileSync(path, "utf8").replace(/\$\{/g, "");
    if (banned.test(text)) hits.push(path);
  }
  assert.deepEqual(hits, []);
});

test("every player photo exists", () => {
  const missing = players.filter((player) => !player.photo).map((player) => player.id);
  assert.deepEqual(missing, ["tae"]);
  for (const player of players) {
    if (!player.photo) continue;
    const file = new URL(`../${player.photo}`, import.meta.url);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), 76);
    assert.equal(bytes.readUInt32BE(20), 76);
    assert.equal(bytes[24], 8);
    assert.equal(bytes[25], 6);
  }
});
