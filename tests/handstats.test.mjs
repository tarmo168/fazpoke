import assert from "node:assert/strict";
import test from "node:test";
import {
  SMALL_SAMPLE_HANDS,
  STREET_LABEL,
  advanceStreet,
  beginPick,
  cancelPick,
  confirmWinners,
  foldLabel,
  foldPlayer,
  formatPct,
  freshHand,
  nextButtonSeat,
  seatPoint,
  stampHand,
  statsForPlayer,
  toggleVpip,
  toggleWinner,
} from "../js/handstats.js";

function seatsOf(ids) {
  const seats = Array(10).fill(null);
  ids.forEach((id, index) => {
    seats[index] = id;
  });
  return seats;
}

function recordFrom(hand, id = "hand-1") {
  return stampHand(hand.result, {
    id,
    sessionDate: "2026-11-10",
    timestamp: "2026-11-10T18:00:00.000Z",
  });
}

test("seats run clockwise from the bottom", () => {
  const bottom = seatPoint(0);
  const next = seatPoint(1);
  const top = seatPoint(5);
  assert.ok(Math.abs(bottom.x - 50) < 0.001);
  assert.ok(bottom.y > 80);
  assert.ok(next.x < bottom.x);
  assert.ok(top.y < 20);
  assert.equal(foldLabel("flop"), "Folded – Flop");
  assert.equal(foldLabel("preflop"), `Folded – ${STREET_LABEL.preflop}`);
});

test("the dealer button moves clockwise and skips empty seats", () => {
  const seats = Array(10).fill(null);
  seats[0] = "a";
  seats[3] = "b";
  seats[9] = "c";
  assert.equal(nextButtonSeat(seats, 0), 3);
  assert.equal(nextButtonSeat(seats, 3), 9);
  assert.equal(nextButtonSeat(seats, 9), 0);
  assert.equal(nextButtonSeat(seats, 4), 0);
  assert.equal(nextButtonSeat(Array(10).fill(null), 0), null);

  const ends = Array(10).fill(null);
  ends[9] = "a";
  ends[0] = "b";
  assert.equal(nextButtonSeat(ends, 0), 9);
  assert.equal(nextButtonSeat(ends, 9), 0);
  assert.equal(nextButtonSeat(["solo"], 0), 0);
});

test("a fold down to one player ends the hand without a showdown", () => {
  const seats = seatsOf(["a", "b", "c"]);
  let hand = freshHand();
  hand = toggleVpip(hand, seats, "a");
  hand = foldPlayer(hand, seats, "b", 0);
  assert.equal(hand.phase, "play");
  hand = advanceStreet(hand);
  hand = foldPlayer(hand, seats, "c", 0);
  assert.equal(hand.phase, "done");
  assert.equal(hand.result.endStreet, "flop");
  assert.deepEqual(hand.result.winners, ["a"]);
  assert.deepEqual(hand.result.reachedShowdown, []);
  assert.deepEqual(hand.result.actions, [
    { playerId: "b", street: "preflop" },
    { playerId: "c", street: "flop" },
  ]);
  assert.deepEqual(hand.result.vpip, [
    { playerId: "a", entered: true },
    { playerId: "b", entered: false },
    { playerId: "c", entered: false },
  ]);
  assert.equal(hand.result.buttonSeat, 0);

  const saved = recordFrom(hand);
  assert.deepEqual(Object.keys(saved).sort(), [
    "actions",
    "buttonSeat",
    "endStreet",
    "id",
    "reachedShowdown",
    "seats",
    "sessionDate",
    "timestamp",
    "vpip",
    "winners",
  ]);
  assert.equal(JSON.stringify(saved).includes("amount"), false);
});

test("voluntary pre-flop entry only toggles before the flop, for a live player", () => {
  const seats = seatsOf(["a", "b"]);
  const started = freshHand();
  const marked = toggleVpip(started, seats, "a");
  assert.equal(marked.vpip.a, true);
  assert.equal(toggleVpip(marked, seats, "a").vpip.a, false);
  assert.equal(toggleVpip(started, seats, "missing"), started);
  const folded = foldPlayer(started, seats, "a", 1);
  assert.equal(toggleVpip(folded, seats, "a"), folded);
  const flop = advanceStreet(started);
  assert.equal(flop.street, "flop");
  assert.equal(toggleVpip(flop, seats, "b"), flop);
});

