import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlayer,
  addRebuy,
  balanceNote,
  canRemovePlayer,
  canStart,
  describePlayers,
  dropPick,
  emptyNight,
  finalResults,
  formatClock,
  formatNight,
  formatResultLine,
  formatResultsText,
  formatSessionJson,
  isIsoDate,
  liveResult,
  localDate,
  nextSessionMeta,
  parseNight,
  parseWhole,
  playerCountLabel,
  rankPlayers,
  rankedField,
  removePlayer,
  sessionEntry,
  setBuyIn,
  setStack,
  startGame,
  totalInPlay,
  withDate,
} from "../js/liveboard.js";

const table = [
  { playerId: "dom", name: "Dom", buyIn: 400, stack: 1310 },
  { playerId: "will", name: "Will", buyIn: 800, stack: 1680 },
  { playerId: "taam", name: "Taam", buyIn: 500, stack: 500 },
  { playerId: "fah", name: "Fah", buyIn: 400, stack: 210 },
  { playerId: "bank", name: "Bank", buyIn: 400, stack: 0 },
  { playerId: "tip", name: "Tip", buyIn: 400, stack: 0 },
  { playerId: "zack", name: "Zack", buyIn: 800, stack: 0 },
];

const ledger = [{ id: "session-1", label: "Session 1" }];

test("live result is the stack minus the buy-in", () => {
  assert.equal(liveResult(1310, 400), 910);
  assert.equal(liveResult(0, 400), -400);
  assert.equal(liveResult(500, 500), 0);
  assert.equal(liveResult(0, 0), 0);
  assert.throws(() => liveResult(-1, 0), TypeError);
  assert.throws(() => liveResult(1.5, 1), TypeError);
  assert.throws(() => liveResult(null, 0), TypeError);
});

