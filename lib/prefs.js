// How the app looks and behaves, chosen on the Settings screen. Kept per phone
// (localStorage), since what suits a phone in the kitchen needn't suit a
// laptop. normalizePrefs() is the only way in: whatever is stored — an old
// version's settings, a hand-edited value, nothing at all — comes out as a
// complete, valid set, so a bad value can never break the page.

export const TABS = [
  { key: "recipe", icon: "📝", plain: "Recipe", gothic: "Recipe" },
  { key: "list", icon: "🛒", plain: "List", gothic: "Hunt" },
  { key: "pantry", icon: "🥫", plain: "Pantry", gothic: "Cellar" },
  { key: "saved", icon: "📖", plain: "Saved", gothic: "Grimoire" },
  { key: "plan", icon: "📅", plain: "Plan", gothic: "Nights" },
  { key: "public", icon: "🌍", plain: "Public", gothic: "Commons" },
];
const TAB_KEYS = TABS.map((t) => t.key);

// Accent colours, each tuned for both themes: `accent` fills buttons (white
// text on it), `ink` is the same colour legible as text on that theme's
// background, `soft` tints a ticked row.
export const ACCENTS = {
  default: { label: "Theme's own" },
  crimson: {
    label: "Crimson",
    dark: { accent: "#9d1226", hover: "#7d0d1e", ink: "#e8607f", soft: "#260f15", softBorder: "#6e1a2a", focus: "#e0405c" },
    light: { accent: "#be123c", hover: "#9f1239", ink: "#be123c", soft: "#fff1f2", softBorder: "#fecdd3", focus: "#fb7185" },
  },
  green: {
    label: "Green",
    dark: { accent: "#047857", hover: "#065f46", ink: "#34d399", soft: "#0b1f18", softBorder: "#14532d", focus: "#34d399" },
    light: { accent: "#047857", hover: "#065f46", ink: "#047857", soft: "#ecfdf5", softBorder: "#a7f3d0", focus: "#34d399" },
  },
  blue: {
    label: "Blue",
    dark: { accent: "#1d4ed8", hover: "#1e40af", ink: "#7aa2ff", soft: "#0f1730", softBorder: "#1e3a8a", focus: "#60a5fa" },
    light: { accent: "#2563eb", hover: "#1d4ed8", ink: "#1d4ed8", soft: "#eff6ff", softBorder: "#bfdbfe", focus: "#60a5fa" },
  },
  violet: {
    label: "Violet",
    dark: { accent: "#6d28d9", hover: "#5b21b6", ink: "#b49cff", soft: "#1a1330", softBorder: "#4c1d95", focus: "#a78bfa" },
    light: { accent: "#7c3aed", hover: "#6d28d9", ink: "#6d28d9", soft: "#f5f3ff", softBorder: "#ddd6fe", focus: "#a78bfa" },
  },
  orange: {
    label: "Orange",
    dark: { accent: "#c2410c", hover: "#9a3412", ink: "#fb923c", soft: "#24140b", softBorder: "#7c2d12", focus: "#fb923c" },
    light: { accent: "#c2410c", hover: "#9a3412", ink: "#c2410c", soft: "#fff7ed", softBorder: "#fed7aa", focus: "#fb923c" },
  },
  pink: {
    label: "Pink",
    dark: { accent: "#be185d", hover: "#9d174d", ink: "#f472b6", soft: "#2a0f1d", softBorder: "#831843", focus: "#f472b6" },
    light: { accent: "#db2777", hover: "#be185d", ink: "#be185d", soft: "#fdf2f8", softBorder: "#fbcfe8", focus: "#f472b6" },
  },
};

export const TEXT_SIZES = { s: 0.9, m: 1, l: 1.12, xl: 1.25 };

const CHOICES = {
  theme: ["dark", "light", "auto"],
  accent: Object.keys(ACCENTS),
  textSize: Object.keys(TEXT_SIZES),
  density: ["comfortable", "compact"],
  wording: ["gothic", "plain"],
  tabsAt: ["bottom", "top"],
  startTab: ["last", ...TAB_KEYS],
};
const FLAGS = ["bigButtons", "decorations", "confirmDelete", "vibrate", "groupSections", "checkedToBottom", "walmartLinks", "reduceMotion"];

export function defaultPrefs(oldTheme) {
  // Before Settings existed there was one switch: "dracula" (dark, gothic
  // words) or "daylight" (light, plain words). Carry that choice over.
  const daylight = oldTheme === "daylight";
  return {
    theme: daylight ? "light" : "dark",
    accent: "default",
    textSize: "m",
    density: "comfortable",
    wording: daylight ? "plain" : "gothic",
    decorations: true,
    reduceMotion: false,
    bigButtons: false,
    tabsAt: "bottom",
    tabs: TAB_KEYS.map((key) => ({ key, show: true })),
    startTab: "last",
    confirmDelete: false,
    vibrate: true,
    groupSections: true,
    checkedToBottom: false,
    walmartLinks: true,
  };
}

export function normalizePrefs(raw, oldTheme) {
  const out = defaultPrefs(oldTheme);
  if (!raw || typeof raw !== "object") return out;
  for (const [k, allowed] of Object.entries(CHOICES)) if (allowed.includes(raw[k])) out[k] = raw[k];
  for (const k of FLAGS) if (typeof raw[k] === "boolean") out[k] = raw[k];
  if (Array.isArray(raw.tabs)) {
    // Keep the stored order for known tabs, once each; add any tab a newer
    // version introduced at the end.
    const seen = new Set();
    const tabs = [];
    for (const t of raw.tabs) {
      if (t && TAB_KEYS.includes(t.key) && !seen.has(t.key)) { seen.add(t.key); tabs.push({ key: t.key, show: t.show !== false }); }
    }
    for (const key of TAB_KEYS) if (!seen.has(key)) tabs.push({ key, show: true });
    // A page you can't get to is no use: always leave at least one tab showing.
    if (!tabs.some((t) => t.show)) tabs[0].show = true;
    out.tabs = tabs;
  }
  // Opening on a hidden tab would show a page with no tab lit up.
  if (out.startTab !== "last" && !out.tabs.find((t) => t.key === out.startTab).show) out.startTab = "last";
  return out;
}

// The tabs to show, in order.
export const visibleTabs = (prefs) => prefs.tabs.filter((t) => t.show).map((t) => TABS.find((x) => x.key === t.key));

// Which theme is actually in use: "auto" follows the phone.
export const effectiveTheme = (prefs, phonePrefersDark) =>
  prefs.theme === "auto" ? (phonePrefersDark ? "dark" : "light") : prefs.theme;

// The accent colours to apply, or null for the theme's own.
export function accentColors(prefs, theme) {
  const a = ACCENTS[prefs.accent];
  return a && a[theme] ? a[theme] : null;
}

// Move a tab up (-1) or down (+1) in the order. Returns new prefs.
export function moveTab(prefs, key, dir) {
  const tabs = prefs.tabs.slice();
  const i = tabs.findIndex((t) => t.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= tabs.length) return prefs;
  [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
  return { ...prefs, tabs };
}

// Show or hide a tab. The last one showing can't be hidden.
export function toggleTab(prefs, key) {
  const tabs = prefs.tabs.map((t) => (t.key === key ? { ...t, show: !t.show } : t));
  if (!tabs.some((t) => t.show)) return prefs;
  return normalizePrefs({ ...prefs, tabs });
}
