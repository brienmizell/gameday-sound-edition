// Weather. Open-Meteo replaces Dark Sky (Apple shut Dark Sky down in 2023)
// and Open-Meteo's own geocoder replaces the Google Geocode hop.
// Both are keyless and CORS-open, so the three-legged 2018 chain
//     stadium name -> Google Geocode -> lat/lng -> Dark Sky
// becomes two legs with nothing to leak.
//
// Two real bugs from 2018 are fixed here:
//   1. `daily.data[4]` — the old code always read the 5th day of a rolling
//      forecast, whatever day the game was. We match the game's actual date.
//   2. Silent wrongness — a forecast past the model horizon was displayed as
//      if it were real. We return a reason instead.

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

/** Open-Meteo's public forecast horizon. Past this there is no honest number. */
export const FORECAST_DAYS = 16;

const memo = new Map();

function cacheGet(key) {
	if (memo.has(key)) return memo.get(key);
	try {
		const raw = localStorage.getItem(`gd:geo:${key}`);
		if (raw) {
			const v = JSON.parse(raw);
			memo.set(key, v);
			return v;
		}
	} catch {
		/* private mode, or storage full — fall through to the network */
	}
	return null;
}

function cacheSet(key, value) {
	memo.set(key, value);
	try {
		localStorage.setItem(`gd:geo:${key}`, JSON.stringify(value));
	} catch {
		/* non-fatal */
	}
}

/** city + state -> {lat, lon}. Cached forever; stadiums do not move. */
export async function geocode(city, state) {
	if (!city) return null;
	const key = `${city}|${state}`.toLowerCase();
	const hit = cacheGet(key);
	if (hit) return hit;

	const url = `${GEO}?name=${encodeURIComponent(city)}&count=10&language=en&format=json`;
	let data;
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		data = await res.json();
	} catch {
		return null;
	}

	const results = data.results ?? [];
	if (!results.length) return null;

	// Prefer the US hit in the right state — "Athens" and "Columbia" are
	// exactly the ambiguity that makes a bare city lookup wrong.
	const pick =
		results.find((r) => r.country_code === 'US' && (r.admin1_code === state || abbr(r.admin1) === state)) ??
		results.find((r) => r.country_code === 'US') ??
		results[0];

	const out = { lat: pick.latitude, lon: pick.longitude, resolved: `${pick.name}, ${pick.admin1 ?? ''}` };
	cacheSet(key, out);
	return out;
}

const STATES = {
	Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
	Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
	Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
	Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
	Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
	'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
	'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
	Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
	Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
	'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
};
const abbr = (name) => STATES[name] ?? name;

/**
 * Forecast for one game. Always returns an object with a `status`, never throws.
 *   ok       — a real forecast for the game's own date
 *   indoor   — dome; weather is not a factor and we say so
 *   horizon  — the game is past the model's reach
 *   unknown  — we could not place the venue
 */
export async function forecastFor(game) {
	if (game.venue.indoor) return { status: 'indoor' };

	const kickoff = new Date(game.date);
	if (Number.isNaN(kickoff.getTime())) return { status: 'unknown', reason: 'no kickoff time' };

	const days = Math.ceil((kickoff - Date.now()) / 86400000);
	if (days > FORECAST_DAYS) {
		// Beyond the model's reach there is no forecast — but what that stadium
		// is USUALLY like on that date is knowable, and more use than silence.
		const n = await normalFor(game, kickoff);
		return n ? { status: 'normal', days, ...n } : { status: 'horizon', days };
	}
	if (days < -1) return { status: 'past' };

	const place = await geocode(game.venue.city, game.venue.state);
	if (!place) return { status: 'unknown', reason: 'venue not located' };

	const target = localDay(kickoff);
	const url =
		`${FORECAST}?latitude=${place.lat}&longitude=${place.lon}` +
		'&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,wind_speed_10m_max' +
		`&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=${FORECAST_DAYS}`;

	let d;
	try {
		const res = await fetch(url);
		if (!res.ok) return { status: 'unknown', reason: `weather ${res.status}` };
		d = await res.json();
	} catch {
		return { status: 'unknown', reason: 'weather unreachable' };
	}

	// Match the GAME's day. The 2018 code read index 4 no matter what.
	const i = (d.daily?.time ?? []).indexOf(target);
	if (i === -1) return { status: 'horizon', days };

	return {
		status: 'ok',
		high: d.daily.temperature_2m_max[i],
		low: d.daily.temperature_2m_min[i],
		precip: d.daily.precipitation_probability_max[i],
		wind: d.daily.wind_speed_10m_max[i],
		code: d.daily.weathercode[i],
		place: place.resolved,
	};
}

function localDay(d) {
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- climate normals ----------
//
// Built at build time by tools/build-normals.py from ten years of Open-Meteo
// archive observations. Optional: with no file, a distant game just says the
// forecast is not open yet, exactly as before.

let normalsPromise = null;

function loadNormals() {
	if (!normalsPromise) {
		normalsPromise = fetch('data/normals.json')
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => new Map(Object.entries(d?.venues ?? {})))
			.catch(() => new Map());
	}
	return normalsPromise;
}

async function normalFor(game, kickoff) {
	if (!game.venue.id) return null;
	const venues = await loadNormals();
	const v = venues.get(String(game.venue.id));
	if (!v) return null;
	const p = (n) => String(n).padStart(2, '0');
	const day = v.days?.[`${p(kickoff.getMonth() + 1)}-${p(kickoff.getDate())}`];
	return day ? { high: day.high, low: day.low, rain: day.rain, years: day.n, place: v.name } : null;
}