test("standings rank by live result, then name", () => {
  const ranked = rankPlayers(table);
  assert.deepEqual(ranked.map((player) => player.name), [
    "Dom", "Will", "Taam", "Fah", "Bank", "Tip", "Zack",
  ]);
  assert.deepEqual(ranked.map((player) => player.net), [910, 880, 0, -190, -400, -400, -800]);
  assert.deepEqual(ranked.map((player) => player.rank), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(totalInPlay(table), 3700);

  const tied = rankPlayers([
    { playerId: "tip", name: "Tip", buyIn: 100, stack: 100 },
    { playerId: "bank", name: "Bank", buyIn: 100, stack: 150 },
    { playerId: "dom", name: "Dom", buyIn: 100, stack: 150 },
  ]);
  assert.deepEqual(tied.map((player) => [player.name, player.rank, player.net]), [
    ["Bank", 1, 50],
    ["Dom", 2, 50],
    ["Tip", 3, 0],
  ]);
});

test("names and photos come from the roster", () => {
  const ranked = rankedField(
    [{ playerId: "dom", name: "Wrong", buyIn: 400, stack: 1310 }],
    [{ id: "dom", name: "Dom", photo: "assets/players/dom.png" }],
  );
  assert.equal(ranked[0].name, "Dom");
  assert.equal(ranked[0].photo, "assets/players/dom.png");
  assert.equal(ranked[0].net, 910);

  const unknown = describePlayers([{ playerId: "ghost", buyIn: 0, stack: 0 }], []);
  assert.equal(unknown[0].name, "ghost");
  assert.equal(unknown[0].photo, "");

  const unpictured = rankedField(
    [{ playerId: "tae", buyIn: 200, stack: 200 }],
    [{ id: "tae", name: "Tae" }],
  );
  assert.equal(unpictured[0].name, "Tae");
  assert.equal(unpictured[0].photo, "");
  assert.equal(unpictured[0].net, 0);
});

test("a re-buy adds to the buy-in and the stack and leaves the result", () => {
  const before = table.map((player) => ({ ...player }));
  const next = addRebuy(table, "fah", 200);
  assert.equal(table.find((player) => player.playerId === "fah").stack, 210);
  assert.equal(table.find((player) => player.playerId === "fah").buyIn, 400);
  const fah = next.find((player) => player.playerId === "fah");
  assert.equal(fah.buyIn, 600);
  assert.equal(fah.stack, 410);
  assert.equal(liveResult(fah.stack, fah.buyIn), -190);
  assert.equal(balanceNote(next).sum, balanceNote(before).sum);
  assert.equal(totalInPlay(next), 3900);

  assert.equal(addRebuy(table, "fah", 0), table);
  assert.equal(addRebuy(table, "missing", 100), table);
  assert.equal(addRebuy(table, "zack", 99999999), table);
});

test("setting the stack replaces it and moves the result", () => {
  const next = setStack(table, "dom", 1360);
  assert.equal(table.find((player) => player.playerId === "dom").stack, 1310);
  assert.equal(next.find((player) => player.playerId === "dom").stack, 1360);
  assert.equal(next.find((player) => player.playerId === "dom").buyIn, 400);
  assert.equal(liveResult(1360, 400), 960);
  assert.equal(balanceNote(next).sum, 50);
  assert.equal(setStack(table, "dom", -1), table);
  assert.equal(setStack(table, "missing", 10), table);
});

test("final results report buy-in, net, and whether nets sum to zero", () => {
  const done = finalResults(table);
  assert.equal(done.balanced, true);
  assert.equal(done.netSum, 0);
  assert.equal(done.note, "Nets sum to 0.");
  assert.deepEqual(done.rows.map((row) => [row.name, row.buyIn, row.net]), [
    ["Dom", 400, 910],
    ["Will", 800, 880],
    ["Taam", 500, 0],
    ["Fah", 400, -190],
    ["Bank", 400, -400],
    ["Tip", 400, -400],
    ["Zack", 800, -800],
  ]);
  assert.equal(done.rows.reduce((sum, row) => sum + row.net, 0), 0);

  const off = finalResults(setStack(table, "dom", 1360));
  assert.equal(off.balanced, false);
  assert.equal(off.netSum, 50);
  assert.equal(off.note, "Nets sum to +50. They should sum to 0.");

  const short = finalResults(setStack(table, "dom", 1260));
  assert.equal(short.note, "Nets sum to -50. They should sum to 0.");
});

test("copy lines are plain text, one player per line", () => {
  assert.equal(formatResultLine("Dom", 400, 910), "Dom 400 +910");
  assert.equal(formatResultLine("Fah", 400, -190), "Fah 400 -190");
  assert.equal(formatResultLine("Taam", 500, 0), "Taam 500 0");
  assert.equal(formatResultLine("Will", 1800, 880), "Will 1,800 +880");

  const text = formatResultsText(finalResults(table).rows);
  assert.equal(text.split("\n")[0], "Dom 400 +910");
  assert.equal(text.split("\n").at(-1), "Zack 800 -800");
  assert.equal(text.endsWith("\n"), false);
  assert.equal(/[$€£¥฿₱₩₽₹]/.test(text), false);
  assert.equal(text.split("\n").length, table.length);
});

test("downloaded session matches the ledger entry shape", () => {
  const entry = sessionEntry(table, ledger);
  assert.deepEqual(entry, {
    id: "session-2",
    label: "Session 2",
    entries: [
      { playerId: "dom", buyIn: 400, net: 910 },
      { playerId: "will", buyIn: 800, net: 880 },
      { playerId: "taam", buyIn: 500, net: 0 },
      { playerId: "fah", buyIn: 400, net: -190 },
      { playerId: "bank", buyIn: 400, net: -400 },
      { playerId: "tip", buyIn: 400, net: -400 },
      { playerId: "zack", buyIn: 800, net: -800 },
    ],
  });
  assert.equal("date" in entry, false);
  assert.equal(entry.entries.reduce((sum, row) => sum + row.net, 0), 0);

  const json = formatSessionJson(entry);
  assert.equal(JSON.stringify(JSON.parse(json)), JSON.stringify(entry));
  assert.equal(json.includes("\"playerId\": \"dom\""), true);
  assert.match(json, /\{ "playerId": "dom", "buyIn": 400, "net": 910 \}/);
  assert.equal(/[$€£¥฿]|\d{4}-\d{2}-\d{2}/.test(json), false);

  assert.deepEqual(nextSessionMeta([]), { id: "session-1", label: "Session 1" });
  assert.deepEqual(nextSessionMeta([{ id: "session-2", label: "Home" }]), {
    id: "session-3",
    label: "Session 3",
  });
  assert.deepEqual(nextSessionMeta([{ id: "note", label: "Session 4" }]), {
    id: "session-5",
    label: "Session 5",
  });
  assert.deepEqual(nextSessionMeta([{ id: "session-3", label: "Session 1" }]), {
    id: "session-4",
    label: "Session 4",
  });
});

test("whole numbers for the pad, and tonight can start", () => {
  assert.equal(parseWhole("400"), 400);
  assert.equal(parseWhole("1,310"), 1310);
  assert.equal(parseWhole(" 0400 "), 400);
  assert.equal(parseWhole("0"), 0);
  assert.equal(parseWhole("99999999"), 99999999);
  assert.equal(parseWhole(""), null);
  assert.equal(parseWhole("-1"), null);
  assert.equal(parseWhole("12.5"), null);
  assert.equal(parseWhole("12a"), null);
  assert.equal(parseWhole("100000000"), null);
  assert.equal(parseWhole(400), null);

  assert.equal(totalInPlay([{ buyIn: 400 }, { buyIn: null }, { buyIn: 0 }]), 400);
  assert.equal(canStart([]), false);
  assert.equal(canStart([{ playerId: "dom", buyIn: null }]), false);
  assert.equal(canStart([{ playerId: "dom", buyIn: 0 }]), true);
  assert.equal(canStart([
    { playerId: "dom", buyIn: 400 },
    { playerId: "na", buyIn: null },
  ]), false);

  const started = startGame([
    { playerId: "dom", buyIn: 400 },
    { playerId: "na", buyIn: 0 },
  ]);
  assert.deepEqual(started, [
    { playerId: "dom", buyIn: 400, stack: 400 },
    { playerId: "na", buyIn: 0, stack: 0 },
  ]);
  assert.equal(startGame([{ playerId: "dom", buyIn: null }]), null);

  const picked = setBuyIn(dropPick([{ playerId: "dom", buyIn: 100, stack: 100 }], "dom"), "fah", 400);
  assert.deepEqual(picked, [{ playerId: "fah", buyIn: 400, stack: 400 }]);
});

test("a saved night round-trips and bad records are dropped", () => {
  const night = {
    date: "2026-11-10",
    phase: "play",
    updatedAt: 1762812240000,
    players: [{ playerId: "dom", buyIn: 400, stack: 1310 }],
  };
  assert.deepEqual(parseNight(JSON.stringify(night)), night);

  const setup = {
    date: "2026-11-10",
    phase: "setup",
    updatedAt: null,
    players: [
      { playerId: "dom", buyIn: 400, stack: 400 },
      { playerId: "na", buyIn: null, stack: null },
    ],
  };
  assert.deepEqual(parseNight(JSON.stringify(setup)), setup);
  assert.deepEqual(parseNight({ ...setup, players: [{ playerId: "dom", buyIn: 400 }] }).players, [
    { playerId: "dom", buyIn: 400, stack: 400 },
  ]);

  assert.equal(parseNight(""), null);
  assert.equal(parseNight("{}"), null);
  assert.equal(parseNight("{"), null);
  assert.equal(parseNight({ date: "2026-11-10", phase: "play", players: [] }), null);
  assert.equal(parseNight({ date: "2026-11-10", phase: "hands", players: [] }), null);
  assert.equal(parseNight({
    date: "2026-02-31",
    phase: "setup",
    players: [],
  }), null);
  assert.equal(parseNight({
    date: "2026-11-10",
    phase: "play",
    players: [
      { playerId: "dom", buyIn: 400, stack: 400 },
      { playerId: "dom", buyIn: 100, stack: 100 },
    ],
  }), null);
  assert.equal(parseNight({
    date: "2026-11-10",
    phase: "play",
    players: [{ playerId: "dom", buyIn: 400, stack: -1 }],
  }), null);
  assert.equal(parseNight({ seats: [null, "dom"], buttonSeat: 0 }), null);

  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2026-11-10T00:00:00"), false);

  const cleared = emptyNight("2026-11-10");
  assert.deepEqual(withDate(cleared, "2026-11-11"), { ...cleared, date: "2026-11-11" });
  assert.equal(withDate(cleared, "nope"), cleared);
});

test("a player can join after the game has started", () => {
  const playing = table.map((player) => ({ ...player }));
  const snapshot = playing.map((player) => ({ ...player }));
  const withRebuy = addRebuy(playing, "fah", 200);
  const fah = withRebuy.find((player) => player.playerId === "fah");
  const joined = addPlayer(withRebuy, "guy", 300);

  assert.deepEqual(playing, snapshot);
  assert.equal(joined.find((player) => player.playerId === "fah"), fah);
  assert.equal(fah.buyIn, 600);
  assert.equal(fah.stack, 410);
  for (const player of withRebuy) {
    assert.equal(joined.includes(player), true);
  }
  assert.deepEqual(
    joined.find((player) => player.playerId === "guy"),
    { playerId: "guy", buyIn: 300, stack: 300, late: true },
  );
  assert.equal(liveResult(300, 300), 0);
  assert.equal(joined.length, playing.length + 1);
  assert.equal(totalInPlay(joined), 4200);
  assert.equal(balanceNote(joined).sum, 0);
  assert.equal(balanceNote(joined).balanced, true);

  assert.equal(addPlayer(joined, "guy", 100), joined);
  assert.equal(addPlayer(joined, "dom", 900), joined);
  assert.equal(addPlayer(joined, "", 300), joined);
  assert.equal(addPlayer(joined, "na", -1), joined);
  assert.equal(addPlayer(joined, "na", 1.5), joined);
  assert.equal(joined.find((player) => player.playerId === "dom").buyIn, 400);
  assert.equal(joined.find((player) => player.playerId === "dom").stack, 1310);
  assert.equal(fah.buyIn, 600);
  assert.equal(joined.length, playing.length + 1);

  const roster = [
    { id: "dom", name: "Dom" },
    { id: "will", name: "Will" },
    { id: "taam", name: "Taam" },
    { id: "fah", name: "Fah" },
    { id: "bank", name: "Bank" },
    { id: "tip", name: "Tip" },
    { id: "zack", name: "Zack" },
    { id: "guy", name: "Guy", photo: "assets/players/guy.png" },
  ];
  const described = describePlayers(joined, roster);
  assert.equal(described.find((player) => player.playerId === "guy").name, "Guy");
  assert.deepEqual(
    rankPlayers(described).map((player) => player.name),
    ["Dom", "Will", "Guy", "Taam", "Fah", "Bank", "Tip", "Zack"],
  );

  const done = finalResults(described);
  assert.equal(done.balanced, true);
  assert.equal(done.netSum, 0);
  assert.deepEqual(
    done.rows.find((row) => row.playerId === "guy"),
    { playerId: "guy", name: "Guy", buyIn: 300, stack: 300, net: 0, rank: 3 },
  );
  const lines = formatResultsText(done.rows).split("\n");
  assert.equal(lines.includes("Guy 300 0"), true);
  assert.equal(lines.includes("Dom 400 +910"), true);
  assert.equal(lines.includes("Fah 600 -190"), true);
  assert.equal(lines.length, joined.length);

  const entry = sessionEntry(described, ledger);
  assert.deepEqual(
    entry.entries.find((row) => row.playerId === "guy"),
    { playerId: "guy", buyIn: 300, net: 0 },
  );
  assert.equal(entry.entries.reduce((sum, row) => sum + row.net, 0), 0);
  const saved = JSON.parse(formatSessionJson(entry));
  assert.deepEqual(
    saved.entries.find((row) => row.playerId === "guy"),
    { playerId: "guy", buyIn: 300, net: 0 },
  );

  const off = addPlayer(setStack(playing, "dom", 1360), "na", 0);
  assert.equal(balanceNote(off).sum, 50);
  assert.equal(off.find((player) => player.playerId === "na").stack, 0);
  assert.equal(off.find((player) => player.playerId === "dom").stack, 1360);
});

test("a late joiner can be removed only while they are still at zero", () => {
  const joined = addPlayer(
    [{ playerId: "dom", buyIn: 400, stack: 250 }],
    "guy",
    300,
  );
  assert.equal(canRemovePlayer(joined[0]), false);
  assert.equal(removePlayer(joined, "dom"), joined);
  assert.equal(canRemovePlayer(joined[1]), true);

  const removed = removePlayer(joined, "guy");
  assert.deepEqual(removed, [{ playerId: "dom", buyIn: 400, stack: 250 }]);
  assert.equal(joined[1].late, true);

  const rebought = addRebuy(joined, "guy", 100);
  assert.equal(rebought[1].buyIn, 400);
  assert.equal(rebought[1].stack, 400);
  assert.equal(rebought[1].late, undefined);
  assert.equal(canRemovePlayer(rebought[1]), false);
  assert.equal(removePlayer(rebought, "guy"), rebought);

  const counted = setStack(joined, "guy", 200);
  assert.equal(canRemovePlayer(counted[1]), false);
  const back = setStack(counted, "guy", 300);
  assert.equal(back[1].stack, 300);
  assert.equal(canRemovePlayer(back[1]), false);

  const night = parseNight({
    date: "2026-11-12",
    phase: "play",
    updatedAt: 1,
    players: [
      { playerId: "dom", buyIn: 400, stack: 250 },
      { playerId: "guy", buyIn: 300, stack: 300, late: true, extra: true },
    ],
  });
  assert.deepEqual(night.players[1], {
    playerId: "guy",
    buyIn: 300,
    stack: 300,
    late: true,
  });
  assert.equal(canRemovePlayer(night.players[1]), true);

  const unmarked = parseNight({
    date: "2026-11-12",
    phase: "play",
    updatedAt: 1,
    players: [{ playerId: "guy", buyIn: 300, stack: 300, late: false }],
  });
  assert.equal("late" in unmarked.players[0], false);
});

test("the date and the clock are local", () => {
  const evening = new Date(2026, 10, 10, 21, 4);
  assert.equal(localDate(evening), "2026-11-10");
  assert.equal(formatNight("2026-11-10"), "Tuesday 10 Nov 2026");
  assert.equal(formatNight("2026-02-31"), "");
  assert.equal(formatClock(evening.getTime()), "9:04 pm");
  assert.equal(formatClock(new Date(2026, 10, 10, 0, 5).getTime()), "12:05 am");
  assert.equal(formatClock(new Date(2026, 10, 10, 12, 0).getTime()), "12:00 pm");
  assert.equal(formatClock(null), "");
  assert.equal(playerCountLabel(0), "0 players");
  assert.equal(playerCountLabel(1), "1 player");
  assert.equal(playerCountLabel(8), "8 players");
});
