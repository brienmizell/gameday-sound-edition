// Formatting helpers. No dependencies, no build step.

/** WMO weather codes (Open-Meteo) -> { label, icon }. Replaces Dark Sky's `icon` field. */
const WMO = {
	0: ['Clear', '☀️'],
	1: ['Mainly clear', '🌤️'],
	2: ['Partly cloudy', '⛅'],
	3: ['Overcast', '☁️'],
	45: ['Fog', '🌫️'],
	48: ['Rime fog', '🌫️'],
	51: ['Light drizzle', '🌦️'],
	53: ['Drizzle', '🌦️'],
	55: ['Heavy drizzle', '🌦️'],
	56: ['Freezing drizzle', '🌧️'],
	57: ['Freezing drizzle', '🌧️'],
	61: ['Light rain', '🌧️'],
	63: ['Rain', '🌧️'],
	65: ['Heavy rain', '🌧️'],
	66: ['Freezing rain', '🌧️'],
	67: ['Freezing rain', '🌧️'],
	71: ['Light snow', '🌨️'],
	73: ['Snow', '🌨️'],
	75: ['Heavy snow', '🌨️'],
	77: ['Snow grains', '🌨️'],
	80: ['Rain showers', '🌦️'],
	81: ['Rain showers', '🌦️'],
	82: ['Violent showers', '⛈️'],
	85: ['Snow showers', '🌨️'],
	86: ['Snow showers', '🌨️'],
	95: ['Thunderstorm', '⛈️'],
	96: ['Thunderstorm, hail', '⛈️'],
	99: ['Thunderstorm, hail', '⛈️'],
};

export function weatherLabel(code) {
	const hit = WMO[code];
	return hit ? { label: hit[0], icon: hit[1] } : { label: '—', icon: '·' };
}

/** Kickoff in the VIEWER's local zone, which the 2018 version never did. */
export function kickoff(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return { day: 'TBA', time: '', iso: '' };
	return {
		day: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
		time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
		iso: d.toISOString(),
	};
}

/** "in 3 days" / "in 2h" / "live" / "final". Null when it is not worth showing. */
export function countdown(iso, state) {
	if (state === 'post') return 'Final';
	if (state === 'in') return 'Live';
	const ms = new Date(iso).getTime() - Date.now();
	if (Number.isNaN(ms) || ms < 0) return null;
	const mins = Math.round(ms / 60000);
	if (mins < 60) return `in ${mins}m`;
	const hrs = Math.round(mins / 60);
	if (hrs < 48) return `in ${hrs}h`;
	return `in ${Math.round(hrs / 24)} days`;
}

export function temp(f) {
	return f == null ? '—' : `${Math.round(f)}°`;
}

/** Team colors arrive as bare hex with no '#'. Guard against missing/white. */
export function teamColor(hex, fallback = '#4a5568') {
	if (!hex) return fallback;
	const c = hex.startsWith('#') ? hex : `#${hex}`;
	return /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
}

/** Relative luminance, so text on a team-colored chip stays readable. */
export function readableOn(hex) {
	const c = teamColor(hex).slice(1);
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
	const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
	const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
	return L > 0.45 ? '#111418' : '#ffffff';
}

export function slug(s) {
	return String(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** yyyymmdd for the ESPN `dates` param. */
export function yyyymmdd(d) {
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
