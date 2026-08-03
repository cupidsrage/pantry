# Pantry & List

Recipe -> grocery list -> pantry stock tracker. Node/Express + SQLite (better-sqlite3), static frontend.

## Deploy to Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project -> Deploy from GitHub repo**, pick the repo.
3. Under the service **Variables**, add:
   - `ANTHROPIC_API_KEY` = your key (used server-side to parse recipes)
4. Railway auto-detects Node, runs `npm install`, then `npm start`. `PORT` is injected automatically.

### Persistent storage (recommended)
The container filesystem resets on every redeploy, so the default SQLite file is wiped.
To keep your pantry/list across deploys:
1. Add a **Volume** to the service, mount path e.g. `/data`.
2. Add variable `DB_PATH=/data/pantry.db`.

## Local dev
```
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
# http://localhost:3000
```

## Tests
```
npm test
```
Runs `node --test` — no framework, no dev dependencies.

The logic worth testing is the arithmetic: unit conversion, expiry day
boundaries, drawing down pantry batches oldest-first, matching item names,
recipe coverage, spend aggregation, and reminder timing. All of it lives in
`lib/`, which the server imports directly and the browser loads from `/lib`, so
there is one copy of each rule rather than one per side. That matters most for
`norm()` in `lib/units.js` — the browser uses it to decide whether a recipe shows
"✓ can make", and the server uses it to decide which batch to subtract when you
cook. If those two ever disagreed, nothing would break loudly.

`test/client.test.js` also checks that the inline `<script>` in `index.html`
parses, that everything it imports from `/lib` is really exported, and that the
service worker precaches those modules. The front end is one large inline script
with no build step, so a stray bracket would otherwise ship as a blank page.

## Cook & thaw reminders (optional)

The Plan tab already works out when to start cooking and when to pull something
out of the freezer. Turn these on and they arrive as phone notifications instead
of waiting for you to open the app.

1. Generate a keypair:
   ```
   npm run vapid
   ```
2. Add the three lines it prints to the service **Variables**
   (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
3. Redeploy, open the **Plan** tab, and tap **Turn on** next to "Cook & thaw
   reminders". You'll be asked to allow notifications.

Reminders fire per device, so turn them on wherever you want them. Times use the
timezone of whichever device most recently enabled them. Leave the variables
unset and the whole feature stays hidden — nothing else changes.

> Keep the keypair. Regenerating it invalidates every existing subscription, and
> everyone has to tap **Turn on** again.

## Scanning barcodes

On the Pantry tab, **🏷️ Barcode** takes a photo of a product barcode and looks it
up in [Open Food Facts](https://world.openfoodfacts.org). Browsers that support
`BarcodeDetector` (Chrome, Android) decode the photo on the phone for free;
everywhere else (iOS Safari) the photo goes to the server and the model reads the
digits printed under the bars. You can also tap **type a barcode number** and
enter it by hand.

The product name comes back branded ("Great Value 2% Reduced Fat Milk"), so it
gets rewritten to a plain name ("milk") that matches your recipe ingredients.

## Grocery spending

Prices are read off receipts along with the items, and you can correct any of
them before adding. **💵 Spending** at the bottom of the Pantry tab shows monthly
totals, your biggest-spend items, and per-item price changes — compared by unit
price, so buying two of something doesn't read as a price hike. Items with no
price are still added to the pantry; they just don't count toward spending.

## Install on your phone (PWA)

The app is a Progressive Web App — no app store needed.

**iPhone/iPad (Safari):** open your Railway URL, tap the Share button, then "Add to Home Screen."

**Android (Chrome):** open your Railway URL, tap the ⋮ menu, then "Install app" (or "Add to Home Screen").

It then launches full-screen from your home screen with its own icon. Your data lives on the server, so it's the same list across every device you install it on. Needs an internet connection to load and sync (the shell is cached for fast open, but the pantry/list data is always live from the server).

## Link fetching from protected sites (optional)

The app fetches recipe links directly by default. That works on most food blogs,
but big sites (allrecipes, NYT Cooking, etc.) block automated reads and will ask
you to paste the recipe instead. To make links work everywhere, add a scraper —
the app tries the free direct fetch first and only calls the scraper when a site
blocks it, so a paid/limited plan lasts a long time.

**Easiest — ScraperAPI** (free tier: 1,000 requests/month, no card required for
the free plan; a 7-day trial adds 5,000 one-time credits on top):
1. Sign up at https://www.scraperapi.com and copy your API key.
2. In Railway -> service -> Variables, add `SCRAPER_KEY=your_key`.

**Any other provider** (ScrapingBee, ChocoData, a self-hosted proxy, etc.):
set both variables, using a URL template with `{url}` and optional `{key}`:
```
SCRAPER_KEY=your_key
SCRAPER_URL=https://app.scrapingbee.com/api/v1/?api_key={key}&url={url}
```
The target URL is inserted automatically (URL-encoded). No code changes needed to
switch providers — just change the variables and redeploy.
