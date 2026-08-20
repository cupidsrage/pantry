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
recipe coverage, spend aggregation, reminder timing, reading durations out of
recipe steps, interleaving several recipes into one cooking schedule, deciding
what's about to go off and what to cook with it, checking a leftover night
against the pot it claims to come from, and merging a restored backup into an
account that isn't empty. All of
it lives in `lib/`, which the server imports directly and the browser loads from
`/lib`, so there is one copy of each rule rather than one per side. That matters
most for `norm()` in `lib/units.js` — the browser uses it to decide whether a
recipe shows "✓ can make", and the server uses it to decide which batch to
subtract when you cook. If those two ever disagreed, nothing would break loudly.
The same goes for `lib/durations.js`: the countdown a step offers you and the
minutes the cook-along schedule reserves for it are the same number by
construction, so a timer can't disagree with the plan it came from.

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

## Cook once, eat twice

A pot of chilli that feeds four is barely more work than one that feeds two, and
the second night is free. The plan knows that now.

Any night on the **Plan** tab can be cooked in a batch — pick a recipe and say
how many nights it's for, up to four. The shopping list buys the ingredients
once, multiplied: a double batch is 400g of lentils on one line, not 200g twice.
A later night in the same week can then be marked as leftovers instead of a
meal, and it costs nothing — nothing to buy, nothing to cook, no "start cooking"
reminder, no thawing. The cook night says which nights it also feeds; the
leftover night says which pot it came from.

The offer only appears where it's real. A recipe that isn't cooked earlier in
the week has no leftovers to eat, and a batch that's already spoken for can't
stretch further, so the checkbox simply isn't there. Both the page and the
server check that — the server owns the plan, and another phone may have changed
the week since this one drew it.

**Plan my week** uses it too. It's told to batch the things worth batching —
stews, braises, roasts, big grains — and to spend the leftovers on the nights
your constraints say are short on time, since a leftover night beats even the
fastest recipe when it takes no time at all. Things that don't reheat well are
left alone. The review panel then reports the honest number: *5 nights at the
stove for 7 dinners*.

The rules live in `normalizeProposal()` and `cookedRecipes()` in
`lib/planner.js`, so a hallucinated leftover night — one whose meal is never
cooked, or is cooked afterwards, or was only ever a single portion — is dropped
with a reason before it can become a row.

## Cook together

Cooking two dishes is not twice one dish — the hard part is the interleaving,
and doing it in your head is what makes it stressful. On the **Saved** tab,
**🍳 Cook several recipes at once** takes the dishes you're making and gives you
one timeline instead of three.

Pick the recipes (and how many servings of each), say when you want to eat — or
start now and be told when dinner lands — and you get a single ordered list of
what to do when: *6:23 preheat the oven, 6:29 parboil the potatoes, 6:39 chop the
onion for the curry.* Tick steps off as you go; the "now" line moves down the
list on its own.

**From the Plan tab**, any night with two or more meals on it gets a
**🍳 Cook these together** button, which hands the whole evening to the scheduler
without asking you to pick the same recipes again. The serve time comes from the
meals themselves — if they were planned for different times it aims at the
earliest and says so, and if the mealtime has already gone by it starts from now
instead. Tapping a dish's name in the timeline opens its full recipe, at the
servings the session is cooking, and leaves a **Resume** banner to come back to.

What the schedule is actually doing:

- **It works backwards from dinner**, so every dish finishes at the same moment
  rather than one going cold while the other cooks.
- **There is one cook.** Two steps that need your hands never overlap. Steps that
  cook without you — anything that bakes, simmers, rests, chills, proofs — are
  allowed to overlap freely, and that's where the time comes from.
- **Food that has to be made early says so.** When two dishes want your hands at
  once, one goes first, and its step reads "holds 6m" rather than silently
  pretending it comes out at serving time.
- **Two dishes wanting the oven at different temperatures** is the one clash it
  can't fix by moving things around, so it's flagged with the window where they
  collide instead of being quietly planned.

Above the timeline is everything the whole session needs, totalled across the
dishes with each one's servings applied — so the onion gets chopped once, and
you find out before you start that there isn't enough of it. Finishing subtracts
every dish's ingredients from the pantry in one go.

