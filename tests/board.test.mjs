import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  awardBadges,
  BLANK_EARNINGS,
  boardRowText,
  buildModel,
  cumulativeNets,
  hasDealt,
  leaderboardOrder,
  mostConsistent,
  rankMoves,
  sortStandings,
  standardDeviation,
  streak,
  UNRANKED_MARK,
} from "../js/stats.js";

const players = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
const sessions = JSON.parse(readFileSync(new URL("../data/sessions.json", import.meta.url), "utf8"));

function movesFrom(roster, ledger) {
  const model = buildModel(roster, ledger);
  return rankMoves(model.standings, model.sessions);
}

function ids(badges, id) {
  return (badges.get(id) || []).map((badge) => badge.id);
}

test("players with no recorded result follow every ranked row", () => {
  const model = buildModel(players, sessions);
  const rankedIds = sortStandings(model.standings, "net", "desc").map((player) => player.id);
  const blankIds = model.unrecorded.map((player) => player.id);
  assert.deepEqual(blankIds, ["chase", "jj", "na"]);

  const rows = leaderboardOrder(model.standings, model.unrecorded, "net", "desc");
  assert.deepEqual(rows.map((player) => player.id), [...rankedIds, ...blankIds]);

  const blanks = rows.filter((player) => player.recorded !== true);
  assert.equal(blanks.length, blankIds.length);
  for (const player of blanks) {
    const text = boardRowText(player);
    assert.equal(text.ranked, false);
    assert.equal(text.rank, UNRANKED_MARK);
    assert.equal(text.rank, "–");
    assert.equal(/\d/.test(text.rank), false);
    assert.equal(text.sessions, "0");
    assert.equal(player.sessionsPlayed, 0);
    assert.equal(text.earnings, BLANK_EARNINGS);
    assert.equal(text.earnings, "—");
    assert.equal(text.sparkline, false);
    assert.equal(player.net, null);
    assert.deepEqual(cumulativeNets(player), []);
    assert.equal(player.photo, player.id === "tae" ? undefined : `assets/players/${player.id}.png`);
    assert.equal(/[$€£¥฿₱₩₽₹]/.test(`${text.rank}${text.earnings}`), false);
  }

  const badges = awardBadges(rows);
  for (const player of blanks) {
    assert.equal(badges.has(player.id), false);
    assert.equal((badges.get(player.id) || []).some((badge) => badge.id === "fish"), false);
  }
  assert.equal(badges.get("wilson").some((badge) => badge.id === "fish"), true);
  assert.equal(badges.get("zack").some((badge) => badge.id === "fish"), false);
  assert.equal(badges.get("guy").some((badge) => badge.id === "fish"), false);
  for (const id of rankedIds) assert.equal(boardRowText(model.standings.find((player) => player.id === id)).sparkline, true);

  const guy = model.standings.find((player) => player.id === "guy");
  const guyText = boardRowText(guy);
  assert.equal(guy.recorded, true);
  assert.equal(guy.sessionsPlayed, 0);
  assert.equal(guy.net, 405);
  assert.equal(guyText.ranked, true);
  assert.equal(guyText.sessions, "0");
  assert.equal(guyText.sparkline, true);
  assert.deepEqual(cumulativeNets(guy), [405]);

  const bySessions = leaderboardOrder(model.standings, model.unrecorded, "sessionsPlayed", "asc");
  assert.equal(bySessions[0].id, "guy");
  assert.equal(bySessions[0].recorded, true);
  assert.equal(bySessions.findIndex((player) => player.recorded !== true), model.standings.length);
  assert.deepEqual(bySessions.slice(model.standings.length).map((player) => player.id), blankIds);

  const mixed = buildModel(
    [
      { id: "low", name: "Low" },
      { id: "blank", name: "Blank" },
      { id: "high", name: "High" },
      { id: "new", name: "New" },
    ],
    [{
      id: "s1",
      label: "Session 1",
      entries: [
        { playerId: "low", buyIn: 1, net: -5 },
        { playerId: "blank", buyIn: 1, net: null },
        { playerId: "high", buyIn: 1, net: 5 },
      ],
    }],
  );
  assert.deepEqual(
    leaderboardOrder(mixed.standings, mixed.unrecorded, "net", "asc").map((player) => player.id),
    ["low", "high", "blank", "new"],
  );
  assert.deepEqual(
    leaderboardOrder(mixed.standings, mixed.unrecorded, "sessionsPlayed", "asc").map((player) => player.id),
    ["high", "low", "blank", "new"],
  );
  assert.equal(leaderboardOrder(mixed.standings, mixed.unrecorded, "net", "desc").at(-1).id, "new");
  const mixedBadges = awardBadges(leaderboardOrder(mixed.standings, mixed.unrecorded, "net", "desc"));
  assert.equal(mixedBadges.has("blank"), false);
  assert.equal(mixedBadges.has("new"), false);
  assert.equal(mixedBadges.get("low").some((badge) => badge.id === "fish"), true);
  assert.equal(boardRowText(mixed.unrecorded[0]).sessions, "0");
  assert.equal(boardRowText(null).ranked, false);
});

