// Turning a model-generated week plan into something safe to write down.
//
// The model is asked to pick from recipes the user has actually saved, but it
// can still hallucinate an id, land a meal outside the week, or invent a time.
// Nothing here trusts it: every meal is checked against the real recipe list and
// the real week before it can become a database row.

// The seven 'YYYY-MM-DD' days of the week beginning at weekStart.
export function weekDates(weekStart) {
  const [y, m, d] = String(weekStart || "").split("-").map(Number);
  if (![y, m, d].every(Number.isFinite)) return [];
  const out = [];
  for (let i = 0; i < 7; i++) {
    // Built in UTC so the arithmetic can't be shifted by the server's timezone.
    const day = new Date(Date.UTC(y, m - 1, d + i));
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));

// Cooking a double batch is worth doing; cooking a sextuple one is a freezer
// full of the same curry. Four nights is as far as this will go.
export const MAX_BATCH = 4;

// How many nights one cook covers. A batch of 3 means the night it's cooked
// plus two of leftovers.
export function batchSize(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_BATCH);
}

// Validate a proposal against what actually exists.
// Returns the meals worth keeping plus a plain-language note for each one
// dropped, so the UI can say why a day came back empty instead of silently
// showing six days.
//
// A day is either COOKED — with `servings` nights' worth made at once — or a
// LEFTOVER night eating an earlier cook's spare portions. A leftover has to
// point at a real cook night, earlier in the same week, for the same recipe,
// that actually made enough: "Thursday: leftovers of Saturday's roast" is a
// hungry Thursday, and a batch of one has nothing spare. Items are checked in
// date order for that reason, whatever order they arrived in.
export function normalizeProposal(raw, { recipes, weekStart, defaultTime = "18:00" }) {
  const days = weekDates(weekStart);
  const byId = new Map(recipes.map((r) => [String(r.id), r]));
  const meals = [];
  const dropped = [];
  const taken = new Set();
  // recipe id -> the cook night for it, and how many spare nights it has left.
  const cooked = new Map();

  const items = (Array.isArray(raw && raw.days) ? raw.days : [])
    .map((item, i) => ({ item, i }))
    // Sorted by date, ties in the order they arrived, so a leftover is never
    // judged before the cook night it depends on has been seen.
    .sort((a, b) => String((a.item && (a.item.d || a.item.date)) || "")
      .localeCompare(String((b.item && (b.item.d || b.item.date)) || "")) || a.i - b.i)
    .map((x) => x.item);

  for (const item of items) {
    const date = String((item && (item.d || item.date)) || "");
    const id = String((item && (item.r ?? item.recipe_id)) ?? "");
    const recipe = byId.get(id);
    const wantsLeftover = String((item && (item.k || item.kind)) || "") === "leftover";

    if (!days.includes(date)) { dropped.push(`${date || "(no date)"}: not in this week`); continue; }
    if (!recipe) { dropped.push(`${date}: recipe ${id || "(none)"} doesn't exist`); continue; }
    if (taken.has(date)) { dropped.push(`${date}: more than one meal proposed`); continue; }

    const time = isTime(item.t || item.meal_time) ? (item.t || item.meal_time) : defaultTime;
    const why = String((item && item.why) || "").slice(0, 200);
    const meal = { date, meal_time: time, recipe_id: recipe.id, title: recipe.title, why };

    if (wantsLeftover) {
      const source = cooked.get(String(recipe.id));
      if (!source) {
        dropped.push(`${date}: leftovers of ${recipe.title}, which isn't cooked earlier this week`);
        continue;
      }
      if (source.spare <= 0) {
        dropped.push(`${date}: leftovers of ${recipe.title}, but only ${source.servings} night(s) were cooked`);
        continue;
      }
      source.spare--;
      taken.add(date);
      meals.push({ ...meal, kind: "leftover", servings: 1, cook_date: source.date });
      continue;
    }

    const servings = batchSize(item.b ?? item.batch ?? item.servings);
    taken.add(date);
    // A second cook of the same recipe replaces the first as the source of
    // leftovers — spare portions come from the most recent pot.
    cooked.set(String(recipe.id), { date, servings, spare: servings - 1 });
    meals.push({ ...meal, kind: "cook", servings, cook_date: "" });
  }

  meals.sort((a, b) => a.date.localeCompare(b.date));
  return { meals, dropped, empty: days.filter((d) => !taken.has(d)) };
}

// The recipes a plan actually cooks, scaled to the batch each night makes.
//
// Leftover nights contribute nothing: their food was bought for the cook night.
// Counting them would buy the ingredients twice, which is exactly the mistake
// the shopping list exists to avoid.
export function cookedRecipes(meals, recipes) {
  const byId = new Map(recipes.map((r) => [String(r.id), r]));
  const out = [];
  for (const m of meals) {
    if (m.kind === "leftover") continue;
    const r = byId.get(String(m.recipe_id));
    if (!r) continue;
    const batch = batchSize(m.servings);
    out.push({
      title: r.title,
      ingredients: (r.ingredients || []).map((i) => ({ ...i, use_base: (Number(i.use_base) || 0) * batch })),
    });
  }
  return out;
}

// Nutrition and time totals for a proposed week, for the summary strip.
// Recipes without stored nutrition just don't contribute — the count of how
// many did is returned so the figure can be labelled honestly.
//
// Leftover nights are counted as meals and as calories — you do eat them — but
// not as cooking time, and a bigger batch doesn't multiply the time either. A
// double batch of chilli is one pot and a bigger onion; treating it as two
// evenings of cooking would hide the thing that makes it worth doing.
export function summarizePlan(meals, recipes) {
  const byId = new Map(recipes.map((r) => [String(r.id), r]));
  let calories = 0, protein = 0, minutes = 0, withNutrition = 0, cookNights = 0;
  for (const m of meals) {
    const r = byId.get(String(m.recipe_id));
    if (!r) continue;
    if (m.kind !== "leftover") {
      minutes += (r.prep_min || 0) + (r.cook_min || 0);
      cookNights++;
    }
    const n = r.nutrition;
    if (n && (n.calories || n.protein)) {
      calories += Number(n.calories) || 0;
      protein += Number(n.protein) || 0;
      withNutrition++;
    }
  }
  return {
    meals: meals.length,
    cookNights,
    leftoverNights: meals.length - cookNights,
    minutes,
    withNutrition,
    caloriesPerDay: withNutrition ? Math.round(calories / withNutrition) : null,
    proteinPerDay: withNutrition ? Math.round(protein / withNutrition) : null,
  };
}
