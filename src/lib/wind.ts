import type { Drone } from "../data/drones";

export type Unit = "mph" | "kt" | "ms";
export type VerdictKind = "go" | "caution" | "nogo";

export const UNIT_LABEL: Record<Unit, string> = {
	mph: "mph",
	kt: "kt",
	ms: "m/s",
};

export function msTo(unit: Unit, ms: number) {
	if (unit === "mph") return ms * 2.236936;
	if (unit === "kt") return ms * 1.943844;
	return ms;
}

export function formatSpeed(unit: Unit, ms: number, digits = 1) {
	return `${msTo(unit, ms).toFixed(digits)} ${UNIT_LABEL[unit]}`;
}

export type AltitudeWind = {
	meters: 10 | 80 | 120;
	label: string;
	note: string;
	speedMs: number;
	gustMs: number;
};

export type Verdict = {
	kind: VerdictKind;
	title: string;
	reason: string;
	peakMs: number;
	limitMs: number;
	ratio: number;
	worstAltitude: AltitudeWind;
};

function gustAtAltitude(windAlt: number, wind10: number, gust10: number) {
	if (wind10 <= 0) return Math.max(windAlt, gust10);
	return windAlt * (gust10 / wind10);
}

export function buildAltitudes(
	wind10: number,
	wind80: number,
	wind120: number,
	gust10: number,
): AltitudeWind[] {
	return [
		{
			meters: 10,
			label: "10 m · surface",
			note: "Takeoff, landing, and low hover.",
			speedMs: wind10,
			gustMs: gust10,
		},
		{
			meters: 80,
			label: "80 m · cruise",
			note: "Typical mapping and cinematic height.",
			speedMs: wind80,
			gustMs: gustAtAltitude(wind80, wind10, gust10),
		},
		{
			meters: 120,
			label: "120 m · legal max",
			note: "US recreational ceiling (~400 ft AGL).",
			speedMs: wind120,
			gustMs: gustAtAltitude(wind120, wind10, gust10),
		},
	];
}

function peak(alt: AltitudeWind) {
	return Math.max(alt.speedMs, alt.gustMs);
}

export function judge(drone: Drone, altitudes: AltitudeWind[]): Verdict {
	const limitMs = drone.maxWindMs;
	const worst = altitudes.reduce((a, b) => (peak(b) > peak(a) ? b : a));
	const peakMs = peak(worst);
	const ratio = peakMs / limitMs;

	let kind: VerdictKind = "go";
	if (ratio >= 0.85 || peakMs >= limitMs) kind = "nogo";
	else if (ratio >= 0.65) kind = "caution";

	const titles: Record<VerdictKind, string> = {
		go: "Safe to fly",
		caution: "Fly with caution",
		nogo: "Do not fly",
	};

	const bufferPct = Math.max(0, Math.round((1 - ratio) * 100));
	const overPct = Math.round((ratio - 1) * 100);

	let reason: string;
	if (kind === "go") {
		reason = `Peak wind at ${worst.meters} m is ${peakMs.toFixed(1)} m/s. ${drone.name} is rated to ${limitMs} m/s, leaving about a ${bufferPct}% buffer. Gusts are inside the limit.`;
	} else if (kind === "caution") {
		reason = `Wind at ${worst.meters} m is ${peakMs.toFixed(1)} m/s versus a ${limitMs} m/s rating. That is only a ${bufferPct}% buffer. Keep the aircraft low, into the wind, and abort if gusts build.`;
	} else if (peakMs >= limitMs) {
		reason = `Wind or gusts at ${worst.meters} m reach ${peakMs.toFixed(1)} m/s, which is ${overPct >= 0 ? `${overPct}% over` : "at"} the ${drone.name} ${limitMs} m/s rating. Stay on the ground.`;
	} else {
		reason = `Wind at ${worst.meters} m is ${peakMs.toFixed(1)} m/s — inside the published number, but past our 15% safety buffer. Not worth the airframe.`;
	}

	return {
		kind,
		title: titles[kind],
		reason,
		peakMs,
		limitMs,
		ratio,
		worstAltitude: worst,
	};
}

export function fillRatio(speedMs: number, limitMs: number) {
	return Math.min(100, Math.round((speedMs / limitMs) * 100));
}
