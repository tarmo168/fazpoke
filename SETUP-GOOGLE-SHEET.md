# Save sessions to a Google Sheet

The site stays on GitHub Pages. A Google Sheet holds new sessions. You paste one script, deploy it, and the maintainer puts the web app URL in `js/config.js`.

1. Create a new Google Sheet. Name it `Fazwazpoker`.
2. Open **Extensions → Apps Script**. Delete the sample `Code.gs` and paste in the whole file `apps-script/Code.gs` from this repo. Click **Save**.
3. Open **Project Settings** (the gear) → **Script properties** → **Add script property**.
   - Property: `HOST_PIN`
   - Value: a PIN you choose
   - Click **Save script properties**.
4. Click **Deploy → New deployment**. Click the gear next to **Select type** and choose **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**.
5. Click **Authorize access** and allow the permissions it asks for (it reads and writes this spreadsheet).
6. Copy the **Web app URL**. It ends in `/exec`.

Give that URL to the maintainer. It goes in `js/config.js`:

```js
export const SHEET_API_URL = "https://script.google.com/macros/s/……/exec";
```

Leave `SHEET_API_URL` as `""` until then. The site then works as it does now.

The first save creates a tab named **Sessions**. Each player is one row, with the session id and the date. A session is stored once: retrying does not add a second copy. Recorded nets must sum to 0, or the save is rejected.

Anyone with the URL can read the sessions. The PIN is required to add one. After you change the script, open **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The same URL then serves the new code.