test("the last player cannot fold, and a finished hand ignores further folds", () => {
  const seats = seatsOf(["a", "b"]);
  const open = freshHand();
  const done = foldPlayer(open, seats, "a", 2);
  assert.equal(done.phase, "done");
  assert.equal(foldPlayer(done, seats, "b", 2), done);
  assert.equal(foldPlayer(done, seats, "a", 2), done);
});

test("showdown can split, and a muck still counts as reaching it", () => {
  const seats = seatsOf(["a", "b", "c"]);
  let hand = freshHand();
  hand = foldPlayer(hand, seats, "c", 4);
  for (let step = 0; step < 4; step += 1) hand = advanceStreet(hand);
  assert.equal(hand.street, "showdown");
  assert.equal(advanceStreet(hand), hand);

  const mucked = foldPlayer(hand, seats, "b", 4);
  assert.equal(mucked.phase, "done");
  assert.deepEqual(mucked.result.winners, ["a"]);
  assert.deepEqual(mucked.result.reachedShowdown, ["a", "b"]);
  assert.equal(mucked.result.actions.at(-1).street, "showdown");

  const picking = beginPick(hand);
  assert.equal(beginPick(picking), picking);
  assert.equal(confirmWinners(picking, seats, 4), picking);
  let split = toggleWinner(picking, seats, "a");
  split = toggleWinner(split, seats, "b");
  split = toggleWinner(split, seats, "b");
  assert.deepEqual(split.winners, ["a"]);
  split = toggleWinner(split, seats, "b");
  const saved = confirmWinners(split, seats, 4);
  assert.deepEqual(saved.result.winners, ["a", "b"]);
  assert.deepEqual(saved.result.reachedShowdown, ["a", "b"]);
  assert.equal(cancelPick(picking).phase, "play");
  assert.deepEqual(cancelPick(picking).winners, []);
});

test("fold percentages use hands that saw the street", () => {
  const early = {
    seats: [
      { seat: 0, playerId: "a" },
      { seat: 1, playerId: "b" },
      { seat: 2, playerId: "c" },
    ],
    actions: [
      { playerId: "b", street: "preflop" },
      { playerId: "c", street: "flop" },
    ],
    vpip: [
      { playerId: "a", entered: true },
      { playerId: "b", entered: false },
      { playerId: "c", entered: true },
    ],
    reachedShowdown: [],
    winners: ["a"],
    endStreet: "flop",
  };
  const showdown = {
    seats: [
      { seat: 0, playerId: "a" },
      { seat: 1, playerId: "b" },
    ],
    actions: [],
    vpip: { a: true, b: true },
    reachedShowdown: ["a", "b"],
    winners: ["a", "b"],
    endStreet: "showdown",
  };
  const riverWin = {
    seats: [
      { seat: 0, playerId: "a" },
      { seat: 4, playerId: "b" },
    ],
    actions: [{ playerId: "b", street: "turn" }],
    vpip: [
      { playerId: "a", entered: false },
      { playerId: "b", entered: false },
    ],
    reachedShowdown: [],
    winners: ["a"],
    endStreet: "turn",
  };

  const a = statsForPlayer([early, showdown, riverWin], "a");
  assert.equal(a.handsDealt, 3);
  assert.equal(a.saw.preflop, 3);
  assert.equal(a.folds.preflop, 0);
  assert.equal(a.foldPct.preflop, 0);
  assert.equal(a.saw.flop, 3);
  assert.equal(a.saw.turn, 2);
  assert.equal(a.saw.river, 1);
  assert.equal(a.foldPct.turn, 0);
  assert.equal(a.vpipHands, 2);
  assert.equal(a.vpipPct, 2 / 3);
  assert.equal(a.showdowns, 1);
  assert.equal(a.showdownWins, 1);
  assert.equal(a.showdownPct, 1 / 3);
  assert.equal(a.showdownWinPct, 1);

  const b = statsForPlayer([early, showdown, riverWin], "b");
  assert.equal(b.folds.preflop, 1);
  assert.equal(b.saw.preflop, 3);
  assert.equal(b.foldPct.preflop, 1 / 3);
  assert.equal(b.saw.flop, 2);
  assert.equal(b.folds.flop, 0);
  assert.equal(b.saw.turn, 2);
  assert.equal(b.folds.turn, 1);
  assert.equal(b.foldPct.turn, 1 / 2);
  assert.equal(b.saw.river, 1);
  assert.equal(b.foldPct.river, 0);
  assert.equal(b.vpipPct, 1 / 3);
  assert.equal(b.showdowns, 1);
  assert.equal(b.showdownWins, 1);
  assert.equal(b.showdownWinPct, 1);

  const c = statsForPlayer([early, showdown, riverWin], "c");
  assert.equal(c.handsDealt, 1);
  assert.equal(c.saw.flop, 1);
  assert.equal(c.folds.flop, 1);
  assert.equal(c.foldPct.flop, 1);
  assert.equal(c.saw.turn, 0);
  assert.equal(c.foldPct.turn, null);
  assert.equal(c.foldPct.river, null);
  assert.equal(c.showdowns, 0);
  assert.equal(c.showdownPct, 0);
  assert.equal(c.showdownWinPct, null);
  assert.equal(c.vpipPct, 1);
});

