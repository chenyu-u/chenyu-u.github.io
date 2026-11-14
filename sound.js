/* ═══════════════════════════════════════════════════════════════════
   sound.js · the soundtrack for index.html
   ─────────────────────────────────────────────────────────────────
   Four recordings in audio/ (rendered offline, see the README note):
     score.mp3   64 s loop: strings and plucked harp in a large hall
     wind.mp3    30 s loop: gusting wind, louder while the camera moves
     water.mp3   20 s loop: waves, near the lake, the Atlantic and canals
     whoosh.mp3  plays once with the entry transition
   Sound starts with the click on Enter (browsers only allow audio after
   a click). The speaker button in the top bar turns it off or on, and
   the choice is remembered (localStorage cl-sound).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var S = window.__story, btn = document.getElementById('sound');
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !btn) { if (btn) btn.style.display = 'none'; return; }

  var WATER = { rockies: .1, calgary: .05, 'calgary-lawn': 0, toronto: .45, campus: .05, turbine: .05, research: .05, lake: .9, delft: .55, 'delft-stand': .3, horizon: 1, 'horizon-high': .8 };
  var ctx = null, master, bufs = {}, beds = {}, on = false, bedsOn = false;
  var pref = 'on';
  try { pref = localStorage.getItem('cl-sound') || 'on'; } catch (e) {}

  function ensure() {
    if (ctx) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = .02; comp.release.value = .3;
    master.connect(comp); comp.connect(ctx.destination);
  }
  function load(name) {
    if (bufs[name]) return Promise.resolve(bufs[name]);
    ensure();
    return fetch('audio/' + name + '.mp3').then(function (r) { return r.arrayBuffer(); })
      .then(function (a) { return new Promise(function (res, rej) { ctx.decodeAudioData(a, res, rej); }); })
      .then(function (b) { bufs[name] = b; return b; });
  }
  function bed(name, gain) {
    var src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = bufs[name]; src.loop = true; g.gain.value = 0;
    src.connect(g); g.connect(master); src.start();
    g.gain.setTargetAtTime(gain, ctx.currentTime, 2.2);
    return g;
  }
  function startBeds() {
    if (bedsOn) return; bedsOn = true;
    Promise.all([load('score'), load('wind'), load('water')]).then(function () {
      beds.score = bed('score', .5); beds.wind = bed('wind', .14); beds.water = bed('water', 0);
    }).catch(function () { bedsOn = false; });
  }
  function setOn(v, fade) {
    on = v;
    try { localStorage.setItem('cl-sound', v ? 'on' : 'off'); } catch (e) {}
    btn.setAttribute('aria-pressed', String(v));
    btn.setAttribute('aria-label', v ? 'Turn sound off' : 'Turn sound on');
    if (!v && !ctx) return;
    ensure();
    if (v) { ctx.resume(); startBeds(); }
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, fade || (v ? .6 : .2));
  }

  // called by the cover when the visitor clicks Enter
  window.__sound = {
    enter: function () {
      if (pref === 'off') { btn.setAttribute('aria-pressed', 'false'); return; }
      ensure(); ctx.resume();
      setOn(true, .05);
      var play = function () { var s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = bufs.whoosh; g.gain.value = .9; s.connect(g); g.connect(master); s.start(); };
      if (bufs.whoosh) play(); else load('whoosh').then(play).catch(function () {});
    }
  };
  btn.addEventListener('click', function () { setOn(!on); });
  btn.setAttribute('aria-pressed', 'false');

  // Unless sound was switched off on an earlier visit: fetch the whoosh straight away (it's small), and
  // the longer beds once the 3D world is ready, so they are decoded before the click on Enter.
  if (pref !== 'off') {
    load('whoosh').catch(function () {});
    (function waitWorld() { if (S.has3d) { load('score').catch(function () {}); load('wind').catch(function () {}); load('water').catch(function () {}); } else setTimeout(waitWorld, 400); })();
  }

  // follow the camera: wind with movement, water near shorelines
  function tick() {
    requestAnimationFrame(tick);
    if (!on || !beds.wind || !S.world) return;
    var t = ctx.currentTime, speed = Math.min(1, (S.world.speed || 0) * 1.3);
    var u = S.u || 0, i = Math.floor(u), f = u - i;
    var a = S.sections[Math.min(S.sections.length - 1, i)], b = S.sections[Math.min(S.sections.length - 1, i + 1)];
    var wv = (WATER[a.dataset.shot] || 0) * (1 - f) + (WATER[b.dataset.shot] || 0) * f;
    beds.wind.gain.setTargetAtTime(.12 + speed * .55, t, .25);
    beds.water.gain.setTargetAtTime(wv * .32, t, .8);
  }
  tick();
  document.addEventListener('visibilitychange', function () { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (on) ctx.resume(); });
})();
