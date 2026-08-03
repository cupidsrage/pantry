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

// Validate a proposal against what actually exists.
// Returns the meals worth keeping plus a plain-language note for each one
// dropped, so the UI can say why a day came back empty instead of silently
// showing six days.
export function normalizeProposal(raw, { recipes, weekStart, defaultTime = "18:00" }) {
  const days = weekDates(weekStart);
  const byId = new Map(recipes.map((r) => [String(r.id), r]));
  const meals = [];
  const dropped = [];
  const taken = new Set();

  for (const item of (Array.isArray(raw && raw.days) ? raw.days : [])) {
    const date = String((item && (item.d || item.date)) || "");
    const id = String((item && (item.r ?? item.recipe_id)) ?? "");
    const recipe = byId.get(id);

    if (!days.includes(date)) { dropped.push(`${date || "(no date)"}: not in this week`); continue; }
    if (!recipe) { dropped.push(`${date}: recipe ${id || "(none)"} doesn't exist`); continue; }
    if (taken.has(date)) { dropped.push(`${date}: more than one meal proposed`); continue; }

    const time = isTime(item.t || item.meal_time) ? (item.t || item.meal_time) : defaultTime;
    taken.add(date);
    meals.push({
      date, meal_time: time, recipe_id: recipe.id, title: recipe.title,
      why: String((item && item.why) || "").slice(0, 200),
    });
  }

  meals.sort((a, b) => a.date.localeCompare(b.date));
  return { meals, dropped, empty: days.filter((d) => !taken.has(d)) };
}

// Nutrition and time totals for a proposed week, for the summary strip.
// Recipes without stored nutrition just don't contribute — the count of how
// many did is returned so the figure can be labelled honestly.
export function summarizePlan(meals, recipes) {
  const byId = new Map(recipes.map((r) => [String(r.id), r]));
  let calories = 0, protein = 0, minutes = 0, withNutrition = 0;
  for (const m of meals) {
    const r = byId.get(String(m.recipe_id));
    if (!r) continue;
    minutes += (r.prep_min || 0) + (r.cook_min || 0);
    const n = r.nutrition;
    if (n && (n.calories || n.protein)) {
      calories += Number(n.calories) || 0;
      protein += Number(n.protein) || 0;
      withNutrition++;
    }
  }
  return {
    meals: meals.length,
    minutes,
    withNutrition,
    caloriesPerDay: withNutrition ? Math.round(calories / withNutrition) : null,
    proteinPerDay: withNutrition ? Math.round(protein / withNutrition) : null,
  };
}
