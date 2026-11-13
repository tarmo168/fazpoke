import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { formatAmount, formatSigned } from "../js/format.js";
import { buildModel, sortStandings } from "../js/stats.js";

const root = new URL("..", import.meta.url);
const players = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
const sessions = JSON.parse(readFileSync(new URL("../data/sessions.json", import.meta.url), "utf8"));

test("roster and session 1 are the recorded sheet", () => {
  assert.deepEqual(players.map((player) => player.name), [
    "Taam", "Bank", "Chase", "Fah", "JJ", "Dom", "Na", "Tip", "Will", "Zack", "Guy", "Golf", "Eye", "James", "Wilson", "Him",
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].label, "Session 1");
  assert.equal(sessions[0].date, "2026-11-06");
  const blob = JSON.stringify(players) + JSON.stringify(sessions);
  assert.deepEqual(blob.match(/\d{4}-\d{2}-\d{2}/g), ["2026-11-06"]);
  assert.equal(/vpip|hourly/i.test(blob), false);
});

test("session 1 totals and the break-even stay exact", () => {
  const model = buildModel(players, sessions);
  assert.equal(model.totals.buyIn, 3700);
  assert.equal(model.totals.net, 0);
  assert.equal(model.sessions[0].buyIn, 3700);
  assert.equal(model.sessions[0].net, 0);
  assert.equal(model.sessions[0].totalEarnings, 1790);
  assert.equal(model.totals.totalEarnings, 1790);
  assert.equal(model.standings.reduce((sum, player) => sum + player.net, 0), 0);
  assert.equal(model.standings.reduce((sum, player) => sum + player.buyIn, 0), 3700);
  assert.deepEqual(
    Object.fromEntries(model.standings.map((player) => [player.id, player.buyIn])),
    { dom: 400, will: 800, taam: 500, fah: 400, bank: 400, tip: 400, zack: 800 },
  );

  const taam = model.standings.find((player) => player.id === "taam");
  assert.equal(taam.net, 0);
  assert.equal(taam.buyIn, 500);
  assert.equal(taam.sessionsPlayed, 1);
  assert.deepEqual(taam.points.map((point) => point.kind), ["baseline", "played"]);
  assert.equal(taam.points[1].value, 0);
  assert.equal(taam.points[1].delta, 0);

  assert.deepEqual(model.unrecorded.map((player) => player.id), ["chase", "jj", "na", "guy", "golf", "eye", "james", "wilson", "him"]);
  const guy = model.unrecorded.find((player) => player.id === "guy");
  assert.equal(guy.name, "Guy");
  assert.equal(guy.photo, "assets/players/guy.png");
  assert.equal(guy.recorded, false);
  assert.equal(guy.net, null);
  assert.deepEqual(guy.history, []);
  assert.equal(sessions.some((session) => (
    (session.entries || []).some((entry) => entry.playerId === "guy")
  )), false);
  const golf = model.unrecorded.find((player) => player.id === "golf");
  assert.equal(golf.name, "Golf");
  assert.equal(golf.photo, "assets/players/golf.png");
  assert.equal(golf.recorded, false);
  assert.equal(golf.net, null);
  assert.deepEqual(golf.history, []);
  assert.equal(sessions.some((session) => (
    (session.entries || []).some((entry) => entry.playerId === "golf")
  )), false);
  const eye = model.unrecorded.find((player) => player.id === "eye");
  assert.equal(eye.name, "Eye");
  assert.equal(eye.photo, "assets/players/eye.png");
  assert.equal(eye.recorded, false);
  assert.equal(eye.net, null);
  assert.deepEqual(eye.history, []);
  assert.equal(sessions.some((session) => (
    (session.entries || []).some((entry) => entry.playerId === "eye")
  )), false);
  const james = model.unrecorded.find((player) => player.id === "james");
  assert.equal(james.name, "James");
  assert.equal(james.photo, "assets/players/james.png");
  assert.equal(james.recorded, false);
  assert.equal(james.net, null);
  assert.deepEqual(james.history, []);
  assert.equal(sessions.some((session) => (
    (session.entries || []).some((entry) => entry.playerId === "james")
  )), false);
  const wilson = model.unrecorded.find((player) => player.id === "wilson");
  assert.equal(wilson.name, "Wilson");
  assert.equal(wilson.photo, "assets/players/wilson.png");
  assert.equal(wilson.recorded, false);
  assert.equal(wilson.net, null);
  assert.deepEqual(wilson.history, []);
  assert.equal(sessions.some((session) => (
    (session.entries || []).some((entry) => entry.playerId === "wilson")
  )), false);
  const him = model.unrecorded.find((player) => player.id === "him");
  assert.equal(him.name, "Him");
  assert.equal(him.photo, "assets/players/him.png");
  assert.equal(him.recorded, false);
  assert.equal(him.net, null);
  assert.deepEqual(him.history, []);
  assert.equal(sessions.some((session) => (
    (session.entries || []).some((entry) => entry.playerId === "him")
  )), false);
  assert.equal(model.unrecorded.every((player) => player.net === null), true);
  assert.equal(model.unrecorded.every((player) => player.points === null), true);
  assert.deepEqual(model.byId.get("chase").history.map((item) => item.net), [null]);
  assert.deepEqual(model.byId.get("na").history, []);
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
    "dom", "will", "taam", "fah", "bank", "tip", "zack",
  ]);
  assert.deepEqual(byEarnings.map((player) => player.net), [910, 880, 0, -190, -400, -400, -800]);

  const tiedSessions = sortStandings(model.standings, "sessionsPlayed", "desc");
  assert.deepEqual(tiedSessions.map((player) => player.id), byEarnings.map((player) => player.id));

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
  const bySessions = sortStandings(mixed.standings, "sessionsPlayed", "desc");
  assert.deepEqual(bySessions.map((player) => [player.id, player.sessionsPlayed, player.net]), [
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
  for (const player of players) {
    const file = new URL(`../${player.photo}`, import.meta.url);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), 76);
    assert.equal(bytes.readUInt32BE(20), 76);
    assert.equal(bytes[24], 8);
    assert.equal(bytes[25], 6);
  }
});
