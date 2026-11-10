/**
 * Live-table rules and the percentages computed from logged hands.
 *
 * A hand record stores who sat, who folded on which street, who voluntarily
 * entered the pot pre-flop, who reached showdown, and who won. It never
 * stores a chip count or a currency amount.
 *
 * Fold percentage on a street is folds on that street divided by hands that
 * saw that street. A player saw a street when the hand reached it and they
 * had not folded earlier. VPIP is hands marked as a voluntary pre-flop entry
 * divided by hands dealt. Showdown percentage is hands that reached showdown
 * divided by hands dealt. Showdown win percentage is wins at showdown
 * divided by hands that reached showdown.
 */

export const SEAT_COUNT = 10;

export const STREETS = ["preflop", "flop", "turn", "river", "showdown"];

export const STREET_LABEL = {
  preflop: "Pre-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

export const SMALL_SAMPLE_HANDS = 50;

const STREET_INDEX = Object.fromEntries(STREETS.map((street, index) => [street, index]));

const BETTING_STREETS = ["preflop", "flop", "turn", "river"];

export function seatPoint(index, count = SEAT_COUNT) {
  const theta = (index / count) * Math.PI * 2;
  return {
    x: 50 - Math.sin(theta) * 40,
    y: 50 + Math.cos(theta) * 40,
  };
}

export function occupiedSeats(seats) {
  const list = [];
  for (let seat = 0; seat < seats.length; seat += 1) {
    const playerId = seats[seat];
    if (typeof playerId === "string" && playerId) list.push({ seat, playerId });
  }
  return list;
}

export function nextButtonSeat(seats, buttonSeat) {
  const open = occupiedSeats(seats).map((seat) => seat.seat);
  if (open.length === 0) return null;
  const at = open.indexOf(buttonSeat);
  if (at === -1) return open[0];
  return open[(at + 1) % open.length];
}

export function freshHand() {
  return {
    street: "preflop",
    folds: [],
    vpip: {},
    winners: [],
    phase: "play",
    result: null,
  };
}

export function cloneHand(hand) {
  return {
    street: hand.street,
    folds: hand.folds.map((fold) => ({ playerId: fold.playerId, street: fold.street })),
    vpip: { ...hand.vpip },
    winners: [...hand.winners],
    phase: hand.phase,
    result: null,
  };
}

export function playersStillIn(seats, hand) {
  const folded = new Set(hand.folds.map((fold) => fold.playerId));
  return occupiedSeats(seats).filter((seat) => !folded.has(seat.playerId));
}

export function foldOf(hand, playerId) {
  return hand.folds.find((fold) => fold.playerId === playerId) || null;
}

export function foldLabel(street) {
  const name = STREET_LABEL[street];
  if (!name) return "Folded";
  return `Folded – ${name}`;
}

function finishHand(hand, seats, buttonSeat) {
  const still = playersStillIn(seats, hand);
  let winners = hand.winners.filter((id) => still.some((seat) => seat.playerId === id));
  if (winners.length === 0 && still.length === 1) winners = [still[0].playerId];
  if (winners.length === 0) return hand;

  const seated = occupiedSeats(seats);
  const foldedEarly = new Set(
    hand.folds.filter((fold) => fold.street !== "showdown").map((fold) => fold.playerId),
  );
  const reachedShowdown = hand.street === "showdown"
    ? seated.filter((seat) => !foldedEarly.has(seat.playerId)).map((seat) => seat.playerId)
    : [];

  return {
    street: hand.street,
    folds: hand.folds.map((fold) => ({ playerId: fold.playerId, street: fold.street })),
    vpip: { ...hand.vpip },
    winners,
    phase: "done",
    result: {
      buttonSeat,
      endStreet: hand.street,
      seats: seated.map((seat) => ({ seat: seat.seat, playerId: seat.playerId })),
      actions: hand.folds.map((fold) => ({ playerId: fold.playerId, street: fold.street })),
      vpip: seated.map((seat) => ({
        playerId: seat.playerId,
        entered: hand.vpip[seat.playerId] === true,
      })),
      reachedShowdown,
      winners: [...winners],
    },
  };
}

export function foldPlayer(hand, seats, playerId, buttonSeat) {
  if (hand.phase === "done") return hand;
  if (hand.phase !== "play" && hand.phase !== "pick") return hand;
  const still = playersStillIn(seats, hand);
  if (!still.some((seat) => seat.playerId === playerId)) return hand;
  if (still.length <= 1) return hand;

  const next = cloneHand(hand);
  next.folds = [...next.folds, { playerId, street: hand.street }];
  next.winners = next.winners.filter((id) => id !== playerId);
  if (playersStillIn(seats, next).length <= 1) return finishHand(next, seats, buttonSeat);
  return next;
}

export function toggleVpip(hand, seats, playerId) {
  if (hand.phase !== "play" || hand.street !== "preflop") return hand;
  if (!occupiedSeats(seats).some((seat) => seat.playerId === playerId)) return hand;
  if (foldOf(hand, playerId)) return hand;
  const next = cloneHand(hand);
  next.vpip[playerId] = next.vpip[playerId] !== true;
  return next;
}

export function advanceStreet(hand) {
  if (hand.phase !== "play") return hand;
  const index = STREET_INDEX[hand.street];
  if (hand.street === "showdown" || index == null) return hand;
  const next = cloneHand(hand);
  next.street = STREETS[index + 1];
  return next;
}

export function beginPick(hand) {
  if (hand.phase !== "play") return hand;
  const next = cloneHand(hand);
  next.phase = "pick";
  next.winners = [];
  return next;
}

export function cancelPick(hand) {
  if (hand.phase !== "pick") return hand;
  const next = cloneHand(hand);
  next.phase = "play";
  next.winners = [];
  return next;
}

export function toggleWinner(hand, seats, playerId) {
  if (hand.phase !== "pick") return hand;
  if (!playersStillIn(seats, hand).some((seat) => seat.playerId === playerId)) return hand;
  const next = cloneHand(hand);
  if (next.winners.includes(playerId)) {
    next.winners = next.winners.filter((id) => id !== playerId);
  } else {
    next.winners = [...next.winners, playerId];
  }
  return next;
}

export function confirmWinners(hand, seats, buttonSeat) {
  if (hand.phase !== "pick") return hand;
  const still = playersStillIn(seats, hand);
  const winners = hand.winners.filter((id) => still.some((seat) => seat.playerId === id));
  if (winners.length === 0) return hand;
  const next = cloneHand(hand);
  next.winners = winners;
  return finishHand(next, seats, buttonSeat);
}

export function stampHand(result, meta) {
  return {
    id: meta.id,
    sessionDate: meta.sessionDate,
    timestamp: meta.timestamp,
    buttonSeat: result.buttonSeat,
    endStreet: result.endStreet,
    seats: result.seats.map((seat) => ({ seat: seat.seat, playerId: seat.playerId })),
    actions: result.actions.map((action) => ({ playerId: action.playerId, street: action.street })),
    vpip: result.vpip.map((row) => ({ playerId: row.playerId, entered: row.entered === true })),
    reachedShowdown: [...result.reachedShowdown],
    winners: [...result.winners],
  };
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

function endIndex(hand) {
  if (STREETS.includes(hand.endStreet)) return STREET_INDEX[hand.endStreet];
  if ((hand.reachedShowdown || []).length > 0) return STREET_INDEX.showdown;
  let best = STREET_INDEX.preflop;
  for (const action of hand.actions || []) {
    const index = STREET_INDEX[action?.street];
    if (index != null && index > best) best = index;
  }
  return best;
}

function leaveIndex(hand, playerId) {
  let best = Infinity;
  for (const action of hand.actions || []) {
    if (!action || action.playerId !== playerId) continue;
    const index = STREET_INDEX[action.street];
    if (index == null) continue;
    if (index < best) best = index;
  }
  return best;
}

function enteredPot(hand, playerId) {
  if (Array.isArray(hand.vpip)) {
    const row = hand.vpip.find((item) => item && item.playerId === playerId);
    return row?.entered === true;
  }
  if (hand.vpip && typeof hand.vpip === "object") return hand.vpip[playerId] === true;
  return false;
}

export function statsForPlayer(hands, playerId) {
  const folds = { preflop: 0, flop: 0, turn: 0, river: 0 };
  const saw = { preflop: 0, flop: 0, turn: 0, river: 0 };
  let handsDealt = 0;
  let vpipHands = 0;
  let showdowns = 0;
  let showdownWins = 0;

  for (const hand of hands || []) {
    const seated = (hand.seats || []).some((seat) => seat && seat.playerId === playerId);
    if (!seated) continue;
    handsDealt += 1;

    const left = leaveIndex(hand, playerId);
    const end = endIndex(hand);
    for (const street of BETTING_STREETS) {
      const index = STREET_INDEX[street];
      if (end < index || left < index) continue;
      saw[street] += 1;
      if (left === index) folds[street] += 1;
    }

    if (enteredPot(hand, playerId)) vpipHands += 1;
    if ((hand.reachedShowdown || []).includes(playerId)) {
      showdowns += 1;
      if ((hand.winners || []).includes(playerId)) showdownWins += 1;
    }
  }

  return {
    playerId,
    handsDealt,
    folds,
    saw,
    vpipHands,
    showdowns,
    showdownWins,
    foldPct: {
      preflop: ratio(folds.preflop, saw.preflop),
      flop: ratio(folds.flop, saw.flop),
      turn: ratio(folds.turn, saw.turn),
      river: ratio(folds.river, saw.river),
    },
    vpipPct: ratio(vpipHands, handsDealt),
    showdownPct: ratio(showdowns, handsDealt),
    showdownWinPct: ratio(showdownWins, showdowns),
    smallSample: handsDealt < SMALL_SAMPLE_HANDS,
  };
}

export function formatPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 1000) / 10;
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(1)}%`;
}
