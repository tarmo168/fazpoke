import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatResultsText } from "../js/liveboard.js";
import {
  LIVE_BOARD_URL,
  SITE_URL,
  canWebShare,
  formatInviteText,
  formatResultsShareText,
  isInviteDateAllowed,
  leaderboardShareData,
  leaderboardShareText,
  lineItShareUrl,
  lineTextShareUrl,
  nextUpcomingDate,
  resultsShareData,
  shareNative,
} from "../js/share.js";

const MARKS = /[$€£¥฿₱₩₽₹¢]/;

const rows = [
  { name: "Dom", buyIn: 400, net: 910 },
  { name: "Will", buyIn: 1800, net: 880 },
  { name: "Taam", buyIn: 500, net: 0 },
  { name: "Fah", buyIn: 400, net: -190 },
];

test("the site share link is LINE's url plugin", () => {
  assert.equal(
    lineItShareUrl(),
    "https://social-plugins.line.me/lineit/share?url=https%3A%2F%2Ftarmo168.github.io%2Ffazpoke%2F",
  );
  assert.equal(lineItShareUrl(SITE_URL), lineItShareUrl());
  const custom = "https://example.com/night?table=1";
  assert.equal(
    lineItShareUrl(custom),
    `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(custom)}`,
  );
});

test("a text share round-trips through LINE's share link", () => {
  const text = leaderboardShareText();
  assert.equal(text, `Fazwazpoker leaderboard\n${SITE_URL}`);
  const url = lineTextShareUrl(text);
  assert.equal(url.startsWith("https://line.me/R/share?text="), true);
  const encoded = url.slice("https://line.me/R/share?text=".length);
  assert.equal(decodeURIComponent(encoded), text);
  assert.equal(encoded.includes("\n"), false);
  assert.equal(MARKS.test(text), false);
});

test("results share text matches the copy lines, with a header and the site link", () => {
  const text = formatResultsShareText(rows, "2026-11-10");
  const parts = text.split("\n");
  assert.equal(parts[0], "Fazwazpoker \u2013 Tuesday 10 Nov 2026");
  assert.equal(parts.slice(1, -1).join("\n"), formatResultsText(rows));
  assert.equal(parts[1], "Dom 400 +910");
  assert.equal(parts.at(-2), "Fah 400 -190");
  assert.equal(parts.at(-1), SITE_URL);
  assert.equal(text.endsWith("\n"), false);
  assert.equal(MARKS.test(text), false);

  const plain = formatResultsShareText(rows, "");
  assert.equal(plain.split("\n")[0], "Fazwazpoker");
  assert.equal(plain.includes("\u2013"), false);
});

test("results share data is the same plain text", () => {
  const text = formatResultsShareText(rows, "2026-11-10");
  assert.deepEqual(resultsShareData(text), { title: "Fazwazpoker", text });
  assert.deepEqual(leaderboardShareData(), {
    title: "Fazwazpoker",
    text: "Fazwazpoker leaderboard",
    url: SITE_URL,
  });
});

test("a game-night invite names the day, then who should reply", () => {
  const full = formatInviteText({
    isoDate: "2026-11-10",
    time: "8:30 pm",
    location: "The usual table",
  });
  assert.equal(full, [
    "\u2660 Fazwazpoker game night",
    "Tuesday 10 Nov 2026 8:30 pm",
    "The usual table",
    "Who's in? Reply with \u{1F64B}",
    `Live board: ${LIVE_BOARD_URL}`,
  ].join("\n"));

  const bare = formatInviteText({ isoDate: "2026-11-10", time: "  ", location: "\n" });
  assert.equal(bare, [
    "\u2660 Fazwazpoker game night",
    "Tuesday 10 Nov 2026",
    "Who's in? Reply with \u{1F64B}",
    `Live board: ${LIVE_BOARD_URL}`,
  ].join("\n"));

  const messy = formatInviteText({
    isoDate: "2026-11-14",
    time: "8pm\nsharp",
    location: "  Room 4 \n upstairs ",
  });
  assert.equal(messy.split("\n")[1], "Saturday 14 Nov 2026 8pm sharp");
  assert.equal(messy.split("\n")[2], "Room 4 upstairs");
  assert.equal(MARKS.test(full + bare + messy), false);

  const url = lineTextShareUrl(full);
  assert.equal(
    decodeURIComponent(url.slice("https://line.me/R/share?text=".length)),
    full,
  );
});

test("the invite date defaults to today and today is allowed", () => {
  const now = new Date(2026, 10, 10, 23, 45);
  assert.equal(nextUpcomingDate(now), "2026-11-10");
  assert.equal(isInviteDateAllowed("2026-11-10", now), true);
  assert.equal(isInviteDateAllowed("2026-11-11", now), true);
  assert.equal(isInviteDateAllowed("2026-11-09", now), false);
  assert.equal(isInviteDateAllowed("2026-02-31", now), false);
  assert.equal(isInviteDateAllowed("", now), false);
  assert.equal(isInviteDateAllowed("10 Nov 2026", now), false);
});

test("web share is offered only when the browser has it", async () => {
  assert.equal(canWebShare(undefined), false);
  assert.equal(canWebShare({}), false);
  assert.equal(canWebShare({ share: () => {} }), true);

  assert.equal(await shareNative({ text: "Hi" }, {}), "unavailable");
  let seen = null;
  assert.equal(await shareNative({ text: "Hi" }, {
    share(data) { seen = data; },
  }), "shared");
  assert.deepEqual(seen, { text: "Hi" });
  assert.equal(await shareNative({ text: "Hi" }, {
    share() { const error = new Error("closed"); error.name = "AbortError"; throw error; },
  }), "aborted");
  assert.equal(await shareNative({ text: "Hi" }, {
    share() { throw new Error("blocked"); },
  }), "failed");
});

test("the page names a static preview image", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /property="og:title" content="Fazwazpoker"/);
  assert.match(html, /property="og:description" content="Leaderboard, charts and session ledger for our poker nights"/);
  assert.match(html, /property="og:url" content="https:\/\/tarmo168.github.io\/fazpoke\/"/);
  assert.match(html, /property="og:type" content="website"/);
  assert.match(html, /property="og:image" content="https:\/\/tarmo168.github.io\/fazpoke\/assets\/og-image.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image" content="https:\/\/tarmo168.github.io\/fazpoke\/assets\/og-image.png"/);
  assert.equal(MARKS.test(html), false);

  const png = readFileSync(new URL("../assets/og-image.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
