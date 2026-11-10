import assert from "node:assert/strict";
import test from "node:test";
import { SHEET_API_URL } from "../js/config.js";
import {
  buildSaveBody,
  buildSessionPayload,
  maxSessionNumber,
  mergeSessions,
  netsBalance,
  nextSessionNumber,
  normalizeSheetSessions,
  recordedNetSum,
  sessionNumberOf,
  sheetEnabled,
} from "../js/sheets.js";

const fileSessions = [
  {
    id: "session-1",
    label: "Session 1",
    entries: [
      { playerId: "dom", buyIn: 400, net: 910 },
      { playerId: "will", buyIn: 800, net: -910 },
    ],
  },
  {
    id: "session-3",
    label: "Session 3",
    entries: [{ playerId: "taam", buyIn: 500, net: 0 }],
  },
];

test("the sheet URL is empty until the maintainer sets it", () => {
  assert.equal(SHEET_API_URL, "");
  assert.equal(sheetEnabled(), false);
  assert.equal(sheetEnabled(""), false);
  assert.equal(sheetEnabled("  "), false);
  assert.equal(sheetEnabled("https://script.google.com/macros/s/abc/exec"), true);
});

test("merge keeps one copy of each session id and orders by number", () => {
  const file = fileSessions.map((session) => ({ ...session, entries: session.entries.map((entry) => ({ ...entry })) }));
  const sheet = [
    {
      id: "session-4",
      number: 4,
      label: "Session 4",
      date: "2026-11-12",
      entries: [{ playerId: "fah", buyIn: 400, net: 0 }],
    },
    {
      id: "session-1",
      number: 1,
      label: "Sheet copy",
      entries: [{ playerId: "dom", buyIn: 1, net: 0 }],
    },
    {
      id: "session-2",
      number: 2,
      label: "Session 2",
      date: "2026-11-10",
      entries: [
        { playerId: "dom", buyIn: 400, net: 50 },
        { playerId: "will", buyIn: 400, net: -50 },
      ],
    },
    {
      id: "session-2",
      number: 2,
      label: "later duplicate",
      entries: [{ playerId: "na", buyIn: 0, net: 0 }],
    },
  ];

  const merged = mergeSessions(file, sheet);
  assert.deepEqual(merged.map((session) => session.id), [
    "session-1",
    "session-2",
    "session-3",
    "session-4",
  ]);
  assert.equal(merged[0].label, "Session 1");
  assert.equal(merged[0].entries[0].net, 910);
  assert.equal(merged[1].label, "Session 2");
  assert.equal(merged[1].date, "2026-11-10");
  assert.equal(merged[1].entries.length, 2);
  assert.notEqual(merged[0], file[0]);
  assert.equal(file[0].label, "Session 1");

  assert.deepEqual(mergeSessions(fileSessions, []), fileSessions.map((session) => ({ ...session })));
  assert.deepEqual(mergeSessions(null, null), []);
  assert.deepEqual(mergeSessions([{ label: "no id" }], [{ id: "", label: "blank" }]), []);
});

test("a session id that is not numbered stays after the numbered ones", () => {
  const merged = mergeSessions(
    [{ id: "notes", label: "Notes", entries: [] }],
    [{ id: "session-2", label: "Session 2", entries: [] }],
  );
  assert.deepEqual(merged.map((session) => session.id), ["session-2", "notes"]);
});

test("sheet rows normalize to the ledger shape, including a null net", () => {
  const sessions = normalizeSheetSessions([
    {
      number: 2,
      date: "2026-11-10",
      results: [
        { playerId: "dom", buyIn: 400, net: 50 },
        { playerId: "will", buyIn: 400, net: -50 },
        { playerId: "na", buyIn: 0, net: null },
      ],
    },
    { id: "session-x", entries: [{ playerId: "", buyIn: 1, net: 0 }] },
    { id: "session-y", note: "not a session" },
    "nope",
  ]);
  assert.deepEqual(sessions, [
    {
      id: "session-2",
      label: "Session 2",
      entries: [
        { playerId: "dom", buyIn: 400, net: 50 },
        { playerId: "will", buyIn: 400, net: -50 },
        { playerId: "na", buyIn: 0, net: null },
      ],
      number: 2,
      date: "2026-11-10",
    },
  ]);
  assert.equal(normalizeSheetSessions({ sessions: [] }).length, 0);
  assert.equal(normalizeSheetSessions(null).length, 0);
});

test("session numbers continue after the file and the sheet", () => {
  assert.equal(sessionNumberOf({ id: "session-1", label: "Session 1" }), 1);
  assert.equal(sessionNumberOf({ id: "note", label: "Session 4" }), 4);
  assert.equal(sessionNumberOf({ number: 3 }), 3);
  assert.equal(sessionNumberOf({ id: "session-2", label: "Session 9" }), 9);
  assert.equal(sessionNumberOf(null), null);
  assert.equal(maxSessionNumber(fileSessions), 3);
  assert.equal(maxSessionNumber([]), 0);

  assert.equal(nextSessionNumber(0, 0), 1);
  assert.equal(nextSessionNumber(1, 4), 5);
  assert.equal(nextSessionNumber(6, 4), 7);
  assert.equal(nextSessionNumber(null, 2), 3);
  assert.equal(nextSessionNumber(-3, -1), 1);
});

test("the save body is a ledger session plus pin, key, and base", () => {
  const session = buildSessionPayload([
    { playerId: "dom", name: "Dom", buyIn: 400, stack: 450, net: 50, rank: 1 },
    { playerId: "will", buyIn: 400, net: -50 },
    { playerId: "na", buyIn: 0, net: null },
  ], "2026-11-10", 1);
  assert.deepEqual(session, {
    id: "session-2",
    number: 2,
    label: "Session 2",
    entries: [
      { playerId: "dom", buyIn: 400, net: 50 },
      { playerId: "will", buyIn: 400, net: -50 },
      { playerId: "na", buyIn: 0, net: null },
    ],
    date: "2026-11-10",
  });
  assert.equal(netsBalance(session.entries), true);
  assert.equal(recordedNetSum(session.entries), 0);

  const body = buildSaveBody({
    pin: "2468",
    key: "save-key-001",
    base: maxSessionNumber(fileSessions),
    session,
  });
  assert.deepEqual(body, {
    pin: "2468",
    key: "save-key-001",
    base: 3,
    session,
  });
  assert.equal(JSON.stringify(body).includes("Dom"), false);
  assert.equal(/[$€£¥฿₱₩₽₹]/.test(JSON.stringify(body)), false);

  const undated = buildSessionPayload(
    [{ playerId: "taam", buyIn: 500, net: 0 }],
    "",
    0,
  );
  assert.equal(undated.id, "session-1");
  assert.equal("date" in undated, false);
  assert.equal(netsBalance([{ playerId: "a", buyIn: 1, net: 10 }, { playerId: "b", buyIn: 1, net: -4 }]), false);
  assert.equal(netsBalance([{ playerId: "a", buyIn: 0, net: null }]), false);
  assert.equal(recordedNetSum([{ net: null }, { net: 0 }]), 0);
  assert.throws(() => buildSessionPayload([{ playerId: "", buyIn: 1, net: 0 }], "2026-11-10", 1), TypeError);
});