test("one session marks every recorded player new and leaves blanks alone", () => {
  const direct = rankMoves([
    { id: "a", name: "A", history: [{ sessionId: "s1", net: 5, recorded: true }] },
    { id: "z", name: "Z", history: [{ sessionId: "s1", net: 0, recorded: true }] },
    { id: "b", name: "B", history: [{ sessionId: "s1", net: null, recorded: false }] },
    { id: "c", name: "C", history: [] },
  ], [{ id: "s1" }]);
  assert.deepEqual(direct.get("a"), { change: "new", places: 0 });
  assert.deepEqual(direct.get("z"), { change: "new", places: 0 });
  assert.equal(direct.has("b"), false);
  assert.equal(direct.has("c"), false);

  assert.equal(rankMoves([], []).size, 0);
  assert.equal(rankMoves(null, null).size, 0);
  assert.doesNotThrow(() => rankMoves([{ id: "a", name: "A", history: [] }], []));

  const model = buildModel(players, sessions);
  const moves = rankMoves(model.standings, model.sessions);
  assert.equal(moves.size, model.standings.length);
  assert.deepEqual(moves.get("tae"), { change: "new", places: 0 });
  assert.deepEqual(moves.get("zack"), { change: "up", places: 5 });
  assert.deepEqual(moves.get("dom"), { change: "down", places: 2 });
  assert.deepEqual(moves.get("will"), { change: "down", places: 2 });
  assert.deepEqual(moves.get("taam"), { change: "down", places: 2 });
  assert.deepEqual(moves.get("guy"), { change: "new", places: 0 });
  assert.deepEqual(moves.get("fah"), { change: "down", places: 3 });
  assert.deepEqual(moves.get("him"), { change: "new", places: 0 });
  assert.deepEqual(moves.get("james"), { change: "new", places: 0 });
  assert.deepEqual(moves.get("tip"), { change: "down", places: 4 });
  assert.deepEqual(moves.get("bank"), { change: "down", places: 6 });
  assert.deepEqual(moves.get("golf"), { change: "new", places: 0 });
  assert.deepEqual(moves.get("eye"), { change: "new", places: 0 });
  assert.deepEqual(moves.get("wilson"), { change: "new", places: 0 });
  for (const player of model.unrecorded) assert.equal(moves.has(player.id), false);
});

test("rank movement uses cumulative earnings and the board's name tie-break", () => {
  const roster = [
    { id: "amy", name: "Amy" },
    { id: "mia", name: "Mia" },
    { id: "zoe", name: "Zoe" },
  ];
  const moves = movesFrom(roster, [
    {
      id: "s1",
      label: "Session 1",
      entries: [
        { playerId: "amy", buyIn: 1, net: 5 },
        { playerId: "mia", buyIn: 1, net: 5 },
        { playerId: "zoe", buyIn: 1, net: 5 },
      ],
    },
    {
      id: "s2",
      label: "Session 2",
      entries: [
        { playerId: "amy", buyIn: 1, net: 0 },
        { playerId: "mia", buyIn: 1, net: 0 },
        { playerId: "zoe", buyIn: 1, net: 10 },
      ],
    },
  ]);
  assert.deepEqual(moves.get("zoe"), { change: "up", places: 2 });
  assert.deepEqual(moves.get("amy"), { change: "down", places: 1 });
  assert.deepEqual(moves.get("mia"), { change: "down", places: 1 });
});

