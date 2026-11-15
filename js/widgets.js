// Desktop widgets: big clock, local weather (Open-Meteo) and system stats.
import { h } from './ui.js';
import { getLocal, setLocal } from './store.js';

const START = performance.now();

// ---------------------------------------------------------------- clock
export function mountClock(timeEl, dateEl, { seconds = false, dateFmt = 'long' } = {}) {
  const tick = () => {
    const d = new Date();
    timeEl.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }).replace(/\s?[ap]\.?m\.?$/i, (m) => (dateFmt === 'big' ? '' : m));
    if (dateEl) {
      dateEl.textContent = dateFmt === 'short'
        ? d.toLocaleDateString([], { day: 'numeric', month: 'short' })
        : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    }
  };
  tick();
  const t = setInterval(tick, 1000);
  return () => clearInterval(t);
}

// ---------------------------------------------------------------- weather
const WMO = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Cloudy'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'], 51: ['🌦️', 'Drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌦️', 'Drizzle'],
  56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'], 61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'],
  65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'], 71: ['🌨️', 'Light snow'],
  73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'], 80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'],
  82: ['⛈️', 'Heavy showers'], 85: ['🌨️', 'Snow showers'], 86: ['🌨️', 'Snow showers'], 95: ['⛈️', 'Thunderstorm'],
  96: ['⛈️', 'Thunderstorm'], 99: ['⛈️', 'Thunderstorm'],
};
const useF = () => /^en-US$/i.test(navigator.language);

async function fetchWeather(lat, lon) {
  const unit = useF() ? '&temperature_unit=fahrenheit' : '';
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1${unit}`);
  if (!r.ok) throw new Error('weather');
  const j = await r.json();
  let place = '';
  try {
    const g = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`).then((x) => x.json());
    place = g.city || g.locality || g.principalSubdivision || '';
  } catch {}
  return {
    temp: Math.round(j.current.temperature_2m),
    code: j.current.weather_code,
    hi: Math.round(j.daily.temperature_2m_max[0]),
    lo: Math.round(j.daily.temperature_2m_min[0]),
    place,
    at: Date.now(),
  };
}

export function mountWeather(el) {
  let alive = true;
  const show = (w) => {
    const [emoji, text] = WMO[w.code] || ['🌡️', ''];
    el.replaceChildren(
      h('div', { class: 'wx-main' }, h('span', { class: 'wx-icon' }, emoji), h('span', { class: 'wx-temp' }, `${w.temp}°`)),
      h('div', { class: 'wx-sub' }, [w.place, text, `H ${w.hi}° L ${w.lo}°`].filter(Boolean).join(' · ')));
  };
  const msg = (text, btn) => el.replaceChildren(h('div', { class: 'wx-sub' }, text), btn || '');

  const load = () => {
    if (!navigator.geolocation) return msg('Weather isn’t available in this browser.');
    msg('Finding your location…');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      setLocal('weather.allowed', true);
      try {
        const w = await fetchWeather(pos.coords.latitude.toFixed(2), pos.coords.longitude.toFixed(2));
        setLocal('weather.cache', w);
        if (alive) show(w);
      } catch {
        if (alive) msg('Couldn’t load the weather.', h('button', { class: 'wx-btn', onClick: load }, 'Try again'));
      }
    }, () => {
      setLocal('weather.allowed', false);
      if (alive) msg('Location is off.', h('button', { class: 'wx-btn', onClick: load }, 'Allow location'));
    }, { timeout: 15000, maximumAge: 30 * 60 * 1000 });
  };

  const cached = getLocal('weather.cache', null);
  if (cached) show(cached);
  if (getLocal('weather.allowed', false)) {
    if (!cached || Date.now() - cached.at > 20 * 60 * 1000) load();
  } else if (!cached) {
    msg('Show the weather where you are.', h('button', { class: 'wx-btn', onClick: load }, 'Show weather'));
  }
  const t = setInterval(() => { if (getLocal('weather.allowed', false)) load(); }, 30 * 60 * 1000);
  return () => { alive = false; clearInterval(t); };
}

// ---------------------------------------------------------------- system
export function mountSystem(el) {
  const rows = {};
  const row = (key, label) => {
    const bar = h('i');
    const val = h('span', { class: 'sys-val' }, '…');
    rows[key] = { bar, val };
    return h('div', { class: 'sys-row' }, h('span', { class: 'sys-label' }, label), h('span', { class: 'sys-bar' }, bar), val);
  };
  el.replaceChildren(row('fps', 'FPS'), row('mem', 'Memory'), row('cpu', 'CPU'), row('bat', 'Battery'), row('net', 'Network'), row('up', 'Uptime'));
  const set = (k, text, pct) => {
    rows[k].val.textContent = text;
    rows[k].bar.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
  };

  // FPS
  let frames = 0;
  let raf = 0;
  const loop = () => { frames++; raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  // CPU busy-ness estimated from timer lag
  let lag = 0;
  let expected = performance.now() + 100;
  const lagT = setInterval(() => {
    const now = performance.now();
    lag = lag * 0.8 + Math.max(0, now - expected) * 0.2;
    expected = now + 100;
  }, 100);

  // Battery
  let battery = null;
  navigator.getBattery?.().then((b) => { battery = b; }).catch(() => {});

  let last = performance.now();
  const update = () => {
    const now = performance.now();
    const fps = Math.round((frames * 1000) / (now - last));
    frames = 0;
    last = now;
    set('fps', String(document.hidden ? 0 : fps), (fps / 60) * 100);

    const m = performance.memory;
    if (m) set('mem', `${Math.round(m.usedJSHeapSize / 1048576)} MB`, (m.usedJSHeapSize / m.jsHeapSizeLimit) * 100);
    else if (navigator.deviceMemory) set('mem', `${navigator.deviceMemory} GB`, 0);
    else set('mem', 'n/a', 0);

    const cores = navigator.hardwareConcurrency;
    const load = Math.round(Math.min(100, (lag / 50) * 100));
    set('cpu', `${cores ? `${cores} cores · ` : ''}${load}%`, load);

    if (battery) set('bat', `${Math.round(battery.level * 100)}%${battery.charging ? ' ⚡' : ''}`, battery.level * 100);
    else set('bat', 'n/a', 0);

    const c = navigator.connection;
    const online = navigator.onLine;
    set('net', online ? (c?.effectiveType ? `online · ${c.effectiveType}` : 'online') : 'offline', online ? (c?.downlink ? Math.min(100, c.downlink * 10) : 90) : 0);

    const s = Math.floor((now - START) / 1000);
    set('up', `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`, ((s % 60) / 60) * 100);
  };
  update();
  const t = setInterval(update, 1000);
  return () => { cancelAnimationFrame(raf); clearInterval(t); clearInterval(lagT); };
}
