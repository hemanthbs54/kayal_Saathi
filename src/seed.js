// Illustrative sample reports at real Alappuzha locations, so the map is not empty on first run.
// These are demo data, not real incidents (flagged with source: 'sample').
import { PLACES } from './places.js';

const S = [
  ['Punnamada', 'ml-IN', 'പുന്നമട ഫിനിഷിങ് പോയിന്റിന് അടുത്ത് പ്ലാസ്റ്റിക് കുപ്പികൾ കൂടിക്കിടക്കുന്നു', 'Plastic bottles are piling up near Punnamada finishing point', 'Plastic bottles piling up at Punnamada', 'waste', 3, 'open', 2],
  ['Kainakary', 'ml-IN', 'കൈനകരിയിൽ വെള്ളം വീടുകളിലേക്ക് കയറാൻ തുടങ്ങി, റോഡ് മുങ്ങി', 'In Kainakary water has started entering houses, the road is submerged', 'Water entering homes in Kainakary', 'flood', 5, 'open', 1],
  ['Champakulam', 'ml-IN', 'ചമ്പക്കുളം തോട്ടിൽ പോള നിറഞ്ഞ് വള്ളം പോകാൻ പറ്റുന്നില്ല', 'Champakulam canal is full of water hyacinth, boats cannot pass', 'Water hyacinth blocking Champakulam canal', 'blocked_canal', 3, 'open', 20],
  ['Pallathuruthy', 'ml-IN', 'പള്ളാത്തുരുത്തിയിൽ ഹൗസ്ബോട്ടിൽ നിന്ന് മലിനജലം കായലിലേക്ക് ഒഴുക്കുന്നു', 'At Pallathuruthy a houseboat is discharging sewage into the backwater', 'Houseboat discharging sewage at Pallathuruthy', 'water_quality', 4, 'open', 6],
  ['Nedumudi', 'ml-IN', 'നെടുമുടിയിൽ മീൻ ചത്തു പൊങ്ങുന്നു, ദുർഗന്ധം ഉണ്ട്', 'Dead fish are floating up in Nedumudi and there is a bad smell', 'Dead fish floating in Nedumudi', 'water_quality', 4, 'open', 9],
  ['Kavalam', 'ml-IN', 'കാവാലം ഭാഗത്ത് വെള്ളം ഉയരുന്നു, പാടത്തെ ബണ്ട് ദുർബലമാണ്', 'Water is rising near Kavalam, the paddy field bund is weak', 'Rising water, weak bund at Kavalam', 'flood', 4, 'open', 3],
  ['Alappuzha Beach', 'ml-IN', 'ബീച്ചിൽ ഭക്ഷണ മാലിന്യം കൂട്ടിയിട്ടിരിക്കുന്നു', 'Food waste has been dumped on the beach', 'Food waste dumped on Alappuzha beach', 'waste', 2, 'open', 30],
  ['Vadai Canal', 'ml-IN', 'വാടക്കനാലിൽ മാലിന്യം കെട്ടിക്കിടക്കുന്നു, ഒഴുക്കില്ല', 'Garbage is stagnating in Vadai canal, there is no flow', 'Garbage stagnating in Vadai canal', 'blocked_canal', 3, 'open', 14],
  ['Mancombu', 'ml-IN', 'മങ്കൊമ്പിൽ റോഡിൽ മുട്ടോളം വെള്ളം, സ്കൂൾ കുട്ടികൾക്ക് പോകാൻ ബുദ്ധിമുട്ട്', 'Knee-deep water on the road at Mancombu, hard for school children to go', 'Knee-deep water on Mancombu road', 'flood', 4, 'open', 4],
  ['Pulinkunnu', 'hi-IN', 'पुलिंकुन्नु के पास नहर में बहुत कचरा है', 'There is a lot of garbage in the canal near Pulinkunnu', 'Garbage in canal near Pulinkunnu', 'waste', 2, 'open', 26],
  ['Thottappally', 'ml-IN', 'തോട്ടപ്പള്ളി സ്പിൽവേക്ക് സമീപം പ്ലാസ്റ്റിക് വലകൾ കുടുങ്ങി കിടക്കുന്നു', 'Plastic nets are stuck near Thottappally spillway', 'Plastic nets stuck at Thottappally spillway', 'waste', 3, 'in_progress', 40],
  ['Mannancherry', 'ml-IN', 'മണ്ണഞ്ചേരിയിൽ കാന അടഞ്ഞു, മഴവെള്ളം റോഡിൽ', 'Drain blocked at Mannancherry, rainwater on the road', 'Blocked drain flooding Mannancherry road', 'blocked_canal', 3, 'open', 11],
  ['Ramankary', 'ml-IN', 'രാമങ്കരിയിൽ കുടിവെള്ളത്തിന് നിറവ്യത്യാസം', 'Drinking water in Ramankary has changed colour', 'Discoloured drinking water in Ramankary', 'water_quality', 4, 'open', 7],
  ['Pathiramanal', 'en-IN', 'Saw an oil sheen on the water near Pathiramanal island jetty', 'Saw an oil sheen on the water near Pathiramanal island jetty', 'Oil sheen near Pathiramanal jetty', 'water_quality', 3, 'open', 18],
  ['Alappuzha Boat Jetty', 'ml-IN', 'ബോട്ട് ജെട്ടിക്ക് സമീപം പോള കൂടി ബോട്ടുകൾ കുടുങ്ങുന്നു', 'Water hyacinth is building up near the boat jetty and boats are getting stuck', 'Hyacinth trapping boats at the jetty', 'blocked_canal', 3, 'in_progress', 22],
  ['Kainakary', 'hi-IN', 'कैनकरी में घरों में पानी घुस रहा है, बच्चों को निकालना पड़ेगा', 'Water is entering houses in Kainakary, children will have to be evacuated', 'Homes flooding in Kainakary', 'flood', 5, 'open', 2],
  ['Kainakary', 'ml-IN', 'കൈനകരി പാലത്തിന് അടുത്ത് റോഡ് മുഴുവൻ വെള്ളത്തിനടിയിൽ', 'The road near Kainakary bridge is completely under water', 'Road under water near Kainakary bridge', 'flood', 4, 'open', 3],
  ['Champakulam', 'ml-IN', 'ചമ്പക്കുളത്ത് പോള കാരണം ജലഗതാഗത ബോട്ട് നിർത്തി', 'Water transport boat service stopped at Champakulam because of water hyacinth', 'Ferry halted by hyacinth at Champakulam', 'blocked_canal', 4, 'open', 16],
  ['Kidangara', 'ml-IN','കിടങ്ങറയിൽ വെള്ളക്കെട്ട് കുറഞ്ഞു തുടങ്ങി', 'Waterlogging in Kidangara has started to recede', 'Waterlogging receding in Kidangara', 'flood', 2, 'resolved', 50],
];

export function seedReports() {
  const now = Date.now();
  return S.map(([place, lang, transcript, english, title, category, severity, status, hoursAgo], i) => {
    const p = PLACES.find((x) => x.name === place);
    return {
      id: `sample-${i + 1}`,
      createdAt: new Date(now - hoursAgo * 36e5).toISOString(),
      lat: p.lat + ((i % 3) - 1) * 0.002,
      lng: p.lng + ((i % 2) - 0.5) * 0.003,
      place,
      lang,
      transcript,
      english,
      title,
      category,
      severity,
      status,
      photo: null,
      source: 'sample',
    };
  });
}
