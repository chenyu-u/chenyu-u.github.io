/* Live weather in Toronto, shared by the cover and the 3D world.

   One small request to Open-Meteo (free, no key, CORS-enabled) for the current conditions at the
   University of Toronto. The answer is cached in localStorage, so a reload or the next page renders
   instantly from the cache and refreshes quietly in the background. Every consumer starts from calm
   defaults and eases toward the live values, so a slow or failed request never shows as a jump or
   an error: the site simply looks the way it always has.

   window.__wx
     .data        null, or { speed, gust, dir, temp, code, isDay, cloud, time }   (km/h, degrees FROM, °C)
     .derived     { kind: null|'rain'|'snow', rate 0..1, overcast 0..1, fog 0..1, storm 0..1 }
     .on(fn)      fn(data, derived) now (if loaded) and on every update
     .line(form)  the conditions as text in the visitor's language; form 'head', 'cover' or 'opener'
*/
(function () {
  var LAT = 43.6629, LON = -79.3957;                       // King's College Circle
  var URL = 'https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LON +
    '&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,is_day,cloud_cover' +
    '&wind_speed_unit=kmh&timezone=America%2FToronto';
  var KEY = 'cl-wx', FRESH = 10 * 60e3, USABLE = 3 * 3600e3, TIMEOUT = 5000;
  var subs = [], inflight = false, fetchedAt = 0;

  var W = window.__wx = {
    data: null, derived: null,
    on: function (fn) { subs.push(fn); if (W.data) try { fn(W.data, W.derived); } catch (e) {} },
    line: line
  };

  // ── weather codes (WMO) → what the scene does ──────────────────
  function derive(d) {
    var c = d.code, kind = null, rate = 0, fog = 0, storm = 0;
    if (c >= 51 && c <= 57) { kind = 'rain'; rate = c === 51 || c === 56 ? .25 : c === 53 ? .35 : .45; }
    else if (c >= 61 && c <= 67) { kind = 'rain'; rate = c === 61 || c === 66 ? .45 : c === 63 ? .7 : 1; }
    else if (c >= 71 && c <= 77) { kind = 'snow'; rate = c === 71 ? .45 : c === 73 ? .7 : c === 77 ? .3 : 1; }
    else if (c >= 80 && c <= 82) { kind = 'rain'; rate = c === 80 ? .5 : c === 81 ? .75 : 1; }
    else if (c === 85 || c === 86) { kind = 'snow'; rate = c === 85 ? .55 : 1; }
    else if (c >= 95) { kind = 'rain'; rate = 1; storm = 1; }
    if (c === 45 || c === 48) fog = 1;
    var cloud = Math.max(0, Math.min(1, (d.cloud == null ? (c >= 3 ? 90 : c * 30) : d.cloud) / 100));
    return { kind: kind, rate: rate, fog: fog, storm: storm, overcast: Math.max(cloud, kind ? .8 : 0, fog) };
  }

  // ── text, in the visitor's language ────────────────────────────
  var T = {
    en: {
      dirs: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'],
      wind: function (s, d) { return 'wind ' + s + ' km/h from the ' + d; }, calm: 'calm air',
      head: 'Toronto right now', cover: function (w, t, c) { return cap(w) + ' · ' + t + ' · ' + c; },
      opener: function (w, t, c) { return 'Right now in Toronto: ' + t + ', ' + c + ', ' + w + '. The scene shows it.'; },
      codes: { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'rain showers', 81: 'rain showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail' }
    },
    zh: {
      dirs: ['北', '东北', '东', '东南', '南', '西南', '西', '西北'],
      wind: function (s, d) { return d + '风 ' + s + ' 公里/小时'; }, calm: '无风',
      head: '多伦多此刻', cover: function (w, t, c) { return w + ' · ' + t + ' · ' + c; },
      opener: function (w, t, c) { return '多伦多此刻：' + c + '，' + t + '，' + w + '。画面中的天气与之同步。'; },
      codes: { 0: '晴', 1: '大致晴朗', 2: '局部多云', 3: '阴', 45: '雾', 48: '冻雾', 51: '小毛毛雨', 53: '毛毛雨', 55: '较强毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪', 80: '阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪', 95: '雷暴', 96: '雷暴伴冰雹', 99: '雷暴伴冰雹' }
    },
    de: {
      dirs: ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'],
      wind: function (s, d) { return 'Wind aus ' + d + ' mit ' + s + ' km/h'; }, calm: 'windstill',
      head: 'Toronto gerade jetzt', cover: function (w, t, c) { return w + ' · ' + t + ' · ' + c; },
      opener: function (w, t, c) { return 'Gerade jetzt in Toronto: ' + t + ', ' + c + ', ' + w + '. Die Szene zeigt es.'; },
      codes: { 0: 'klar', 1: 'überwiegend klar', 2: 'teilweise bewölkt', 3: 'bedeckt', 45: 'Nebel', 48: 'gefrierender Nebel', 51: 'leichter Nieselregen', 53: 'Nieselregen', 55: 'starker Nieselregen', 56: 'gefrierender Nieselregen', 57: 'gefrierender Nieselregen', 61: 'leichter Regen', 63: 'Regen', 65: 'starker Regen', 66: 'gefrierender Regen', 67: 'gefrierender Regen', 71: 'leichter Schneefall', 73: 'Schneefall', 75: 'starker Schneefall', 77: 'Schneegriesel', 80: 'Regenschauer', 81: 'Regenschauer', 82: 'starke Schauer', 85: 'Schneeschauer', 86: 'starke Schneeschauer', 95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel' }
    }
  };
  function cap(x) { return x.charAt(0).toUpperCase() + x.slice(1); }
  function lang() { var l = window.CLPrefs && window.CLPrefs.lang; return T[l] ? l : 'en'; }
  function line(form) {
    var d = W.data; if (!d) return '';
    var L = T[lang()], s = Math.round(d.speed);
    var w = s < 2 ? L.calm : L.wind(s, L.dirs[Math.round(((d.dir % 360) + 360) % 360 / 45) % 8]);
    var t = Math.round(d.temp).toString().replace('-', '−') + ' °C';
    var c = L.codes[d.code] || L.codes[Math.floor(d.code / 10) * 10] || '';
    if (form === 'head') return L.head;
    return (form === 'opener' ? L.opener : L.cover)(w, t, c);
  }

  // ── fetch, cache, refresh ──────────────────────────────────────
  function publish(d, t) {
    if (!d || !isFinite(d.speed) || !isFinite(d.dir)) return;
    W.data = d; W.derived = derive(d); fetchedAt = t;
    subs.forEach(function (fn) { try { fn(W.data, W.derived); } catch (e) {} });
  }
  function load() {
    if (inflight || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    inflight = true;
    var ctl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    fetch(URL, ctl ? { signal: ctl.signal } : {}).then(function (r) { if (!r.ok) throw r.status; return r.json(); }).then(function (j) {
      var c = j && j.current; if (!c) return;
      var d = { speed: +c.wind_speed_10m, gust: +c.wind_gusts_10m || +c.wind_speed_10m, dir: +c.wind_direction_10m, temp: +c.temperature_2m,
        code: +c.weather_code || 0, isDay: c.is_day === 1, cloud: c.cloud_cover == null ? null : +c.cloud_cover, time: c.time };
      var now = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify({ t: now, d: d })); } catch (e) {}
      publish(d, now);
    }).catch(function () { /* stay on the cache or the calm defaults */ }).then(function () { clearTimeout(timer); inflight = false; });
  }
  try {
    var c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (c && c.d && Date.now() - c.t < USABLE) publish(c.d, c.t);
  } catch (e) {}
  if (Date.now() - fetchedAt > FRESH) load();
  // keep it current while someone is reading, without polling a background tab
  setInterval(function () { if (!document.hidden && Date.now() - fetchedAt > FRESH) load(); }, 60e3);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - fetchedAt > FRESH) load(); });
  addEventListener('online', load);
  // another tab or page fetched newer conditions: use them
  addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    try { var c = JSON.parse(e.newValue); if (c.t > fetchedAt) publish(c.d, c.t); } catch (er) {}
  });
  addEventListener('cl-langchange', function () { subs.forEach(function (fn) { try { fn(W.data, W.derived, 'lang'); } catch (e) {} }); });
})();
