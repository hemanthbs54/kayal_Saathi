// Small gazetteer of Alappuzha / Kuttanad places (approximate coordinates).
// Used to (a) boost speech recognition via keyterms and (b) place a pin when GPS is unavailable.
export const ALAPPUZHA_CENTER = { lat: 9.4981, lng: 76.3388 };

export const PLACES = [
  { name: 'Punnamada', ml: 'പുന്നമട', lat: 9.507, lng: 76.348, aliases: ['finishing point'] },
  { name: 'Alappuzha Boat Jetty', ml: 'ബോട്ട് ജെട്ടി', lat: 9.497, lng: 76.339, aliases: ['boat jetty', 'jetty'] },
  { name: 'Alappuzha Beach', ml: 'ബീച്ച്', lat: 9.493, lng: 76.317, aliases: ['beach'] },
  { name: 'Vadai Canal', ml: 'വാടക്കനാൽ', lat: 9.499, lng: 76.333, aliases: ['vadakanal', 'commercial canal'] },
  { name: 'Pallathuruthy', ml: 'പള്ളാത്തുരുത്തി', lat: 9.465, lng: 76.372, aliases: [] },
  { name: 'Kainakary', ml: 'കൈനകരി', lat: 9.488, lng: 76.398, aliases: [] },
  { name: 'Champakulam', ml: 'ചമ്പക്കുളം', lat: 9.411, lng: 76.413, aliases: [] },
  { name: 'Nedumudi', ml: 'നെടുമുടി', lat: 9.437, lng: 76.406, aliases: [] },
  { name: 'Kavalam', ml: 'കാവാലം', lat: 9.454, lng: 76.443, aliases: [] },
  { name: 'Pulinkunnu', ml: 'പുളിങ്കുന്ന്', lat: 9.444, lng: 76.429, aliases: [] },
  { name: 'Mancombu', ml: 'മങ്കൊമ്പ്', lat: 9.428, lng: 76.431, aliases: [] },
  { name: 'Ramankary', ml: 'രാമങ്കരി', lat: 9.409, lng: 76.459, aliases: ['ramankari'] },
  { name: 'Kidangara', ml: 'കിടങ്ങറ', lat: 9.43, lng: 76.48, aliases: [] },
  { name: 'Thottappally', ml: 'തോട്ടപ്പള്ളി', lat: 9.315, lng: 76.385, aliases: ['spillway'] },
  { name: 'Pathiramanal', ml: 'പാതിരാമണൽ', lat: 9.62, lng: 76.388, aliases: [] },
  { name: 'Mannancherry', ml: 'മണ്ണഞ്ചേരി', lat: 9.554, lng: 76.346, aliases: [] },
  { name: 'Kuttanad', ml: 'കുട്ടനാട്', lat: 9.42, lng: 76.43, aliases: [] },
  { name: 'Vembanad Lake', ml: 'വേമ്പനാട്', lat: 9.58, lng: 76.37, aliases: ['vembanad'] },
];

export const KEYTERMS = ['Alappuzha', ...PLACES.map((p) => p.name)];

export function matchPlace(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  // Exact names first (so "Pathiramanal jetty" doesn't match the generic "jetty" alias), then aliases.
  return (
    PLACES.find((p) => t.includes(p.name.toLowerCase()) || t.includes(p.ml)) ||
    PLACES.find((p) => p.aliases.some((a) => t.includes(a))) ||
    null
  );
}
