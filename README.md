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
- A live leaderboard for tonight's game: buy-ins, stacks, and the running result. It stays in the browser.

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
node --test tests/ledger.test.mjs tests/liveboard.test.mjs tests/sheets.test.mjs
```

Recorded nets on a finished session should add up to `0`. The test locks Session 1 at buy-in `3,700` and net `0`.

## Live leaderboard

Open **Live board** in the header. It is meant for a TV during a home game, and it works by tapping.

Pick who is playing tonight. Photos come from the roster. Enter a starting buy-in for each player, then **Start**. The stack starts equal to that buy-in, so everyone opens at 0.

The board ranks the table by live result: current stack minus buy-in tonight. Positive results are green with a leading `+`. Negative results are red with a leading `-`. A break-even is `0`. Changing a stack re-sorts the board. The header shows the date, the number of players, and **In play** (the buy-ins added together). A small line shows when the board was last updated.

Tap a player and enter the stack they have in front of them. **+ Re-buy** adds that amount to the buy-in and to the stack, so the result stays put until the next count. **Full screen** enlarges the type for a TV. The same page works in landscape on a phone. **Reset** clears the night after a confirm. A refresh keeps the night on this device.

**End game** lists each buy-in and net, and checks that the nets sum to 0. **Copy results** writes one plain line per player, such as `Dom 400 +910`. **Download JSON** saves one session in the same shape as `data/sessions.json`, using the next session id. Paste that object into the ledger and fill in any figure that still needs correcting. **Back to board** returns to the stacks.

To save the night without editing the file, set `SHEET_API_URL` in `js/config.js`. The steps are in `SETUP-GOOGLE-SHEET.md`. Leave that URL empty and nothing about the sheet runs. When it is set, End game asks once for the host PIN, saves the session, and the board, charts, and ledger include it. Saving stays off while the nets do not sum to 0. Copy and download remain if the sheet does not save.

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