Timers are per step and several run at once, because two pots are on the clock
at once. The session survives a reload — a phone locks itself halfway through
dinner — and stepping out to look something up leaves a **Resume** banner on the
Saved tab.

Step times come from the steps themselves ("simmer 25 minutes"). Steps that don't
name a time share out whatever is left of the recipe's own prep+cook estimate, so
a recipe that says 35 minutes still adds up to about 35. Nothing here calls the
model — it's arithmetic, in `lib/cookalong.js`, and it's the most-tested file in
the project for that reason.

If you fall behind, **Push dinner later** moves the whole schedule rather than
leaving every remaining step marked late.

## One copy of each recipe

A recipe book fills up with the same dish twice more easily than it sounds: Save
gets double-tapped, a link that was imported in March gets imported again in
August, or something typed in by hand turns out to already be there. Saving
checks the book first and stops rather than filing a second copy.

Two recipes are the same one when either their titles match — ignoring case,
punctuation, accents and a leading "the" — or they came from the same page,
which is compared with the protocol, `www.`, trailing slash, `#anchor` and
campaign parameters stripped, so a link shared from Pinterest matches the same
link typed in plainly. A matching URL counts even when the titles differ, since
sites rename recipes.

Two different dishes really can share a name, so nothing is ever refused
outright: the save is held and you're offered the recipe you already have, or
**Save it anyway** to keep both. The parsed recipe card also says "Already saved
as…" next to the Save button, so most of the time the question never comes up.
Sharing a recipe to someone who already has it is skipped rather than copied,
and the sender is told.

The matching itself is `findDuplicateRecipe()` in `lib/recipes.js`, which both
sides run — the server to refuse the insert, the page to warn before you press
Save — so the warning and the refusal can't disagree.

## Reminders (optional)

The Plan tab already works out when to start cooking and when to pull something
out of the freezer. Turn these on and they arrive as phone notifications instead
of waiting for you to open the app.

Three kinds arrive: **start cooking**, **take something out to thaw**, and a
once-a-day **use it up** digest (see below) at 9am local time.

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

## Use it up

Food goes off in the back of a fridge because nothing ever mentions it. The
**Pantry** tab now leads with whatever is about to turn — what it is, how long
is left, and which of your saved recipes would use it up tonight. Tap one and it
opens.

If you've turned reminders on, the same thing arrives once a day at 9am, wherever
you are: *spinach — 2d left · you could make Spinach Soup tonight*.

Three things keep it from becoming noise:

- **It only speaks when there's something to say.** Nothing expiring, no strip
  and no notification.
- **It ignores food the week already accounts for.** If Thursday's dinner uses
  the chicken, that decision has been made, and being reminded of it is how a
  reminder becomes something you swipe away without reading.
- **It only promises what the pantry can deliver.** A recipe you could cook
  tonight is offered as tonight's dinner; one that needs a shop is offered as an
  idea.

Just-expired stock is still mentioned for a day — it may well be fine, and it's
the last moment to look — but last month's is not. The window is three days
ahead, which is far enough to plan a meal around and near enough to matter.

The strip and the notification both come from `expiryDigest()` in
`lib/waste.js`, so what the page says and what your phone says can't disagree.

## Backing up your data

All of this lives in one SQLite file on one server's disk. **⬇ Download a
backup** at the bottom of the Pantry tab writes the lot to a JSON file you keep
— every recipe, your pantry, the list, the plan, and your price history — in
readable JSON rather than a database dump.

**⬆ Restore** reads one back. It says what it would do before it does anything,
and it only ever adds: a recipe already in the book is left alone, stock isn't
doubled, and history isn't duplicated. Restoring the same file twice changes
nothing the second time, which means restoring into an account that's half
re-typed does the sensible thing rather than leaving you with two of everything.
Recipes are matched the same way the Save button matches them, and a restored
meal is re-linked to its recipe by title, since ids from another database mean
nothing here.

The matching rules are `planRestore()` in `lib/backup.js`, and they're tested
against a full round trip.

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
