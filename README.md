# Fazwazpoker

Private ledger for the group. It is a static site: plain HTML, CSS, and JavaScript, with no build step. Rankings, totals, and charts are calculated from the two data files.

## View it

From this folder:

```bash
python3 -m http.server
```

Open the URL the server prints. Opening `index.html` directly will not load the data files, because the page fetches them.

GitHub Pages: <https://tarmo168.github.io/fazpoke/>

Pages has to be switched on once, with **Settings → Pages → Build and deployment → Source: GitHub Actions**. After that, `.github/workflows/pages.yml` publishes this site on every push to `main`. The workflow runs the checks, then deploys `index.html`, `css/`, `js/`, `data/`, and `assets/`.

## What the site shows

- A leaderboard of total earnings (each player's net across every session), sortable by total earnings or sessions played.
- A roster for anyone whose result is still unrecorded.
- A profile for each player: photo, recorded stats, and the sessions they appear in.
- A cumulative line for each recorded player, and one chart with every recorded player.
- A session ledger in the order the entries were written.
- A live table for the current home game: seating, a hand log, and percentages. It stays in the browser.

## How numbers work

Figures are plain numbers. Positive results use a leading `+`. Negative results use a leading `-`. A recorded break-even is `0`.

`0` stays on the board. It is a real result.

`null` means the result was not written down. That entry stays on the roster and in the ledger as unrecorded. It is left out of rankings, buy-in totals, net totals, and charts. It is not stored or counted as zero.

Taam in Session 1 is the recorded break-even (`0`). Chase and JJ are on Session 1 with a buy-in of `0` and an unrecorded result (`null`). Na has no session entry at all. All three stay off the board.

The chart draws a zero point labeled Start, before the first session in the file. That point is the baseline of a cumulative line, not an extra session. A later session with no recorded result keeps the previous cumulative total and is drawn as a hollow point.

Sessions are plotted in file order. Keep the oldest session first.

Equal values on the board fall back to total earnings (high to low), then to name.

## Add a session

Append one object to the array in `data/sessions.json`.

- `id`: a new unique id, for example `session-2`.
- `label`: the name to show. This group labels them `Session 1`, `Session 2`, and so on. Leave a date out unless one was actually recorded.
- `entries`: one object per player you want on that session's sheet.
  - `playerId` must match an `id` in `data/players.json`.
  - `buyIn` is a number.
  - `net` is a number when the result was written down, including `0` for a break-even. Use `null` when the result is unrecorded.

```json
{
  "id": "session-2",
  "label": "Session 2",
  "entries": [
    { "playerId": "taam", "buyIn": 0, "net": null }
  ]
}
```

Replace `buyIn` and `net` with the real figures before you commit. Leave anyone with no note for that session out of `entries`, the way Na is left out of Session 1.

Check the sheet before pushing:

```bash
node --test tests/ledger.test.mjs tests/handstats.test.mjs tests/handstore.test.mjs
```

Recorded nets on a finished session should add up to `0`. The test locks Session 1 at buy-in `3,700` and net `0`.

## Live table

Open **Live table** in the header. It is meant for a TV during a home game, and it works by tapping.

Seat up to 10 players clockwise from the bottom. Tap a seat, then a player, or drag a player onto a seat. Each seat shows the photo and the name. Place the dealer button on one of them. The seating stays in the browser, so a refresh keeps it.

**Start hand** begins on Pre-flop. **Next street** moves through Flop, Turn, River, and Showdown. Tap a seated player to fold them on the current street. The seat dims and reads `Folded – Flop` (or whichever street it was). **Undo** steps back. On Pre-flop, hold a seat or tap **VPIP** when someone voluntarily enters the pot.

The hand ends when one player is left. Otherwise tap **Name winners**, tap each winner (more than one splits the hand), and **Save hand**. The button then moves clockwise to the next seated player.

Percentages are on the same page. Fold percentage is folds on that street divided by hands that reached it with the player still in. VPIP, showdown, and showdown win are there too. A note shows when the log has fewer than 50 hands. **Head to head** puts two players side by side.

**Full screen** enlarges the table for a TV. The same page works in landscape on a phone.

Hands are kept in this browser, not in `data/sessions.json`. **Export JSON** downloads the log. **Import JSON** replaces it. No chip counts are stored. `js/handstore.js` is the storage layer: a later remote log, such as Google Sheets through Apps Script, can implement the same read and write methods.

## Add a player

Append one object to `data/players.json` and add a square photo at the path you name.

```json
{ "id": "new-id", "name": "Display Name", "photo": "assets/players/new-id.png" }
```

Use a lowercase id with no spaces. The photo is a PNG with a transparent circle around the face. Chart colors are assigned from roster order, so existing players keep their colors when you append someone new.

## Photos

The current faces were cropped from the group screenshots, top to bottom:

| File | Player | Screenshot label |
| --- | --- | --- |
| `assets/players/taam.png` | Taam | T |
| `assets/players/bank.png` | Bank | B. |
| `assets/players/chase.png` | Chase | Chase |
| `assets/players/fah.png` | Fah | Fah - Bangkok |
| `assets/players/jj.png` | JJ | JJ FazWaz Thailand |
| `assets/players/dom.png` | Dom | Na Dom 152 |
| `assets/players/na.png` | Na | n.a. |
| `assets/players/tip.png` | Tip | Tip |
| `assets/players/will.png` | Will | will |
| `assets/players/zack.png` | Zack | Zack |

The site uses the display names in this table, not the screenshot labels.

## Fonts

Fraunces and Outfit are shipped under the SIL Open Font License. The license texts are `assets/fonts/OFL-fraunces.txt` and `assets/fonts/OFL-outfit.txt`.
