export type GeoHit = {
	name: string;
	admin1?: string;
	country?: string;
	latitude: number;
	longitude: number;
};

export type MeteoSnapshot = {
	latitude: number;
	longitude: number;
	timezone: string;
	updated: string;
	temperatureC: number;
	weatherCode: number;
	cloudCover: number;
	isDay: boolean;
	windDir10: number;
	altitudes: {
		wind10: number;
		wind80: number;
		wind120: number;
		gust10: number;
	};
	hourly: {
		time: string[];
		wind10: number[];
		wind80: number[];
		wind120: number[];
		gust10: number[];
	};
	daily: {
		time: string[];
		sunrise: string[];
		sunset: string[];
	};
};

function currentHourIndex(times: string[]) {
	const now = Date.now();
	let idx = 0;
	for (let i = 0; i < times.length; i++) {
		if (new Date(times[i]).getTime() <= now) idx = i;
		else break;
	}
	return idx;
}

export async function searchPlaces(query: string): Promise<GeoHit[]> {
	const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
	url.searchParams.set("name", query);
	url.searchParams.set("count", "6");
	url.searchParams.set("language", "en");
	url.searchParams.set("format", "json");
	const res = await fetch(url);
	if (!res.ok) throw new Error("Place search failed.");
	const data = await res.json();
	return (data.results ?? []) as GeoHit[];
}

function coordLabel(lat: number, lon: number) {
	return `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
}

export async function reversePlace(lat: number, lon: number): Promise<string> {
	try {
		const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
		url.searchParams.set("latitude", String(lat));
		url.searchParams.set("longitude", String(lon));
		url.searchParams.set("localityLanguage", "en");
		const res = await fetch(url);
		if (res.ok) {
			const data = await res.json();
			const label = [
				data.city || data.locality || data.localityInfo?.informative?.[0]?.name,
				data.principalSubdivision,
				data.countryName,
			]
				.filter(Boolean)
				.join(", ");
			if (label) return label;
		}
	} catch {
		// Fall through to coordinates.
	}
	return coordLabel(lat, lon);
}

export async function fetchMeteo(lat: number, lon: number): Promise<MeteoSnapshot> {
	const url = new URL("https://api.open-meteo.com/v1/forecast");
	url.searchParams.set("latitude", lat.toFixed(4));
	url.searchParams.set("longitude", lon.toFixed(4));
	url.searchParams.set(
		"current",
		"temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,is_day",
	);
	url.searchParams.set(
		"hourly",
		"wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_gusts_10m",
	);
	url.searchParams.set("daily", "sunrise,sunset");
	url.searchParams.set("forecast_days", "3");
	url.searchParams.set("wind_speed_unit", "ms");
	url.searchParams.set("timezone", "auto");

	const res = await fetch(url);
	if (!res.ok) throw new Error("Wind data request failed.");
	const data = await res.json();
	const times: string[] = data.hourly.time;
	const i = currentHourIndex(times);

	return {
		latitude: data.latitude,
		longitude: data.longitude,
		timezone: data.timezone,
		updated: data.current.time,
		temperatureC: data.current.temperature_2m,
		weatherCode: data.current.weather_code,
		cloudCover: data.current.cloud_cover,
		isDay: Boolean(data.current.is_day),
		windDir10: data.current.wind_direction_10m,
		altitudes: {
			wind10: data.hourly.wind_speed_10m[i],
			wind80: data.hourly.wind_speed_80m[i],
			wind120: data.hourly.wind_speed_120m[i],
			gust10: data.hourly.wind_gusts_10m[i],
		},
		hourly: {
			time: times,
			wind10: data.hourly.wind_speed_10m,
			wind80: data.hourly.wind_speed_80m,
			wind120: data.hourly.wind_speed_120m,
			gust10: data.hourly.wind_gusts_10m,
		},
		daily: {
			time: data.daily.time,
			sunrise: data.daily.sunrise,
			sunset: data.daily.sunset,
		},
	};
}

export function compass(deg: number) {
	const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
	return dirs[Math.round(deg / 45) % 8];
}

export function placeLabel(hit: GeoHit) {
	return [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ");
}
