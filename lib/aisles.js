// Which part of the store an item is in, so the list can be walked in one pass
// instead of back and forth. Worked out on the phone from the item's name —
// free, instant, and it works with no signal, which is the point of a list you
// carry round a store. Anyone can move an item if this gets it wrong; the list
// remembers that choice (the row's `section`) over the guess.

// In walking order for a typical store: produce at the door, frozen near the end.
export const SECTIONS = [
  { key: "produce", label: "Produce", icon: "🥬" },
  { key: "bakery", label: "Bakery", icon: "🍞" },
  { key: "meat", label: "Meat & seafood", icon: "🥩" },
  { key: "dairy", label: "Dairy & eggs", icon: "🧀" },
  { key: "pantry", label: "Pantry & canned", icon: "🥫" },
  { key: "baking", label: "Baking & spices", icon: "🧂" },
  { key: "snacks", label: "Snacks & sweets", icon: "🍪" },
  { key: "drinks", label: "Drinks", icon: "🧃" },
  { key: "frozen", label: "Frozen", icon: "🧊" },
  { key: "household", label: "Household", icon: "🧻" },
  { key: "other", label: "Other", icon: "🛒" },
];
const KEYS = new Set(SECTIONS.map((s) => s.key));
export const isSection = (k) => KEYS.has(k);