test("a win before showdown is not a showdown win", () => {
  const stats = statsForPlayer([
    {
      seats: [{ seat: 0, playerId: "a" }, { seat: 1, playerId: "b" }],
      actions: [{ playerId: "b", street: "river" }],
      vpip: [],
      reachedShowdown: [],
      winners: ["a"],
      endStreet: "river",
    },
  ], "a");
  assert.equal(stats.saw.river, 1);
  assert.equal(stats.showdowns, 0);
  assert.equal(stats.showdownWins, 0);
  assert.equal(stats.showdownWinPct, null);
  assert.equal(stats.vpipPct, 0);
});

test("an absent end street is inferred, and a later duplicate fold is ignored", () => {
  const inferred = statsForPlayer([
    {
      seats: [{ seat: 0, playerId: "a" }],
      actions: [],
      reachedShowdown: ["a"],
      winners: ["a"],
      vpip: [{ playerId: "a", entered: true }],
    },
    {
      seats: [{ seat: 0, playerId: "a" }, { seat: 1, playerId: "b" }],
      actions: [{ playerId: "b", street: "flop" }],
      reachedShowdown: [],
      winners: ["a"],
      vpip: [],
    },
  ], "a");
  assert.equal(inferred.saw.river, 1);
  assert.equal(inferred.saw.flop, 2);
  assert.equal(inferred.saw.turn, 1);
  assert.equal(inferred.showdowns, 1);

  const doubled = statsForPlayer([
    {
      seats: [{ seat: 0, playerId: "a" }],
      actions: [
        { playerId: "a", street: "turn" },
        { playerId: "a", street: "flop" },
      ],
      reachedShowdown: [],
      winners: ["b"],
      endStreet: "turn",
      vpip: [],
    },
  ], "a");
  assert.equal(doubled.folds.flop, 1);
  assert.equal(doubled.folds.turn, 0);
  assert.equal(doubled.saw.turn, 0);
});

test("sample size flips at 50 dealt hands, and an empty log has no rates", () => {
  const hands = [];
  for (let i = 0; i < SMALL_SAMPLE_HANDS; i += 1) {
    hands.push({
      seats: [{ seat: 0, playerId: "a" }],
      actions: i % 2 === 0 ? [{ playerId: "a", street: "preflop" }] : [],
      vpip: [{ playerId: "a", entered: i % 2 === 1 }],
      reachedShowdown: [],
      winners: i % 2 === 0 ? ["b"] : ["a"],
      endStreet: "preflop",
    });
  }
  const under = statsForPlayer(hands.slice(0, 49), "a");
  assert.equal(under.handsDealt, 49);
  assert.equal(under.smallSample, true);
  assert.equal(under.foldPct.preflop, 25 / 49);

  const enough = statsForPlayer(hands, "a");
  assert.equal(enough.handsDealt, 50);
  assert.equal(enough.smallSample, false);
  assert.equal(enough.folds.preflop, 25);
  assert.equal(enough.vpipHands, 25);
  assert.equal(enough.foldPct.flop, null);

  const none = statsForPlayer([], "a");
  assert.equal(none.handsDealt, 0);
  assert.equal(none.vpipPct, null);
  assert.equal(none.foldPct.preflop, null);
  assert.equal(none.showdownPct, null);
  assert.equal(none.showdownWinPct, null);
  assert.equal(none.smallSample, true);
});

test("percentages render without a currency mark", () => {
  assert.equal(formatPct(null), "—");
  assert.equal(formatPct(0), "0%");
  assert.equal(formatPct(1), "100%");
  assert.equal(formatPct(1 / 3), "33.3%");
  assert.equal(formatPct(0.5), "50%");
  for (const sample of [formatPct(1 / 3), formatPct(0), foldLabel("river")]) {
    assert.equal(/[$€£¥฿]/.test(sample), false);
  }
});