test("movement is against the rank after the previous session, not that session alone", () => {
  const roster = [
    { id: "amy", name: "Amy" },
    { id: "bo", name: "Bo" },
  ];
  const moves = movesFrom(roster, [
    {
      id: "s1",
      label: "Session 1",
      entries: [
        { playerId: "amy", buyIn: 1, net: 50 },
        { playerId: "bo", buyIn: 1, net: 0 },
      ],
    },
    {
      id: "s2",
      label: "Session 2",
      entries: [
        { playerId: "amy", buyIn: 1, net: -40 },
        { playerId: "bo", buyIn: 1, net: 5 },
      ],
    },
    { id: "s3", label: "Session 3", entries: [] },
  ]);
  assert.deepEqual(moves.get("amy"), { change: "flat", places: 0 });
  assert.deepEqual(moves.get("bo"), { change: "flat", places: 0 });
});

test("a debut in the latest session is new, and a player who sat out can still move", () => {
  const roster = [
    { id: "amy", name: "Amy" },
    { id: "bo", name: "Bo" },
    { id: "dee", name: "Dee" },
    { id: "cal", name: "Cal" },
  ];
  const moves = movesFrom(roster, [
    {
      id: "s1",
      label: "Session 1",
      entries: [
        { playerId: "amy", buyIn: 1, net: 40 },
        { playerId: "bo", buyIn: 1, net: 30 },
        { playerId: "cal", buyIn: 1, net: 20 },
        { playerId: "dee", buyIn: 1, net: null },
      ],
    },
    {
      id: "s2",
      label: "Session 2",
      entries: [
        { playerId: "bo", buyIn: 1, net: 50 },
        { playerId: "dee", buyIn: 1, net: 100 },
      ],
    },
  ]);
  assert.deepEqual(moves.get("dee"), { change: "new", places: 0 });
  assert.deepEqual(moves.get("bo"), { change: "flat", places: 0 });
  assert.deepEqual(moves.get("amy"), { change: "down", places: 2 });
  assert.deepEqual(moves.get("cal"), { change: "down", places: 1 });
});

test("a longer jump reports every place gained", () => {
  const roster = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
    { id: "d", name: "D" },
  ];
  const moves = movesFrom(roster, [
    {
      id: "s1",
      label: "Session 1",
      entries: [
        { playerId: "a", buyIn: 1, net: 40 },
        { playerId: "b", buyIn: 1, net: 30 },
        { playerId: "c", buyIn: 1, net: 20 },
        { playerId: "d", buyIn: 1, net: 10 },
      ],
    },
    {
      id: "s2",
      label: "Session 2",
      entries: [{ playerId: "d", buyIn: 1, net: 100 }],
    },
  ]);
  assert.deepEqual(moves.get("d"), { change: "up", places: 3 });
  assert.deepEqual(moves.get("a"), { change: "down", places: 1 });
  assert.deepEqual(moves.get("b"), { change: "down", places: 1 });
  assert.deepEqual(moves.get("c"), { change: "down", places: 1 });
});