// Checked in order and the first hit wins, so the rules that override a
// later, broader one come first: "frozen peas" is frozen, not produce;
// "ground beef" is meat though "ground cumin" is a spice;
// "garlic powder" is a spice, not produce; "chicken broth" is a can on a
// shelf, not meat; "peanut butter" is pantry, not dairy.
const RULES = [
  ["frozen", ["frozen", "ice cream", "popsicle", "gelato", "sorbet", "ice pop", "tater tot", "fish stick", "ice"]],
  // Names that a broader word below would put in the wrong place.
  ["snacks", ["tortilla chip", "potato chip", "pita chip"]],
  ["produce", ["bell pepper", "green bean", "sweet potato", "cherry tomato", "garlic clove", "cloves garlic",
    "clove garlic", "clove of garlic", "fresh herb", "fresh ginger", "chili pepper"]],
  ["meat", ["ground beef", "ground turkey", "ground pork", "ground chicken", "ground lamb", "ground meat",
    "chicken breast", "chicken thigh"]],
  ["bakery", ["tortilla", "pie crust"]],
  ["drinks", ["juice", "coconut water"]],
  ["baking", ["powder", "ground", "dried", "flour", "sugar", "baking soda", "yeast", "vanilla", "extract",
    "cornstarch", "cocoa", "chocolate chip", "sprinkle", "salt", "pepper", "peppercorn", "cinnamon", "nutmeg",
    "paprika", "cumin", "oregano", "thyme", "rosemary", "bay leaf", "chili flake", "red pepper flake",
    "seasoning", "spice", "clove", "cardamom", "turmeric", "curry", "molasses", "food coloring", "gelatin",
    "cream of tartar", "shortening"]],
  ["pantry", ["canned", "can of", "broth", "stock", "bouillon", "sauce", "paste", "puree", "pasta", "spaghetti",
    "noodle", "macaroni", "penne", "lasagna", "rice", "quinoa", "couscous", "oat", "cereal", "bean", "lentil",
    "chickpea", "peanut butter", "jam", "jelly", "honey", "syrup", "oil", "vinegar", "mustard", "ketchup",
    "mayo", "mayonnaise", "salsa", "soy", "hoisin", "sriracha", "tahini", "nut butter", "coconut milk",
    "tuna", "sardine", "soup", "dressing", "pickle", "olive", "capers", "breadcrumb", "panko", "crouton",
    "taco shell", "evaporated milk", "condensed milk", "nut", "almond", "walnut", "pecan",
    "cashew", "peanut", "raisin", "dried fruit", "seed"]],
  ["produce", ["apple", "banana", "orange", "lemon", "lime", "grape", "berry", "berries", "strawberr",
    "blueberr", "raspberr", "melon", "watermelon", "peach", "pear", "plum", "cherr", "mango", "pineapple",
    "kiwi", "avocado", "tomato", "potato", "sweet potato", "onion", "shallot", "garlic", "ginger", "carrot",
    "celery", "lettuce", "spinach", "kale", "arugula", "cabbage", "broccoli", "cauliflower", "zucchini",
    "squash", "cucumber", "bell pepper", "jalapeno", "jalapeño", "chili", "mushroom", "corn", "pea",
    "green bean", "asparagus", "eggplant", "radish", "beet", "leek", "scallion", "green onion", "herb",
    "parsley", "cilantro", "basil", "mint", "dill", "chive", "salad", "sprout", "fruit", "vegetable", "veggie"]],
  ["meat", ["chicken", "beef", "pork", "turkey", "lamb", "veal", "bacon", "sausage", "ham", "steak",
    "ground meat", "mince", "brisket", "rib", "chop", "fillet", "filet", "salmon", "cod", "tilapia", "shrimp",
    "prawn", "fish", "crab", "lobster", "scallop", "mussel", "clam", "meatball", "hot dog", "pepperoni",
    "salami", "prosciutto", "chorizo", "deli meat", "tofu", "tempeh"]],
  ["dairy", ["milk", "cream", "butter", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "ricotta",
    "yogurt", "yoghurt", "egg", "sour cream", "half and half", "half & half", "creamer", "cottage", "ghee",
    "margarine", "kefir", "custard", "whipped topping"]],
  ["bakery", ["bread", "bun", "roll", "bagel", "baguette", "croissant", "muffin", "tortilla", "pita",
    "naan", "brioche", "loaf", "english muffin", "biscuit", "cake", "pie crust", "donut", "doughnut"]],
  ["snacks", ["chip", "cracker", "cookie", "candy", "chocolate", "popcorn", "pretzel", "granola bar",
    "snack", "gum", "marshmallow"]],
  ["drinks", ["juice", "soda", "water", "coffee", "tea", "beer", "wine", "kombucha", "lemonade", "sparkling",
    "seltzer", "cola"]],
  ["household", ["paper towel", "toilet paper", "tissue", "napkin", "foil", "plastic wrap", "cling film",
    "parchment", "trash bag", "bin bag", "zip bag", "ziploc", "detergent", "dish soap", "sponge", "soap",
    "shampoo", "toothpaste", "bleach", "cleaner", "battery", "batteries", "diaper", "wipes"]],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Each word matches whole, with an optional plural ("pea" must not catch
// "peanut", nor "ice" catch "rice"). A few stems ("berr", "cherr") are meant to
// run into the rest of the word, so they're left open at the end.
const STEMS = new Set(["strawberr", "blueberr", "raspberr", "cherr", "berr"]);
const WHOLE = RULES.map(([key, words]) => [key, words.map((w) => STEMS.has(w)
  ? new RegExp(`(^|[^a-z])${escapeRe(w)}`, "i")
  : new RegExp(`(^|[^a-z])${escapeRe(w)}(s|es)?($|[^a-z])`, "i"))]);

export function guessSection(name) {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return "other";
  for (const [key, res] of WHOLE) if (res.some((re) => re.test(n))) return key;
  return "other";
}

// The section an item is shown under: the one someone chose, else the guess.
export const sectionOf = (item) => (item && isSection(item.section) ? item.section : guessSection(item && item.name));

// Group list rows into sections, in walking order, dropping empty ones. Rows
// keep their order within a section.
export function groupBySection(items) {
  const by = new Map(SECTIONS.map((s) => [s.key, []]));
  for (const it of items) by.get(sectionOf(it)).push(it);
  return SECTIONS.filter((s) => by.get(s.key).length).map((s) => ({ ...s, items: by.get(s.key) }));
}
