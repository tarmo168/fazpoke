import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  awardBadges,
  buildModel,
  mostConsistent,
  rankMoves,
  standardDeviation,
  streak,
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
  for (const player of model.standings) {
    assert.deepEqual(moves.get(player.id), { change: "new", places: 0 });
  }
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

test("streaks follow the most recent recorded nets and stop on zero or a flip", () => {
  const cases = [
    [[10, 20], { type: "hot", length: 2 }],
    [[10, 20, 5], { type: "hot", length: 3 }],
    [[10, -1, 5, 5], { type: "hot", length: 2 }],
    [[-5, 10, 10], { type: "hot", length: 2 }],
    [[-5, -1], { type: "cold", length: 2 }],
    [[-5, -1, -3], { type: "cold", length: 3 }],
    [[5, 5, -1, -2], { type: "cold", length: 2 }],
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
  assert.deepEqual(ids(live, "dom"), ["chip", "win"]);
  assert.deepEqual(ids(live, "zack"), ["fish"]);
  const fish = live.get("zack")[0];
  assert.equal(fish.mark, "🐟");
  assert.equal(fish.label, "Fish");
  assert.equal(fish.title, "Lowest total earnings.");
  for (const id of ["will", "taam", "fah", "bank", "tip"]) {
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
  assert.deepEqual(ids(capped, "bee"), ["fish", "cold"]);
  assert.deepEqual(ids(capped, "cee"), ["hot", "consistent"]);
  assert.equal(capped.get("ace").length <= 2, true);
  assert.equal(capped.get("bee").length <= 2, true);

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
