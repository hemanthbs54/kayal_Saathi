// Small gazetteer of Alappuzha / Kuttanad places (approximate coordinates).
// Used to (a) boost speech recognition via keyterms and (b) place a pin when GPS is unavailable.
export const ALAPPUZHA_CENTER = { lat: 9.4981, lng: 76.3388 };

export const PLACES = [
  { name: 'Punnamada', hi: 'पुन्नमडा', ml: 'പുന്നമട', lat: 9.507, lng: 76.348, aliases: ['finishing point'] },
  { name: 'Alappuzha Boat Jetty', hi: 'आलप्पुझा बोट जेट्टी', ml: 'ബോട്ട് ജെട്ടി', lat: 9.497, lng: 76.339, aliases: ['boat jetty', 'jetty'] },
  { name: 'Alappuzha Beach', hi: 'आलप्पुझा बीच', ml: 'ബീച്ച്', lat: 9.493, lng: 76.317, aliases: ['beach'] },
  { name: 'Vadai Canal', hi: 'वाडई नहर', ml: 'വാടക്കനാൽ', lat: 9.499, lng: 76.333, aliases: ['vadakanal', 'commercial canal'] },
  { name: 'Pallathuruthy', hi: 'पल्लातुरुत्ती', ml: 'പള്ളാത്തുരുത്തി', lat: 9.465, lng: 76.372, aliases: [] },
  { name: 'Kainakary', hi: 'कैनकरी', ml: 'കൈനകരി', lat: 9.488, lng: 76.398, aliases: [] },
  { name: 'Champakulam', hi: 'चंपकुलम', ml: 'ചമ്പക്കുളം', lat: 9.411, lng: 76.413, aliases: [] },
  { name: 'Nedumudi', hi: 'नेडुमुडी', ml: 'നെടുമുടി', lat: 9.437, lng: 76.406, aliases: [] },
  { name: 'Kavalam', hi: 'कावालम', ml: 'കാവാലം', lat: 9.454, lng: 76.443, aliases: [] },
  { name: 'Pulinkunnu', hi: 'पुलिंकुन्नु', ml: 'പുളിങ്കുന്ന്', lat: 9.444, lng: 76.429, aliases: [] },
  { name: 'Mancombu', hi: 'मनकोम्बु', ml: 'മങ്കൊമ്പ്', lat: 9.428, lng: 76.431, aliases: [] },
  { name: 'Ramankary', hi: 'रामनकरी', ml: 'രാമങ്കരി', lat: 9.409, lng: 76.459, aliases: ['ramankari'] },
  { name: 'Kidangara', hi: 'किडंगरा', ml: 'കിടങ്ങറ', lat: 9.43, lng: 76.48, aliases: [] },
  { name: 'Thottappally', hi: 'तोट्टप्पल्ली', ml: 'തോട്ടപ്പള്ളി', lat: 9.315, lng: 76.385, aliases: ['spillway'] },
  { name: 'Pathiramanal', hi: 'पातिरामणल', ml: 'പാതിരാമണൽ', lat: 9.62, lng: 76.388, aliases: [] },
  { name: 'Mannancherry', hi: 'मण्णंचेरी', ml: 'മണ്ണഞ്ചേരി', lat: 9.554, lng: 76.346, aliases: [] },
  { name: 'Kuttanad', hi: 'कुट्टनाड', ml: 'കുട്ടനാട്', lat: 9.42, lng: 76.43, aliases: [] },
  { name: 'Vembanad Lake', hi: 'वेम्बनाड झील', ml: 'വേമ്പനാട്', lat: 9.58, lng: 76.37, aliases: ['vembanad'] },
];

// Areas scored by the flood-risk engine. Terrain drives vulnerability:
// most of Kuttanad is farmed below mean sea level behind earthen bunds, so it floods first.
export const TERRAIN = {
  below_sea_level: { vuln: 1.0, en: 'Below sea level (Kuttanad)', ml: 'സമുദ്രനിരപ്പിന് താഴെ' },
  low_lying: { vuln: 0.7, en: 'Low-lying backwater shore', ml: 'താഴ്ന്ന കായൽത്തീരം' },
  coastal: { vuln: 0.6, en: 'Coastal / spillway', ml: 'തീരപ്രദേശം' },
};

