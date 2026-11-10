import assert from "node:assert/strict";
import test from "node:test";
import {
  createHandId,
  createHandStore,
  isSessionDate,
  localSessionDate,
  localStorageAdapter,
  memoryAdapter,
  memoryStorage,
  parseHandLog,
} from "../js/handstore.js";

function sampleHand(id = "hand-1", extra = {}) {
  return {
    id,
    sessionDate: "2026-11-10",
    timestamp: "2026-11-10T18:00:00.000Z",
    buttonSeat: 0,
    endStreet: "flop",
    seats: [
      { seat: 0, playerId: "taam" },
      { seat: 3, playerId: "bank" },
    ],
    actions: [{ playerId: "bank", street: "flop" }],
    vpip: [
      { playerId: "taam", entered: true },
      { playerId: "bank", entered: false },
    ],
    reachedShowdown: [],
    winners: ["taam"],
    ...extra,
  };
}

test("the session date stays on the local calendar day", () => {
  assert.equal(localSessionDate(new Date(2026, 10, 10, 23, 45)), "2026-11-10");
  assert.equal(isSessionDate("2026-11-10"), true);
  assert.equal(isSessionDate("2026-02-31"), false);
  assert.equal(isSessionDate("10-11-2026"), false);
  assert.match(createHandId(1_700_000_000_000, 0.25), /^hand-[0-9a-z]+-[0-9a-z]+$/);
});

test("seating and hands round-trip, and chip fields are dropped", async () => {
  const store = createHandStore(memoryAdapter());
  await store.putSeating({
    sessionDate: "2026-11-10",
    buttonSeat: 3,
    seats: ["taam", null, null, "bank", "bank", "nope"],
  });
  const seating = await store.getSeating();
  assert.equal(seating.sessionDate, "2026-11-10");
  assert.equal(seating.buttonSeat, 3);
  assert.deepEqual(seating.seats.slice(0, 6), ["taam", null, null, "bank", null, "nope"]);

  await store.putHands([sampleHand("hand-1", { amount: 40, chips: 10 })]);
  const hands = await store.getHands();
  assert.equal(hands.length, 1);
  assert.equal("amount" in hands[0], false);
  assert.equal("chips" in hands[0], false);
  assert.equal(hands[0].winners[0], "taam");

  const raw = await store.exportJSON();
  const exported = JSON.parse(raw);
  assert.equal(exported.version, 1);
  assert.equal(exported.hands.length, 1);
  assert.equal("draft" in exported, false);
  assert.equal(/[$€£¥฿]/.test(raw), false);

  const other = createHandStore(memoryAdapter());
  await other.putSeating({ sessionDate: "2026-01-01", buttonSeat: null, seats: ["keep"] });
  await other.putHands([sampleHand("old")]);
  const imported = await other.importJSON(raw);
  assert.equal(imported.hands.length, 1);
  assert.equal(imported.hands[0].id, "hand-1");
  assert.equal((await other.getSeating()).buttonSeat, 3);
  assert.equal(await other.getDraft(), null);
});

test("a local storage adapter keeps the same log", async () => {
  const storage = memoryStorage();
  const store = createHandStore(localStorageAdapter(storage));
  await store.putHands([sampleHand()]);
  const again = createHandStore(localStorageAdapter(storage));
  const hands = await again.getHands();
  assert.equal(hands.length, 1);
  assert.equal(hands[0].id, "hand-1");
  assert.equal(storage.getItem("fazpoke.live.hands")?.includes("amount"), false);
});

test("a bad import leaves the saved log alone", async () => {
  const store = createHandStore(memoryAdapter());
  await store.putHands([sampleHand("kept")]);
  await assert.rejects(() => store.importJSON("{"), /not a hand log/);
  await assert.rejects(() => store.importJSON(JSON.stringify({ version: 2, hands: [] })), /unsupported/);
  await assert.rejects(
    () => store.importJSON(JSON.stringify({
      version: 1,
      hands: [sampleHand("ok"), { id: "broken" }],
    })),
    /Hand 2/,
  );
  const hands = await store.getHands();
  assert.deepEqual(hands.map((hand) => hand.id), ["kept"]);
});

test("an in-progress hand can be saved and an unreadable draft is ignored", async () => {
  const store = createHandStore(memoryAdapter());
  const draft = await store.putDraft({
    hand: {
      street: "turn",
      phase: "play",
      folds: [{ playerId: "bank", street: "flop" }],
      winners: [],
      vpip: { taam: true },
    },
    undo: [],
  });
  assert.equal(draft.hand.street, "turn");
  assert.equal((await store.getDraft()).hand.vpip.taam, true);
  await store.putDraft(null);
  assert.equal(await store.getDraft(), null);

  const loose = createHandStore(memoryAdapter({
    draft: { hand: { street: "nope", phase: "play", folds: [], winners: [], vpip: {} } },
    hands: [sampleHand(), { id: "" }, sampleHand()],
  }));
  assert.equal(await loose.getDraft(), null);
  assert.equal((await loose.getHands()).length, 1);
});

test("parseHandLog accepts a log with no seating block", () => {
  const parsed = parseHandLog(JSON.stringify({ version: 1, hands: [sampleHand()] }));
  assert.equal(parsed.seating, null);
  assert.equal(parsed.hands[0].endStreet, "flop");
});