test("hot streaks follow the most recent positive nets and stop on zero or a loss", () => {
  const cases = [
    [[10, 20], { type: "hot", length: 2 }],
    [[10, 20, 5], { type: "hot", length: 3 }],
    [[10, -1, 5, 5], { type: "hot", length: 2 }],
    [[-5, 10, 10], { type: "hot", length: 2 }],
    [[-5, -1], { type: null, length: 0 }],
    [[-5, -1, -3], { type: null, length: 0 }],
    [[5, 5, -1, -2], { type: null, length: 0 }],
    [[10, 20, -1], { type: null, length: 0 }],
    [[10, 0, 20], { type: null, length: 0 }],
    [[5, 0], { type: null, length: 0 }],
    [[10], { type: null, length: 0 }],
    [[], { type: null, length: 0 }],
    [[0, 0], { type: null, length: 0 }],
  ];
  for (const [nets, expected] of cases) assert.deepEqual(streak(nets), expected);
  assert.deepEqual(streak(null), { type: null, length: 0 });

  const model = buildModel(
    [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    [
      {
        id: "s1",
        label: "Session 1",
        entries: [
          { playerId: "a", buyIn: 1, net: 5 },
          { playerId: "b", buyIn: 1, net: -5 },
        ],
      },
      {
        id: "s2",
        label: "Session 2",
        entries: [
          { playerId: "a", buyIn: 1, net: null },
          { playerId: "b", buyIn: 1, net: 1 },
        ],
      },
      {
        id: "s3",
        label: "Session 3",
        entries: [
          { playerId: "a", buyIn: 1, net: 5 },
          { playerId: "b", buyIn: 1, net: -1 },
        ],
      },
    ],
  );
  const a = model.standings.find((player) => player.id === "a");
  const b = model.standings.find((player) => player.id === "b");
  assert.deepEqual(streak(a.history.filter((item) => item.recorded).map((item) => item.net)), {
    type: "hot",
    length: 2,
  });
  assert.deepEqual(streak(b.history.filter((item) => item.recorded).map((item) => item.net)), {
    type: null,
    length: 0,
  });
});

test("consistency is the lowest population standard deviation, with ties kept", () => {
  assert.equal(standardDeviation([]), 0);
  assert.equal(standardDeviation([4, 4, 4]), 0);
  assert.ok(Math.abs(standardDeviation([1, 2, 3, 4]) - Math.sqrt(1.25)) < 1e-12);

  assert.deepEqual(mostConsistent([
    { id: "a", nets: [1, 1] },
    { id: "b", nets: [5, 9] },
  ]), []);
  assert.deepEqual(mostConsistent([]), []);
  assert.deepEqual(mostConsistent([
    { id: "steady", nets: [2, 2, 2, 2] },
    { id: "wild", nets: [0, 10, -4] },
    { id: "short", nets: [1, 1] },
  ]), ["steady"]);
  assert.deepEqual(mostConsistent([
    { id: "a", nets: [1, 2, 3] },
    { id: "b", nets: [4, 5, 6] },
    { id: "c", nets: [0, 10, 20] },
    { id: "d", nets: [5, 5] },
  ]), ["a", "b"]);
});

test("badges award ties, cap at two, and hide consistency when nobody qualifies", () => {
  const model = buildModel(players, sessions);
  const live = awardBadges(model.standings);
  assert.deepEqual(ids(live, "tae"), ["chip"]);
  assert.deepEqual(ids(live, "zack"), ["win"]);
  assert.deepEqual(ids(live, "wilson"), ["fish"]);
  const fish = live.get("wilson")[0];
  assert.equal(fish.mark, "🐟");
  assert.equal(fish.label, "Fish");
  assert.equal(fish.title, "Lowest total earnings.");
  for (const id of ["dom", "will", "taam", "guy", "him", "james", "tip", "golf", "eye", "fah", "bank"]) {
    assert.deepEqual(ids(live, id), []);
  }
  for (const player of model.unrecorded) assert.equal(live.has(player.id), false);
  assert.equal([...live.values()].some((list) => list.some((badge) => badge.id === "consistent")), false);

  const capped = awardBadges([
    { id: "ace", name: "Ace", net: 30, nets: [10, 10, 10] },
    { id: "bee", name: "Bee", net: -20, nets: [50, -40, -30] },
    { id: "cee", name: "Cee", net: 3, nets: [1, 1, 1] },
  ]);
  assert.deepEqual(ids(capped, "ace"), ["chip", "hot"]);
  assert.deepEqual(ids(capped, "bee"), ["fish", "win"]);
  assert.deepEqual(ids(capped, "cee"), ["hot", "consistent"]);
  const hot = capped.get("ace")[1];
  assert.equal(hot.mark, "🔥");
  assert.equal(hot.label, "Hot streak");
  assert.equal(hot.title, "Positive net in 3 consecutive most-recent recorded sessions.");
  assert.equal(capped.get("ace").length <= 2, true);
  assert.equal(capped.get("bee").length <= 2, true);
  for (const list of [...live.values(), ...capped.values()]) {
    assert.equal(list.some((badge) => badge.id === "cold" || badge.label === "Cold streak"), false);
  }
  const style = readFileSync(new URL("../css/styles.css", import.meta.url), "utf8");
  const stats = readFileSync(new URL("../js/stats.js", import.meta.url), "utf8");
  assert.equal(style.includes(".badge-cold"), false);
  assert.equal(style.includes(".badge-hot"), true);
  assert.equal(/cold streak/i.test(stats), false);

  const tied = awardBadges([
    { id: "ann", name: "Ann", net: 10, nets: [10] },
    { id: "bob", name: "Bob", net: 10, nets: [10] },
  ]);
  assert.deepEqual(ids(tied, "ann"), ["chip", "fish"]);
  assert.deepEqual(ids(tied, "bob"), ["chip", "fish"]);

  const losingField = awardBadges([
    { id: "a", name: "A", net: -1, nets: [-1] },
    { id: "b", name: "B", net: -8, nets: [-8] },
  ]);
  assert.deepEqual(ids(losingField, "a"), ["chip", "win"]);
  assert.deepEqual(ids(losingField, "b"), ["fish"]);
});

test("fish marks every player tied for the lowest recorded total", () => {
  const tiedLast = awardBadges([
    { id: "top", name: "Top", net: 12, nets: [12] },
    { id: "left", name: "Left", net: -4, nets: [-4] },
    { id: "right", name: "Right", net: -4, nets: [1, -5] },
    { id: "blank", name: "Blank", net: null, nets: [null] },
    { id: "new", name: "New" },
  ]);
  assert.deepEqual(ids(tiedLast, "top"), ["chip", "win"]);
  assert.deepEqual(ids(tiedLast, "left"), ["fish"]);
  assert.deepEqual(ids(tiedLast, "right"), ["fish"]);
  assert.equal(tiedLast.has("blank"), false);
  assert.equal(tiedLast.has("new"), false);
  for (const id of ["left", "right"]) {
    const badge = tiedLast.get(id)[0];
    assert.equal(badge.mark, "🐟");
    assert.equal(badge.label, "Fish");
    assert.equal(badge.title, "Lowest total earnings.");
    assert.equal(/[$€£¥฿]|baht|dollar/i.test(`${badge.label} ${badge.title}`), false);
  }

  const fromHistory = awardBadges([
    { id: "high", name: "High", net: 3, history: [{ net: 3, recorded: true }] },
    {
      id: "low",
      name: "Low",
      history: [{ net: -3, recorded: true }, { net: null, recorded: false }],
    },
    { id: "none", name: "None", history: [{ net: null, recorded: false }] },
  ]);
  assert.deepEqual(ids(fromHistory, "high"), ["chip", "win"]);
  assert.deepEqual(ids(fromHistory, "low"), ["fish"]);
  assert.equal(fromHistory.has("none"), false);

  const even = awardBadges([
    { id: "up", name: "Up", net: 5, nets: [5] },
    { id: "flat", name: "Flat", net: 0, nets: [0] },
  ]);
  assert.deepEqual(ids(even, "up"), ["chip", "win"]);
  assert.deepEqual(ids(even, "flat"), ["fish"]);

  assert.equal(awardBadges([]).size, 0);
  assert.equal(awardBadges(null).size, 0);
  assert.equal(awardBadges([{ id: "blank", net: null }]).size, 0);
});

test("fish and rank use total earnings when a dealer has no sessions played", () => {
  const lowest = buildModel(
    [
      { id: "ace", name: "Ace" },
      { id: "host", name: "Host" },
      { id: "blank", name: "Blank" },
    ],
    [{
      id: "s1",
      label: "Session 1",
      entries: [
        { playerId: "ace", buyIn: 10, net: 4 },
        { playerId: "host", buyIn: 0, net: -4, dealer: true },
      ],
    }],
  );
  const host = lowest.standings.find((player) => player.id === "host");
  assert.equal(host.sessionsPlayed, 0);
  assert.equal(host.net, -4);
  assert.equal(host.recorded, true);
  const lowestOrder = leaderboardOrder(lowest.standings, lowest.unrecorded, "net", "desc");
  assert.deepEqual(lowestOrder.map((player) => player.id), ["ace", "host", "blank"]);
  const lowestBadges = awardBadges(lowestOrder);
  assert.deepEqual(ids(lowestBadges, "host"), ["fish"]);
  assert.equal(lowestBadges.get("ace").some((badge) => badge.id === "chip"), true);
  assert.equal(lowestBadges.has("blank"), false);
  assert.equal(boardRowText(host).ranked, true);
  assert.equal(boardRowText(host).sessions, "0");
  assert.equal(boardRowText(host).sparkline, true);
  assert.deepEqual(cumulativeNets(host), [-4]);
  assert.equal(boardRowText(lowest.unrecorded[0]).ranked, false);

  const byAverage = buildModel(
    [
      { id: "grinder", name: "Grinder" },
      { id: "host", name: "Host" },
    ],
    [
      {
        id: "s1",
        label: "Session 1",
        entries: [
          { playerId: "grinder", buyIn: 10, net: -6 },
          { playerId: "host", buyIn: 0, net: -10, dealer: true },
        ],
      },
      {
        id: "s2",
        label: "Session 2",
        entries: [{ playerId: "grinder", buyIn: 10, net: -6 }],
      },
    ],
  );
  const dealer = byAverage.standings.find((player) => player.id === "host");
  const grinder = byAverage.standings.find((player) => player.id === "grinder");
  assert.equal(dealer.sessionsPlayed, 0);
  assert.equal(dealer.net, -10);
  assert.equal(grinder.sessionsPlayed, 2);
  assert.equal(grinder.net, -12);
  const order = leaderboardOrder(byAverage.standings, byAverage.unrecorded, "net", "desc");
  assert.deepEqual(order.map((player) => [player.id, player.net, player.sessionsPlayed]), [
    ["host", -10, 0],
    ["grinder", -12, 2],
  ]);
  const badges = awardBadges(order);
  assert.equal(badges.get("grinder").some((badge) => badge.id === "fish"), true);
  assert.equal(badges.get("host").some((badge) => badge.id === "fish"), false);
  assert.equal(badges.get("host").some((badge) => badge.id === "chip"), true);

  const bySessions = leaderboardOrder(byAverage.standings, byAverage.unrecorded, "sessionsPlayed", "asc");
  assert.equal(bySessions[0].id, "host");
  assert.equal(bySessions.at(-1).recorded, true);
});

test("a dealer button marks anyone who dealt, including 0 sessions played", () => {
  const model = buildModel(players, sessions);
  const guy = model.standings.find((player) => player.id === "guy");
  assert.equal(guy.sessionsPlayed, 0);
  assert.equal(guy.recorded, true);
  assert.equal(hasDealt(guy), true);
  assert.equal(boardRowText(guy).ranked, true);
  assert.equal(boardRowText(guy).sessions, "0");
  for (const player of [...model.standings, ...model.unrecorded]) {
    if (player.id === "guy") continue;
    assert.equal(hasDealt(player), false);
  }

  const live = awardBadges(model.standings);
  assert.deepEqual(ids(live, "guy"), []);
  assert.equal(live.get("guy").some((badge) => /dealer/i.test(`${badge.id} ${badge.label}`)), false);

  const dealtAndCapped = {
    id: "ace",
    name: "Ace",
    net: 30,
    nets: [10, 10, 10],
    history: [{ dealer: true, recorded: true, net: 10 }],
  };
  const capped = awardBadges([
    dealtAndCapped,
    { id: "bee", name: "Bee", net: -20, nets: [50, -40, -30] },
    { id: "cee", name: "Cee", net: 3, nets: [1, 1, 1] },
  ]);
  assert.deepEqual(ids(capped, "ace"), ["chip", "hot"]);
  assert.equal(capped.get("ace").length, 2);
  assert.equal(capped.get("ace").some((badge) => /dealer/i.test(`${badge.id} ${badge.label}`)), false);
  assert.equal(hasDealt(dealtAndCapped), true);

  const playedAndDealt = buildModel(
    [{ id: "pat", name: "Pat" }],
    [
      { id: "s1", label: "Session 1", entries: [{ playerId: "pat", buyIn: 10, net: 10 }] },
      { id: "s2", label: "Session 2", entries: [{ playerId: "pat", buyIn: 0, net: 4, dealer: true }] },
    ],
  );
  assert.equal(playedAndDealt.standings[0].sessionsPlayed, 1);
  assert.equal(hasDealt(playedAndDealt.standings[0]), true);

  const unrecordedDealer = buildModel(
    [
      { id: "host", name: "Host" },
      { id: "ace", name: "Ace" },
    ],
    [{
      id: "s1",
      label: "Session 1",
      entries: [
        { playerId: "host", buyIn: 0, net: null, dealer: true },
        { playerId: "ace", buyIn: 10, net: 5 },
      ],
    }],
  );
  const host = unrecordedDealer.unrecorded.find((player) => player.id === "host");
  assert.equal(host.recorded, false);
  assert.equal(host.sessionsPlayed, 0);
  assert.equal(hasDealt(host), true);
  assert.equal(hasDealt(unrecordedDealer.standings[0]), false);
  assert.equal(boardRowText(host).ranked, false);
  assert.equal(boardRowText(host).sessions, "0");

  const worded = buildModel(
    [{ id: "pat", name: "Pat" }],
    [{ id: "s1", label: "Session 1", entries: [{ playerId: "pat", buyIn: 0, net: 4, dealer: "true" }] }],
  );
  assert.equal(hasDealt(worded.standings[0]), false);
  assert.equal(hasDealt(null), false);
  assert.equal(hasDealt({}), false);
  assert.equal(hasDealt({ history: [{ dealer: false }, { dealer: 1 }] }), false);
  assert.equal(hasDealt({ sessionsPlayed: 0 }), false);

  const sheet = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../css/styles.css", import.meta.url), "utf8");
  const stats = readFileSync(new URL("../js/stats.js", import.meta.url), "utf8");
  const nameLineStart = sheet.indexOf("function nameLine");
  const nameLineEnd = sheet.indexOf("function scrollToSection");
  assert.ok(nameLineStart > 0 && nameLineEnd > nameLineStart);
  const nameLine = sheet.slice(nameLineStart, nameLineEnd);
  assert.match(nameLine, /hasDealt\(player\)/);
  assert.match(nameLine, /dealerButton\(\)/);
  assert.match(nameLine, /name-line/);
  assert.equal(nameLine.includes("sessionsPlayed"), false);
  assert.equal(nameLine.includes("awardBadges"), false);
  assert.equal(nameLine.includes("badgeNodes"), false);
  assert.equal((sheet.match(/nameLine\(player\)/g) || []).length, 3);
  assert.match(sheet, /el\("h1", \{ class: "name-line" \}/);
  assert.equal((sheet.match(/dealerButton\(\)/g) || []).length, 2);
  const badgeNodes = sheet.slice(sheet.indexOf("function badgeNodes"), nameLineStart);
  assert.equal(badgeNodes.includes("dealerButton"), false);
  assert.equal(badgeNodes.includes("hasDealt"), false);
  const badgeBlock = stats.slice(stats.indexOf("const BADGES"), stats.indexOf("function streakBadge"));
  assert.equal(/dealer/i.test(badgeBlock), false);
  assert.match(stats, /picked\.slice\(0,\s*BADGE_LIMIT\)/);
  const rule = style.match(/\.dealer-button\s*\{[^}]+\}/);
  assert.ok(rule);
  assert.match(rule[0], /border-radius:\s*50%/);
  assert.match(rule[0], /display:\s*inline-flex/);
  assert.equal(/[$€£¥฿₱₩₽₹]/.test(`${rule[0]}${nameLine}${badgeBlock}`), false);
});
