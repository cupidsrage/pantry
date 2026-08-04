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

## Plan my week

On the **Plan** tab, once you have at least three saved recipes, **✨ Plan my
week** builds the whole week in one go.

It reads your pantry (ordered by what expires soonest), your saved recipes with
their times and nutrition, what you've eaten in the last three weeks, and what
you've paid for things before. You can set a budget, a weeknight time limit, a
number of vegetarian nights, nights off, and free-text notes ("no fish, kids eat
early Wednesday") — or leave it all blank and let it decide.

You get a proposal, not a fait accompli: seven days with a one-line reason for
each pick, the week's cooking time and calories, an estimated shop cost from your
own price history, and the list of what you'd need to buy. Accept it and it
writes the meal plan, adds exactly the missing ingredients to your grocery list,
and the existing cook and thaw reminders pick it up automatically.

Two things worth knowing:

- **It only picks from recipes you've saved.** It won't invent meals.
- **Nothing the model returns is trusted.** Every suggestion is checked against
  your real recipe ids and the real week before it can become a row —
  hallucinated recipes, duplicate days, and invented times are dropped, and the
  review panel tells you how many were skipped.

Shopping quantities are totalled across the whole week *before* pantry stock is
subtracted. Adding recipes to the list one at a time doesn't do that, so 500g of
chicken appears to cover both Monday and Thursday and you come home short.

This is the one feature that runs on Sonnet rather than Haiku — it's weighing
expiry against variety against time against budget, which is reasoning rather
than extraction. It runs about once a week, so the difference is negligible.

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

## Theme

The app ships in **Dracula**: near-black under a flickering candlelit glow,
blood crimson, candle-lit violet, cobwebs in the top corners, film grain over
everything, and blood running off a small-caps serif title. The tabs and the
copy change with it — the pantry is the **Cellar**, saved recipes are the
**Grimoire**, the list is the **Hunt**, the week is **Nights**, and parsing a
recipe bleeds it.

The 🦇 button beside the title switches to **Daylight**: the original palette
*and* the original wording, unchanged. The choice is remembered per device in
`localStorage` (nothing is stored server-side, so each phone/browser picks its
own).

Two mechanisms, both in `public/index.html`:

- **Colour** goes through CSS custom properties, and a theme is one block of
  values — `:root` holds Dracula, `:root[data-theme="daylight"]` holds the
  original. The atmosphere (drips, cobwebs, grain, glow, button glow) is in
  there too, as image tokens the daylight block sets to `none`, so it costs
  nothing to turn off. Animation is skipped under `prefers-reduced-motion`.
- **Copy** goes through `G(gothic, plain)`, which picks a voice based on the
  current theme. Any string that should change with the theme is wrapped in it.

To retint the app, change the token values; to add a third theme, copy a block
and give it a new `data-theme` name.

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
