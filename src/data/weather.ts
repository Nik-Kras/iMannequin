// Weather hint (F13, D25, D35). Off by default. When the user switches it on, Settings stores a location rounded to
// 0.1° (about 10 km), and this module asks Open-Meteo for today's forecast at most once a day. It is the only
// request that carries anything about the user (R1).
import { useEffect, useState } from 'react';
import { useSettings, todayISO } from './repo';
import { useI18n, type Key } from '../i18n';

export interface WeatherHint { tempC: number; code: number; summary: string }

interface Cached { date: string; lat: number; lon: number; tempC: number; code: number }

const CACHE_KEY = 'imannequin.weather';

/** Rounds a coordinate to 0.1° (about 11 km of latitude), so the exact position never leaves the phone. */
export const roundCoord = (x: number): number => Math.round(x * 10) / 10;

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: roundCoord(lat).toFixed(1),
    longitude: roundCoord(lon).toFixed(1),
    daily: 'weather_code,temperature_2m_max',
    timezone: 'auto',
    forecast_days: '1',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'showers' | 'snow' | 'storm';

/** WMO weather code (Open-Meteo) → a short kind. */
export function weatherKind(code: number): WeatherKind {
  if (code <= 0) return 'clear';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}
function writeCache(c: Cached): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* private mode: fetch again tomorrow */ }
}

let inflight: { key: string; p: Promise<Cached | null> } | null = null;

/** Today's forecast for the rounded location, from the per-day cache or one request. */
export function loadForecast(lat: number, lon: number, today = todayISO()): Promise<Cached | null> {
  const la = roundCoord(lat);
  const lo = roundCoord(lon);
  const c = readCache();
  if (c && c.date === today && c.lat === la && c.lon === lo) return Promise.resolve(c);
  const key = `${today}:${la}:${lo}`;
  if (inflight?.key === key) return inflight.p;
  const p = fetch(forecastUrl(la, lo), { credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { daily?: { weather_code?: number[]; temperature_2m_max?: number[] } } | null) => {
      const code = j?.daily?.weather_code?.[0];
      const t = j?.daily?.temperature_2m_max?.[0];
      if (typeof code !== 'number' || typeof t !== 'number') return null;
      const v: Cached = { date: today, lat: la, lon: lo, tempC: Math.round(t), code };
      writeCache(v);
      return v;
    })
    .catch(() => null)
    .finally(() => { if (inflight?.key === key) inflight = null; });
  inflight = { key, p };
  return p;
}

/** Asks for the phone's location once and returns it rounded to 0.1°. Rejects if the user says no. */
export function requestRoundedLocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('unavailable')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: roundCoord(pos.coords.latitude), lon: roundCoord(pos.coords.longitude) }),
      (err) => reject(err),
      { enableHighAccuracy: false, maximumAge: 3_600_000, timeout: 20_000 },
    );
  });
}

/**
 * Today's weather (the day's high and its weather code), or null when the hint is off, the location is missing or
 * the phone is offline. The summary is in the app's language ("Rain" / "Дощ").
 */
export function useWeather(): WeatherHint | null {
  const settings = useSettings();
  const { t } = useI18n();
  const w = settings?.weather;
  const on = !!w?.enabled && typeof w.lat === 'number' && typeof w.lon === 'number';
  const [data, setData] = useState<Cached | null>(null);
  useEffect(() => {
    if (!on || w?.lat === undefined || w?.lon === undefined) { setData(null); return; }
    let live = true;
    void loadForecast(w.lat, w.lon).then((v) => { if (live) setData(v); });
    return () => { live = false; };
  }, [on, w?.lat, w?.lon]);
  if (!on || !data) return null;
  return { tempC: data.tempC, code: data.code, summary: t(`settings.wx.${weatherKind(data.code)}` as Key) };
}