export const RISK_AREAS = [
  { name: 'Alappuzha Town', ml: 'ആലപ്പുഴ നഗരം', hi: 'आलप्पुझा शहर', lat: 9.4981, lng: 76.3388, terrain: 'low_lying' },
  { name: 'Punnamada', terrain: 'low_lying' },
  { name: 'Pallathuruthy', terrain: 'low_lying' },
  { name: 'Mannancherry', terrain: 'low_lying' },
  { name: 'Kainakary', terrain: 'below_sea_level' },
  { name: 'Champakulam', terrain: 'below_sea_level' },
  { name: 'Nedumudi', terrain: 'below_sea_level' },
  { name: 'Kavalam', terrain: 'below_sea_level' },
  { name: 'Pulinkunnu', terrain: 'below_sea_level' },
  { name: 'Mancombu', terrain: 'below_sea_level' },
  { name: 'Ramankary', terrain: 'below_sea_level' },
  { name: 'Kidangara', terrain: 'below_sea_level' },
  { name: 'Thottappally', terrain: 'coastal' },
].map((a) => ({ ...PLACES.find((p) => p.name === a.name), ...a }));

export function distanceKm(lat1, lng1, lat2, lng2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// English + Malayalam spellings: Saaras returns Malayalam script, so both help recognition.
export const KEYTERMS = ['Alappuzha', 'ആലപ്പുഴ', ...PLACES.flatMap((p) => [p.name, p.ml])].slice(0, 50);

function editDistance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Tolerate speech-recognition misspellings like "Manancherry" or "Nedumudy" (Latin script words). */
function fuzzyPlace(t) {
  const words = t.match(/[a-z]{5,}/g) || [];
  let best = null;
  for (const p of PLACES) {
    const name = p.name.toLowerCase().split(' ')[0];
    if (name.length < 6) continue;
    for (const w of words) {
      const d = editDistance(w, name);
      if (d <= Math.floor(name.length / 4) && (!best || d < best.d)) best = { p, d };
    }
  }
  return best?.p || null;
}

export function matchPlace(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  // Exact names first (so "Pathiramanal jetty" doesn't match the generic "jetty" alias), then aliases, then fuzzy.
  return (
    PLACES.find((p) => t.includes(p.name.toLowerCase()) || t.includes(p.ml)) ||
    PLACES.find((p) => p.aliases.some((a) => t.includes(a))) ||
    fuzzyPlace(t) ||
    null
  );
}

/** Replace English place names with their native-script spelling so translation keeps them recognisable. */
export function nativePlaceNames(text, lang) {
  const key = lang === 'ml-IN' ? 'ml' : lang === 'hi-IN' ? 'hi' : null;
  if (!key) return text;
  const all = [...RISK_AREAS, ...PLACES].filter((p) => p[key]).sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const p of all) out = out.split(p.name).join(p[key]);
  return out;
}

/**
 * Translation-safe place names: swap known places for {{P1}}-style tokens (which Sarvam Translate keeps
 * intact), translate, then put back the correct native spelling. Without this, the translator respells
 * village names ("Kainakary" -> "കനകക്കര"), and residents may not recognise their own village in an alert.
 */
export function protectPlaces(text) {
  const all = [...RISK_AREAS, ...PLACES].sort((a, b) => b.name.length - a.name.length);
  const used = [];
  let out = text;
  for (const p of all) {
    if (!out.includes(p.name)) continue;
    used.push(p);
    out = out.split(p.name).join(`{{P${used.length}}}`);
  }
  const restore = (translated, lang) => {
    const key = lang === 'ml-IN' ? 'ml' : lang === 'hi-IN' ? 'hi' : 'name';
    let r = translated;
    used.forEach((p, i) => { r = r.split(`{{P${i + 1}}}`).join(p[key] || p.name); });
    return r;
  };
  const intact = (translated) => used.every((_, i) => translated.includes(`{{P${i + 1}}}`));
  return { text: out, restore, intact, count: used.length };
}
