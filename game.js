'use strict';
(() => {
  // ================================================================
  // Constants & helpers
  // ================================================================
  const W = 1280, H = 720;
  const HOUR_SECONDS = 45;
  const NIGHT_LENGTH = HOUR_SECONDS * 6;
  const SAVE_KEY = 'nightshift-grinlo-progress';

  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now() / 1000;

  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function ell(c, x, y, rx, ry, rot = 0) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    c.fill();
  }
  function poly(c, pts) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    c.fill();
  }

  // ================================================================
  // Audio (all synthesized with WebAudio)
  // ================================================================
  const Snd = {
    ac: null, master: null, noiseBuf: null,
    hum: null, buzz: null, camStatic: null, musicTimer: null,
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate * 2;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    },
    get t() { return this.ac.currentTime; },
    env(g, when, attack, peak, dur) {
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(peak, when + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(dur, attack + 0.01));
    },
    noiseSrc() {
      const s = this.ac.createBufferSource();
      s.buffer = this.noiseBuf; s.loop = true;
      return s;
    },
    noise(dur, o = {}) {
      if (!this.ac) return;
      const when = this.t + (o.delay || 0);
      const src = this.noiseSrc();
      const f = this.ac.createBiquadFilter();
      f.type = o.type || 'lowpass'; f.frequency.value = o.freq || 1000; f.Q.value = o.q || 1;
      if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, when + dur);
      const g = this.ac.createGain();
      this.env(g, when, o.attack || 0.005, o.gain || 0.3, dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(when, Math.random());
      src.stop(when + dur + 0.05);
    },
    tone(freq, dur, o = {}) {
      if (!this.ac) return;
      const when = this.t + (o.delay || 0);
      const osc = this.ac.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, when);
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, when + dur);
      if (o.vibrato) {
        const l = this.ac.createOscillator();
        l.frequency.value = o.vibrato;
        const lg = this.ac.createGain();
        lg.gain.value = freq * 0.06;
        l.connect(lg).connect(osc.frequency);
        l.start(when); l.stop(when + dur + 0.05);
      }
      const g = this.ac.createGain();
      this.env(g, when, o.attack || 0.01, o.gain || 0.2, dur);
      osc.connect(g).connect(this.master);
      osc.start(when); osc.stop(when + dur + 0.05);
    },
    makeLoop(build) {
      if (!this.ac) return null;
      const g = this.ac.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      const nodes = build(g);
      nodes.forEach((n) => n.start());
      g.gain.setTargetAtTime(1, this.t, 0.05);
      return {
        stop: () => {
          g.gain.setTargetAtTime(0, this.t, 0.05);
          nodes.forEach((n) => n.stop(this.t + 0.4));
        },
      };
    },
    filtered(src, type, freq, gain, out, q = 1) {
      const f = this.ac.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = this.ac.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(out);
    },
    setLoop(name, want, build) {
      if (want && !this[name]) this[name] = this.makeLoop(build);
      else if (!want && this[name]) { this[name].stop(); this[name] = null; }
    },
    setHum(on) {
      this.setLoop('hum', on, (out) => {
        const n = this.noiseSrc();
        this.filtered(n, 'lowpass', 220, 0.09, out);
        const o = this.ac.createOscillator(); o.frequency.value = 60;
        this.filtered(o, 'lowpass', 400, 0.025, out);
        return [n, o];
      });
    },
    setBuzz(on) {
      this.setLoop('buzz', on, (out) => {
        const o = this.ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
        this.filtered(o, 'bandpass', 1000, 0.05, out, 2);
        const n = this.noiseSrc();
        this.filtered(n, 'bandpass', 4000, 0.02, out, 1);
        return [o, n];
      });
    },
    setCamStatic(on) {
      this.setLoop('camStatic', on, (out) => {
        const n = this.noiseSrc();
        this.filtered(n, 'highpass', 3000, 0.03, out);
        return [n];
      });
    },
    stopAll() {
      this.setHum(false); this.setBuzz(false); this.setCamStatic(false); this.stopMusic();
    },
    door() {
      this.noise(0.28, { type: 'lowpass', freq: 600, gain: 0.5 });
      this.tone(110, 0.3, { type: 'square', gain: 0.1, slideTo: 45 });
    },
    error() { this.tone(140, 0.25, { type: 'square', gain: 0.08 }); },
    blip() { this.tone(1400, 0.05, { type: 'square', gain: 0.04 }); },
    camFlip() {
      this.noise(0.18, { type: 'highpass', freq: 2000, gain: 0.12 });
      this.tone(700, 0.15, { type: 'triangle', gain: 0.05, slideTo: 300 });
    },
    staticBurst() { this.noise(0.7, { type: 'bandpass', freq: 3000, gain: 0.25, q: 0.5 }); },
    steps(n, gain = 0.25, spacing = 0.45) {
      for (let i = 0; i < n; i++) {
        this.noise(0.09, { type: 'lowpass', freq: 180, gain, delay: i * spacing });
        this.tone(55, 0.12, { gain: gain * 0.8, delay: i * spacing });
      }
    },
    run() { this.steps(12, 0.4, 0.17); },
    bang() {
      for (let i = 0; i < 3; i++) {
        this.noise(0.2, { type: 'lowpass', freq: 320, gain: 0.9, delay: i * 0.3 });
        this.tone(70, 0.22, { gain: 0.5, delay: i * 0.3, type: 'square', slideTo: 40 });
      }
    },
    sting() {
      [311, 330, 466, 622].forEach((f) => this.tone(f, 1.4, { type: 'sawtooth', gain: 0.05 }));
      this.noise(0.6, { type: 'highpass', freq: 1500, gain: 0.15 });
    },
    laugh() {
      for (let i = 0; i < 3; i++) {
        this.tone(170 - i * 18, 0.24, { type: 'sawtooth', gain: 0.05, delay: i * 0.28, vibrato: 8 });
        this.tone(340 - i * 36, 0.24, { type: 'triangle', gain: 0.04, delay: i * 0.28 });
      }
    },
    clatter() {
      for (let i = 0; i < 4; i++) {
        const d = rand(0, 0.6);
        this.noise(0.12, { type: 'bandpass', freq: rand(2000, 4500), q: 4, gain: 0.25, delay: d });
        this.tone(rand(1500, 2600), 0.25, { type: 'triangle', gain: 0.04, delay: d });
      }
    },
    scream() {
      for (let i = 0; i < 3; i++) {
        this.tone(rand(400, 700), 1.4, { type: 'sawtooth', gain: 0.22, slideTo: rand(900, 1600), vibrato: 30 });
      }
      this.noise(1.4, { type: 'bandpass', freq: 2500, q: 0.7, gain: 0.7 });
      this.noise(0.5, { type: 'lowpass', freq: 200, gain: 0.9 });
    },
    powerDown() {
      this.tone(220, 1.6, { type: 'sawtooth', gain: 0.15, slideTo: 25 });
      this.noise(0.6, { type: 'lowpass', freq: 400, gain: 0.4 });
    },
    chime() {
      for (let i = 0; i < 6; i++) {
        [523, 659, 784].forEach((f) => this.tone(f, 2.2, { gain: 0.07, delay: i * 0.7, attack: 0.005 }));
      }
      this.noise(4, { type: 'bandpass', freq: 1800, q: 0.5, gain: 0.08, delay: 1.5, attack: 0.8 });
    },
    startMusic() {
      if (!this.ac) return;
      this.stopMusic();
      const notes = [440, 523, 659, 523, 440, 415, 440, 0, 392, 494, 587, 494, 392, 370, 392, 0];
      let i = 0;
      this.musicTimer = setInterval(() => {
        const f = notes[i++ % notes.length];
        if (f) {
          this.tone(f, 0.5, { type: 'triangle', gain: 0.1 });
          this.tone(f * 2, 0.3, { gain: 0.035 });
        }
      }, 300);
    },
    stopMusic() {
      if (this.musicTimer) clearInterval(this.musicTimer);
      this.musicTimer = null;
    },
  };

  // ================================================================
  // Game data
  // ================================================================
  const ROOMS = {
    '1A': { name: 'Show Stage', map: [45, 8] },
    '1B': { name: 'Dining Area', map: [45, 28] },
    '1C': { name: 'Curtain Cove', map: [15, 42] },
    '5': { name: 'Backstage', map: [12, 18] },
    '7': { name: 'Restrooms', map: [85, 28] },
    '6': { name: 'Kitchen', map: [83, 58] },
    '2A': { name: 'West Hall', map: [33, 58] },
    '3': { name: 'Supply Closet', map: [12, 70] },
    '2B': { name: 'W. Hall Corner', map: [33, 82] },
    '4A': { name: 'East Hall', map: [60, 58] },
    '4B': { name: 'E. Hall Corner', map: [60, 82] },
  };
  const CAM_ORDER = ['1A', '1B', '1C', '5', '7', '6', '2A', '3', '2B', '4A', '4B'];
  const MAP_LINKS = [
    ['1A', '1B'], ['1B', '5'], ['1B', '1C'], ['1B', '7'], ['7', '6'], ['1B', '2A'], ['2A', '3'],
    ['2A', '2B'], ['1B', '4A'], ['4A', '4B'], ['6', '4A'],
  ];

  const DEFS = {
    patches: {
      name: 'Patches', kind: 'rabbit', side: 'left', start: '1A', interval: 4.97, retreat: '1B',
      route: { '1A': ['1B'], '1B': ['5', '2A'], '5': ['1B', '2A'], '2A': ['3', '2B'], '3': ['2A', '2B'], '2B': ['LDOOR', 'LDOOR', '3'] },
    },
    clank: {
      name: 'Clank', kind: 'crow', side: 'right', start: '1A', interval: 4.98, retreat: '1B',
      route: { '1A': ['1B'], '1B': ['7', '6'], '7': ['6', '4A'], '6': ['7', '4A'], '4A': ['4B', '4B', '1B'], '4B': ['RDOOR', 'RDOOR', '4A'] },
    },
    grinlo: {
      name: 'Grinlo', kind: 'bear', side: 'right', start: '1A', interval: 3.02,
      route: { '1A': ['1B'], '1B': ['7'], '7': ['6'], '6': ['4A'], '4A': ['4B'] },
    },
    mimi: { name: 'Mimi', kind: 'fox', side: 'left', start: '1C', interval: 5.01 },
  };

  const NIGHT_AI = {
    1: { patches: 2, clank: 1, grinlo: 0, mimi: 1 },
    2: { patches: 4, clank: 4, grinlo: 1, mimi: 3 },
    3: { patches: 7, clank: 6, grinlo: 3, mimi: 5 },
    4: { patches: 10, clank: 9, grinlo: 5, mimi: 8 },
    5: { patches: 14, clank: 13, grinlo: 9, mimi: 12 },
    6: { patches: 18, clank: 17, grinlo: 14, mimi: 16 },
  };

  const CAPTIONS = {
    1: [
      [1, "Hello, hello? Welcome to your first night at Grinlo's Pizza Party!"],
      [7, 'The animatronics get a little... wander-y at night. Watch them on the cameras. [SPACE]'],
      [14, 'If one shows up at a doorway, shut that door! Use the LIGHTS to check. [Q] / [E], doors [A] / [D]'],
      [21, "Doors and lights use power, and power is limited. When it's gone... well."],
      [28, "Oh, and Mimi in Curtain Cove gets restless if nobody checks the cameras. Good luck!"],
    ],
    2: [
      [1, "Hey, night two! You're doing great."],
      [7, "Grinlo, the bear, is camera-shy. He only moves when nobody's watching him."],
      [14, "If he reaches the East Hall Corner, keep the RIGHT door shut while you're on the cameras."],
      [21, 'And if you ever see Mimi running down the West Hall... shut the LEFT door. Fast.'],
    ],
    3: [
      [1, 'Night three. Things get livelier from here.'],
      [7, "Tip: if a door button stops working, someone's already in the office with you."],
    ],
    4: [
      [1, '*cough* ...hey... if you hear this... keep checking those doors...'],
      [8, '*banging* ...I-I\'ll just leave a message...'],
    ],
  };

  // ================================================================
  // State
  // ================================================================
  let s = { screen: 'menu' };
  let fanAngle = 0;

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || { night: 1 }; } catch { return { night: 1 }; }
  }
  function saveProgress(night) {
    const p = loadProgress();
    p.night = Math.max(p.night || 1, night);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  }

  function makeMonsters() {
    const M = {};
    for (const key of Object.keys(DEFS)) {
      const d = DEFS[key];
      M[key] = {
        key, ...d, room: d.start, timer: rand(0, d.interval), ai: 0,
        stage: 0, running: false, runTimer: 0, attackTimer: 0, seenAtDoor: false,
      };
    }
    return M;
  }

  function startNight(n, custom = null) {
    Snd.init();
    Snd.stopAll();
    s = {
      screen: 'intro', introT: 2.8,
      night: n, custom,
      time: 0, hour: 0, power: 100, usage: 1,
      leftDoor: false, rightDoor: false, leftLight: false, rightLight: false,
      leftDoorAnim: 0, rightDoorAnim: 0,
      camUp: false, cam: '1A', camSwitch: 0, disrupted: 0,
      powerOut: false, po: null,
      js: null, mimiBangs: 0, pendingAttack: null,
      kitchenT: 0,
      captions: custom ? [] : (CAPTIONS[n] || []).slice(),
      caption: '', captionT: 0,
      M: makeMonsters(),
    };
    applyAI();
    const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] || `${n}th`;
    $('intro-night').textContent = custom ? 'Custom Night' : `${ord} Night`;
    showScreen('intro');
  }

  function applyAI() {
    const base = s.custom || NIGHT_AI[Math.min(s.night, 6)];
    const h = s.hour;
    const boost = s.custom ? { patches: 0, clank: 0, grinlo: 0, mimi: 0 } : {
      patches: (h >= 2) + (h >= 3) + (h >= 4),
      clank: (h >= 3) + (h >= 4),
      mimi: (h >= 3) + (h >= 4),
      grinlo: (h >= 4 && base.grinlo > 0) ? 1 : 0,
    };
    for (const k of Object.keys(s.M)) s.M[k].ai = clamp(base[k] + boost[k], 0, 20);
  }

  function showScreen(name) {
    for (const id of ['menu', 'intro', 'gameover', 'win']) $(id).classList.toggle('hidden', id !== name);
    if (name === 'win') {
      // restart CSS animations
      const w = $('win');
      w.querySelectorAll('.roll, #win-buttons').forEach((el) => {
        el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      });
    }
  }

  // ================================================================
  // Controls
  // ================================================================
  const playing = () => s.screen === 'playing';
  const jammed = (side) => Object.values(s.M).some((m) => m.room === 'OFFICE' && m.side === side && m.key !== 'grinlo');

  function toggleDoor(side) {
    if (!playing() || s.powerOut || s.camUp) return;
    if (jammed(side)) { Snd.error(); return; }
    s[side + 'Door'] = !s[side + 'Door'];
    Snd.door();
  }

  function toggleLight(side) {
    if (!playing() || s.powerOut || s.camUp) return;
    if (jammed(side)) { Snd.error(); return; }
    const key = side + 'Light';
    const other = side === 'left' ? 'rightLight' : 'leftLight';
    s[key] = !s[key];
    if (s[key]) {
      s[other] = false;
      const m = monsterAtDoor(side);
      if (m && !m.seenAtDoor) { m.seenAtDoor = true; Snd.sting(); }
    }
  }

  function toggleCams() {
    if (!playing() || s.powerOut) return;
    s.camUp = !s.camUp;
    s.camSwitch = 1;
    s.leftLight = s.rightLight = false;
    Snd.camFlip();
    if (!s.camUp) {
      const intruder = Object.values(s.M).find((m) => m.room === 'OFFICE');
      if (intruder) s.pendingAttack = { key: intruder.key, t: 0.25 };
    }
  }

  function selectCam(id) {
    if (!playing() || !s.camUp || s.cam === id) return;
    s.cam = id;
    s.camSwitch = 1;
    Snd.blip();
  }

  function monsterAtDoor(side) {
    const key = side === 'left' ? 'LDOOR' : 'RDOOR';
    return Object.values(s.M).find((m) => m.room === key);
  }

  // ================================================================
  // Monster AI
  // ================================================================
  function moveMonster(m, to) {
    const from = m.room;
    m.room = to;
    if (s.camUp && (s.cam === from || s.cam === to)) { s.disrupted = 1.0; Snd.staticBurst(); }
    if (to === 'LDOOR' || to === 'RDOOR') { m.seenAtDoor = false; Snd.steps(4, 0.22); }
    if (from === 'LDOOR' || from === 'RDOOR') Snd.steps(3, 0.12);
  }

  function rollMove(m, dt) {
    m.timer += dt;
    if (m.timer < m.interval) return false;
    m.timer -= m.interval;
    return randi(1, 20) <= m.ai;
  }

  function updateWalker(m, dt) {
    if (m.room === 'OFFICE') {
      if (!s.camUp) {
        m.attackTimer -= dt;
        if (m.attackTimer <= 0) jumpscare(m.key);
      }
      return;
    }
    if (!rollMove(m, dt)) return;
    const doorKey = m.side === 'left' ? 'LDOOR' : 'RDOOR';
    if (m.room === doorKey) {
      if (s[m.side + 'Door']) {
        moveMonster(m, m.retreat);
      } else {
        m.room = 'OFFICE';
        m.attackTimer = rand(6, 14);
        s[m.side + 'Light'] = false;
      }
      return;
    }
    const opts = (m.route[m.room] || []).filter((r) => !(r === doorKey && monsterAtDoor(m.side)));
    if (opts.length) moveMonster(m, pick(opts));
  }

  function updateGrinlo(m, dt) {
    if (m.room === 'OFFICE') return;
    if (m.room === '1A' && (s.M.patches.room === '1A' || s.M.clank.room === '1A')) return;
    if (s.camUp && s.cam === m.room) return; // frozen while watched
    if (!rollMove(m, dt)) return;
    if (m.room === '4B') {
      if (s.rightDoor) { moveMonster(m, '4A'); Snd.laugh(); }
      else if (s.camUp) { m.room = 'OFFICE'; }
      return;
    }
    moveMonster(m, m.route[m.room][0]);
    Snd.laugh();
  }

  function updateMimi(m, dt) {
    if (m.running) {
      if (s.camUp && s.cam === '2A' && m.runTimer > 2.2) m.runTimer = 2.2;
      const before = m.runTimer;
      m.runTimer -= dt;
      if (before > 2.2 && m.runTimer <= 2.2) Snd.run();
      if (m.runTimer <= 0) {
        m.running = false;
        if (s.leftDoor) {
          Snd.bang();
          s.power = Math.max(0, s.power - (1 + 5 * s.mimiBangs));
          s.mimiBangs++;
          m.stage = randi(0, 1);
          m.room = '1C';
        } else {
          jumpscare('mimi');
        }
      }
      return;
    }
    if (!rollMove(m, dt)) return;
    if (s.camUp) return; // she only creeps out while nobody is watching
    m.stage++;
    if (m.stage >= 4) {
      m.running = true;
      m.runTimer = rand(10, 16);
      m.room = '2A';
    }
  }

  // ================================================================
  // Game flow
  // ================================================================
  function jumpscare(key) {
    if (!playing()) return;
    const m = s.M[key];
    s.screen = 'jumpscare';
    s.js = { kind: m.kind, name: m.name, t: 0 };
    s.camUp = false;
    Snd.stopAll();
    Snd.scream();
  }

  function gameOver() {
    s.screen = 'gameover';
    $('gameover-text').textContent = `You were caught by ${s.js.name}.`;
    showScreen('gameover');
  }

  function winNight() {
    s.screen = 'win';
    s.camUp = false;
    Snd.stopAll();
    Snd.chime();
    let msg = '';
    if (s.custom) {
      msg = 'Custom night complete!';
      $('btn-next').classList.add('hidden');
    } else {
      saveProgress(Math.min(s.night + 1, 6));
      if (s.night === 5) msg = 'You survived the week! Here\'s your paycheck: $120.50. Night 6 unlocked...';
      else if (s.night >= 6) msg = 'You beat Night 6. Grinlo is impressed. Try a Custom Night!';
      else msg = `Night ${s.night} complete.`;
      $('btn-next').classList.toggle('hidden', s.night >= 6);
    }
    $('win-text').textContent = msg;
    showScreen('win');
  }

  function startPowerOut() {
    s.powerOut = true;
    s.power = 0;
    s.leftDoor = s.rightDoor = s.leftLight = s.rightLight = false;
    s.camUp = false;
    Snd.stopAll();
    Snd.powerDown();
    s.po = { phase: 'dark', t: rand(4, 10) };
  }

  function updatePowerOut(dt) {
    s.po.t -= dt;
    if (s.po.t > 0) return;
    if (s.po.phase === 'dark') { s.po = { phase: 'music', t: rand(6, 14) }; Snd.startMusic(); }
    else if (s.po.phase === 'music') { s.po = { phase: 'black', t: rand(1.5, 5) }; Snd.stopMusic(); }
    else jumpscare('grinlo');
  }

  function update(dt) {
    if (s.screen === 'intro') {
      s.introT -= dt;
      if (s.introT <= 0) {
        s.screen = 'playing';
        showScreen(null);
      }
      return;
    }
    if (s.screen === 'jumpscare') {
      s.js.t += dt;
      if (s.js.t > 1.5) gameOver();
      return;
    }
    if (!playing()) return;

    s.time += dt;
    const hour = Math.floor(s.time / HOUR_SECONDS);
    if (hour !== s.hour) { s.hour = hour; applyAI(); }
    if (s.time >= NIGHT_LENGTH) { winNight(); return; }

    s.leftDoorAnim = clamp(s.leftDoorAnim + (s.leftDoor ? 6 : -6) * dt, 0, 1);
    s.rightDoorAnim = clamp(s.rightDoorAnim + (s.rightDoor ? 6 : -6) * dt, 0, 1);
    s.camSwitch = Math.max(0, s.camSwitch - dt * 4);
    s.disrupted = Math.max(0, s.disrupted - dt);

    // Captions
    if (s.captions.length && s.time >= s.captions[0][0]) {
      s.caption = s.captions.shift()[1];
      s.captionT = 6.5;
    }
    if (s.captionT > 0) { s.captionT -= dt; if (s.captionT <= 0) s.caption = ''; }

    if (s.powerOut) {
      updatePowerOut(dt);
      return;
    }

    // Power
    s.usage = 1 + s.leftDoor + s.rightDoor + (s.leftLight || s.rightLight ? 1 : 0) + (s.camUp ? 1 : 0);
    s.power -= dt * (s.usage * 0.085 + (s.night >= 4 && !s.custom ? 0.03 : 0));
    if (s.power <= 0) { startPowerOut(); return; }

    // Monsters
    updateWalker(s.M.patches, dt);
    if (!playing()) return;
    updateWalker(s.M.clank, dt);
    if (!playing()) return;
    updateGrinlo(s.M.grinlo, dt);
    updateMimi(s.M.mimi, dt);
    if (!playing()) return;

    if (s.pendingAttack) {
      s.pendingAttack.t -= dt;
      if (s.pendingAttack.t <= 0) { const k = s.pendingAttack.key; s.pendingAttack = null; jumpscare(k); return; }
    }

    // Kitchen audio
    if (s.camUp && s.cam === '6' && (s.M.clank.room === '6' || s.M.grinlo.room === '6')) {
      s.kitchenT -= dt;
      if (s.kitchenT <= 0) { Snd.clatter(); s.kitchenT = rand(0.8, 1.8); }
    }

    // Ambient loops
    Snd.setHum(true);
    Snd.setBuzz((s.leftLight || s.rightLight) && !s.camUp);
    Snd.setCamStatic(s.camUp);
  }

  // ================================================================
  // Rendering: monsters
  // ================================================================
  const PAL = {
    bear: { body: '#7a4a26', dark: '#4e2f17', belly: '#c59a6a', eye: '#4af', tie: '#111' },
    rabbit: { body: '#5d56b0', dark: '#3b3577', belly: '#b9b4e8', eye: '#f33', tie: '#c22' },
    crow: { body: '#3c3c4e', dark: '#22222c', belly: '#e8e0c8', eye: '#fd2', tie: '#d33', beak: '#f0a020' },
    fox: { body: '#b5432c', dark: '#7a2a1a', belly: '#efd9b8', eye: '#ffcf3a', tie: '#333' },
  };

  function drawHead(c, kind, o = {}) {
    const P = PAL[kind];
    const open = o.open || 0;
    // Ears / top features
    c.fillStyle = P.body;
    if (kind === 'bear') {
      ell(c, -58, -52, 26, 26); ell(c, 58, -52, 26, 26);
      c.fillStyle = P.belly; ell(c, -58, -52, 13, 13); ell(c, 58, -52, 13, 13);
    } else if (kind === 'rabbit') {
      ell(c, -34, -120, 22, 78, -0.15);
      c.save(); c.translate(40, -70); c.rotate(0.9); ell(c, 0, -50, 20, 70); c.fillStyle = '#d9a3c9'; ell(c, 0, -50, 9, 52); c.restore();
      c.fillStyle = '#d9a3c9'; ell(c, -34, -120, 10, 60, -0.15);
    } else if (kind === 'fox') {
      poly(c, [[-75, -25], [-55, -120], [-15, -60]]);
      poly(c, [[75, -25], [58, -105], [40, -90], [30, -95], [15, -60]]);
      c.fillStyle = P.dark; poly(c, [[-62, -40], [-53, -95], [-28, -58]]);
    } else if (kind === 'crow') {
      poly(c, [[-20, -60], [-35, -110], [0, -65]]);
      poly(c, [[0, -65], [5, -120], [20, -60]]);
      poly(c, [[15, -62], [40, -100], [35, -55]]);
    }
    // Head
    c.fillStyle = P.body;
    ell(c, 0, 0, 80, 70);
    // Muzzle / beak
    if (kind === 'crow') {
      c.fillStyle = P.beak;
      poly(c, [[-38, 8], [38, 8], [0, 62]]);
      c.fillStyle = '#c47a10';
      poly(c, [[-30, 20 + open * 55], [30, 20 + open * 55], [0, 66 + open * 60]]);
      if (open > 0) {
        c.fillStyle = '#1a0505';
        poly(c, [[-30, 18], [30, 18], [30, 22 + open * 52], [-30, 22 + open * 52]]);
        c.fillStyle = '#eee';
        for (let i = -3; i <= 3; i++) poly(c, [[i * 9 - 4, 20], [i * 9 + 4, 20], [i * 9, 32]]);
      }
    } else {
      c.fillStyle = P.belly;
      const mw = kind === 'fox' ? 44 : 50;
      ell(c, 0, 28, mw, 32);
      if (open > 0) {
        c.fillStyle = '#1a0505';
        ell(c, 0, 52 + open * 20, 38, 10 + open * 38);
        c.fillStyle = '#eee';
        for (let i = -3; i <= 3; i++) {
          poly(c, [[i * 10 - 5, 44], [i * 10 + 5, 44], [i * 10, 58]]);
          poly(c, [[i * 10 - 5, 62 + open * 56], [i * 10 + 5, 62 + open * 56], [i * 10, 50 + open * 56]]);
        }
      } else {
        c.strokeStyle = '#2a1010'; c.lineWidth = 4;
        c.beginPath(); c.arc(0, 30, 28, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
        c.fillStyle = '#eee';
        for (let i = -2; i <= 2; i++) c.fillRect(i * 9 - 3, 50, 6, 7);
      }
      c.fillStyle = '#1a1010';
      ell(c, 0, kind === 'fox' ? 16 : 12, 14, 9);
    }
    // Rabbit cheek patch
    if (kind === 'rabbit') {
      c.fillStyle = '#7a73c8'; c.fillRect(38, 5, 26, 24);
      c.strokeStyle = '#222'; c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < 4; i++) { c.moveTo(38 + i * 7, 2); c.lineTo(38 + i * 7 + 4, 8); }
      c.stroke();
    }
    // Eyes
    for (const sx of [-1, 1]) {
      c.fillStyle = o.blackEyes ? '#000' : '#eee';
      ell(c, sx * 30, -14, 18, 15);
      c.fillStyle = P.dark;
      c.fillRect(sx * 30 - 20, -34, 40, 8);
    }
    const f = c.filter;
    c.filter = 'none';
    c.fillStyle = o.blackEyes ? '#fff' : P.eye;
    if (o.glow) { c.shadowColor = P.eye; c.shadowBlur = 18; }
    const px = o.stare ? 0 : Math.sin(now() * 0.7) * 4;
    ell(c, -30 + px, -12, o.blackEyes ? 3 : 6, o.blackEyes ? 3 : 6);
    ell(c, 30 + px, -12, o.blackEyes ? 3 : 6, o.blackEyes ? 3 : 6);
    c.shadowBlur = 0;
    c.filter = f;
    // Bear top hat
    if (kind === 'bear') {
      c.fillStyle = '#111';
      rr(c, -42, -80, 84, 12, 4); c.fill();
      rr(c, -27, -135, 54, 58, 4); c.fill();
      c.fillStyle = '#6b1515'; c.fillRect(-27, -92, 54, 8);
    }
  }

  function drawMonster(c, kind, x, y, s2, o = {}) {
    const P = PAL[kind];
    c.save();
    c.translate(x, y);
    c.scale(s2, s2);
    c.rotate(o.still ? 0 : Math.sin(now() * 1.3 + x) * 0.008);
    if (o.bright !== undefined && o.bright < 1) c.filter = `brightness(${o.bright})`;
    // legs
    c.fillStyle = P.dark;
    rr(c, -58, -150, 42, 150, 14); c.fill();
    rr(c, 16, -150, 42, 150, 14); c.fill();
    ell(c, -40, -6, 34, 13); ell(c, 40, -6, 34, 13);
    if (kind === 'fox') {
      // torn leg showing endoskeleton
      c.fillStyle = '#777'; c.fillRect(24, -110, 8, 90); c.fillRect(40, -110, 8, 90);
      c.fillStyle = '#555'; ell(c, 36, -60, 14, 8);
    }
    // arms
    c.fillStyle = P.body;
    if (kind === 'crow') {
      poly(c, [[-80, -290], [-140, -170], [-120, -120], [-95, -150], [-85, -130], [-70, -200]]);
      poly(c, [[80, -290], [140, -170], [120, -120], [95, -150], [85, -130], [70, -200]]);
    } else {
      rr(c, -120, -285, 38, 150, 18); c.fill();
      rr(c, 82, -285, 38, 150, 18); c.fill();
      c.fillStyle = P.dark; ell(c, -101, -132, 22, 18); ell(c, 101, -132, 22, 18);
    }
    // torso
    c.fillStyle = P.body;
    rr(c, -85, -305, 170, 180, 60); c.fill();
    c.fillStyle = P.belly;
    ell(c, 0, -208, 55, 62);
    if (kind === 'crow') {
      c.fillStyle = '#f4f4f4';
      rr(c, -52, -270, 104, 90, 10); c.fill();
      c.fillStyle = '#c22'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center';
      c.fillText("LET'S", 0, -235); c.fillText('EAT!!', 0, -200);
    }
    // bow tie
    c.fillStyle = P.tie;
    poly(c, [[0, -298], [-28, -312], [-28, -284]]);
    poly(c, [[0, -298], [28, -312], [28, -284]]);
    ell(c, 0, -298, 7, 7);
    // head
    c.save();
    c.translate(0, -375);
    drawHead(c, kind, o);
    c.restore();
    c.restore();
  }

  // ================================================================
  // Rendering: noise / effects
  // ================================================================
  const noiseFrames = [];
  for (let i = 0; i < 6; i++) {
    const nc = document.createElement('canvas');
    nc.width = 256; nc.height = 144;
    const nx = nc.getContext('2d');
    const img = nx.createImageData(256, 144);
    for (let p = 0; p < img.data.length; p += 4) {
      const v = Math.random() * 255;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
    nx.putImageData(img, 0, 0);
    noiseFrames.push(nc);
  }
  const scan = document.createElement('canvas');
  scan.width = 4; scan.height = 4;
  { const sx = scan.getContext('2d'); sx.fillStyle = 'rgba(0,0,0,0.35)'; sx.fillRect(0, 0, 4, 1); }
  const scanPattern = ctx.createPattern(scan, 'repeat');

  function drawNoise(alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pick(noiseFrames), 0, 0, W, H);
    ctx.restore();
  }

  function vignette(strength) {
    const g = ctx.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 780);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ================================================================
  // Rendering: office
  // ================================================================
  const DOORS = { left: [70, 250], right: [1030, 1210] };
  const DOOR_Y0 = 140, DOOR_Y1 = 570;

  function drawPoster(x, y, w, h) {
    ctx.fillStyle = '#d8c7a0';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#7a1e1e';
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CELEBRATE!', x + w / 2, y + 34);
    const heads = [['rabbit', 0.25], ['bear', 0.5], ['crow', 0.75]];
    for (const [k, fx] of heads) {
      ctx.save();
      ctx.translate(x + w * fx, y + h * 0.62);
      ctx.scale(0.36, 0.36);
      drawHead(ctx, k, {});
      ctx.restore();
    }
  }

  function drawOffice(dt) {
    // wall
    let g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1b1b22'); g.addColorStop(1, '#2a2a32');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // checker band
    for (let x = 0; x < W; x += 20) {
      for (let r = 0; r < 2; r++) {
        ctx.fillStyle = ((x / 20 + r) % 2) ? '#2b2b2b' : '#0e0e0e';
        ctx.fillRect(x, 400 + r * 20, 20, 20);
      }
    }
    // posters & kids drawings
    drawPoster(440, 110, 260, 210);
    const drawings = [[760, 150, '#e0e0ff'], [850, 190, '#ffe0e0'], [770, 260, '#e0ffe0'], [880, 300, '#ffffe0']];
    drawings.forEach(([x, y, col], i) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate((i % 2 ? 1 : -1) * 0.06);
      ctx.fillStyle = col; ctx.fillRect(0, 0, 80, 64);
      ctx.strokeStyle = ['#c33', '#33c', '#a60', '#393'][i]; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(40, 16, 9, 0, Math.PI * 2);
      ctx.moveTo(40, 25); ctx.lineTo(40, 44); ctx.moveTo(26, 30); ctx.lineTo(54, 30);
      ctx.moveTo(40, 44); ctx.lineTo(30, 58); ctx.moveTo(40, 44); ctx.lineTo(50, 58); ctx.stroke();
      ctx.restore();
    });
    // floor
    ctx.fillStyle = '#121216';
    ctx.fillRect(0, 570, W, 150);
    ctx.strokeStyle = '#1e1e24'; ctx.lineWidth = 2;
    for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(640 + i * 60, 570); ctx.lineTo(640 + i * 160, H); ctx.stroke(); }
    // desk
    ctx.fillStyle = '#3b2a1e';
    rr(ctx, 330, 500, 620, 240, 8); ctx.fill();
    ctx.fillStyle = '#4f3a28'; ctx.fillRect(330, 500, 620, 16);
    // monitor
    ctx.fillStyle = '#5a5a55'; rr(ctx, 560, 370, 180, 135, 10); ctx.fill();
    ctx.fillStyle = s.powerOut ? '#000' : '#0d1f12'; ctx.fillRect(575, 383, 150, 105);
    if (!s.powerOut) { ctx.fillStyle = 'rgba(80,255,120,0.12)'; ctx.fillRect(575, 383, 150, 105); }
    // cups, papers
    ctx.fillStyle = '#ddd'; ctx.fillRect(780, 465, 26, 38);
    ctx.fillStyle = '#c33'; ctx.fillRect(780, 475, 26, 8);
    ctx.save(); ctx.translate(840, 492); ctx.rotate(0.1); ctx.fillStyle = '#ccc8b8'; ctx.fillRect(0, 0, 70, 14); ctx.restore();
    // fan
    if (!s.powerOut) fanAngle += dt * 22;
    ctx.fillStyle = '#333'; ctx.fillRect(440, 430, 12, 75); rr(ctx, 410, 495, 72, 12, 4); ctx.fill();
    ctx.save(); ctx.translate(446, 420);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke();
    ctx.rotate(fanAngle); ctx.fillStyle = s.powerOut ? '#555' : 'rgba(110,110,110,0.75)';
    for (let i = 0; i < 3; i++) { ctx.rotate((Math.PI * 2) / 3); ell(ctx, 0, -22, 11, 22); }
    ctx.fillStyle = '#222'; ell(ctx, 0, 0, 8, 8);
    ctx.restore();

    // lamp flicker & vignette
    const flick = Math.random() < 0.015 ? 0.35 : 0;
    vignette(0.88);
    if (flick) { ctx.fillStyle = `rgba(0,0,0,${flick})`; ctx.fillRect(0, 0, W, H); }

    // doorways
    drawDoorway('left');
    drawDoorway('right');
    // button plates
    for (const x of [256, 948]) {
      ctx.fillStyle = '#2a2a2e'; rr(ctx, x, 245, 80, 180, 6); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
    }

    if (s.powerOut) {
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillRect(0, 0, W, H);
      if (s.po.phase === 'music' && Math.sin(now() * 14) + Math.random() * 0.8 > 0.2) {
        const [x0, x1] = DOORS.left;
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, DOOR_Y0, x1 - x0, DOOR_Y1 - DOOR_Y0); ctx.clip();
        ctx.translate((x0 + x1) / 2, 300); ctx.scale(0.75, 0.75);
        ctx.filter = 'brightness(0.12)';
        drawHead(ctx, 'bear', { glow: true, stare: true });
        ctx.filter = 'none';
        ctx.restore();
      }
      if (s.po.phase === 'black') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    }
  }

  function drawDoorway(side) {
    const [x0, x1] = DOORS[side];
    const w = x1 - x0, h = DOOR_Y1 - DOOR_Y0;
    const lit = s[side + 'Light'] && !s.powerOut && Math.random() > 0.04;
    const anim = s[side + 'DoorAnim'];
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, DOOR_Y0, w, h); ctx.clip();
    if (lit) {
      const g = ctx.createLinearGradient(0, DOOR_Y0, 0, DOOR_Y1);
      g.addColorStop(0, '#2a2416'); g.addColorStop(0.55, '#5c513a'); g.addColorStop(1, '#3a3222');
      ctx.fillStyle = g; ctx.fillRect(x0, DOOR_Y0, w, h);
      ctx.fillStyle = '#1e1a10';
      ctx.fillRect(x0 + w * 0.3, DOOR_Y0 + 60, w * 0.4, h * 0.55);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const y = DOOR_Y0 + h * 0.75 + i * 18;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      }
      const m = monsterAtDoor(side);
      if (m) drawMonster(ctx, m.kind, x0 + w / 2 + (side === 'left' ? 10 : -10), DOOR_Y1 + 30, 0.85, { glow: true, stare: true, still: true });
    } else {
      ctx.fillStyle = '#030304';
      ctx.fillRect(x0, DOOR_Y0, w, h);
    }
    // shutter
    if (anim > 0) {
      const dh = h * anim;
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, '#3a3e44'); g.addColorStop(0.5, '#5a6068'); g.addColorStop(1, '#33363b');
      ctx.fillStyle = g;
      ctx.fillRect(x0, DOOR_Y0, w, dh);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let y = DOOR_Y0 + dh - 30; y > DOOR_Y0; y -= 22) ctx.fillRect(x0, y, w, 3);
      for (let i = 0; i < w; i += 24) {
        ctx.fillStyle = (i / 24) % 2 ? '#111' : '#d8b020';
        poly(ctx, [[x0 + i, DOOR_Y0 + dh - 16], [x0 + i + 24, DOOR_Y0 + dh - 16], [x0 + i + 12, DOOR_Y0 + dh], [x0 + i - 12, DOOR_Y0 + dh]]);
      }
    }
    ctx.restore();
    ctx.strokeStyle = '#2e2e34'; ctx.lineWidth = 14;
    ctx.strokeRect(x0 - 7, DOOR_Y0 - 7, w + 14, h + 7);
  }

  // ================================================================
  // Rendering: cameras
  // ================================================================
  function wallFloor(wall, floorA, floorB, horizon) {
    ctx.fillStyle = wall; ctx.fillRect(0, 0, W, horizon);
    const rows = 9;
    for (let r = 0; r < rows; r++) {
      const y0 = horizon + (H - horizon) * Math.pow(r / rows, 1.5);
      const y1 = horizon + (H - horizon) * Math.pow((r + 1) / rows, 1.5);
      const tw = 40 + r * 18;
      for (let x = -tw * 2, i = 0; x < W + tw; x += tw, i++) {
        ctx.fillStyle = (i + r) % 2 ? floorA : floorB;
        ctx.fillRect(x + (r % 2) * 0, y0, tw, y1 - y0 + 1);
      }
    }
  }

  const VP = { fx0: 560, fx1: 720, fy0: 270, fy1: 410 };
  function wallPt(sideSign, x, f) {
    // returns a point on the left (-1) or right (+1) hallway wall
    const d = sideSign < 0 ? x / VP.fx0 : (W - x) / (W - VP.fx1);
    const top = VP.fy0 * d, bottom = H - (H - VP.fy1) * d;
    return [x, top + (bottom - top) * f];
  }
  function wallQuad(sideSign, xa, xb, f0, f1, color) {
    ctx.fillStyle = color;
    poly(ctx, [wallPt(sideSign, xa, f0), wallPt(sideSign, xb, f0), wallPt(sideSign, xb, f1), wallPt(sideSign, xa, f1)]);
  }

  function drawHall(wallCol, posterCols) {
    const { fx0, fx1, fy0, fy1 } = VP;
    ctx.fillStyle = '#0c0c10'; poly(ctx, [[0, 0], [W, 0], [fx1, fy0], [fx0, fy0]]);
    ctx.fillStyle = wallCol; poly(ctx, [[0, 0], [fx0, fy0], [fx0, fy1], [0, H]]);
    ctx.fillStyle = wallCol; poly(ctx, [[W, 0], [fx1, fy0], [fx1, fy1], [W, H]]);
    ctx.fillStyle = '#18181c'; poly(ctx, [[0, H], [fx0, fy1], [fx1, fy1], [W, H]]);
    ctx.strokeStyle = '#26262c'; ctx.lineWidth = 2;
    for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(640 + i * 10, fy1); ctx.lineTo(640 + i * 180, H); ctx.stroke(); }
    for (let k = 1; k < 8; k++) {
      const y = fy1 + (H - fy1) * Math.pow(k / 8, 1.8);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.fillStyle = '#050506'; ctx.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
    // checker band on walls
    for (const sg of [-1, 1]) {
      for (let i = 0; i < 14; i++) {
        const xa = sg < 0 ? i * 40 : W - (i + 1) * 40;
        const xb = xa + 40;
        wallQuad(sg, xa, xb, 0.62, 0.68, i % 2 ? '#2a2a2a' : '#0b0b0b');
      }
    }
    posterCols.forEach(([sg, xa, xb, col]) => wallQuad(sg, xa, xb, 0.25, 0.5, col));
    // ceiling lights
    for (let k = 0; k < 3; k++) {
      const y = 30 + k * 70, wv = 110 - k * 30;
      ctx.fillStyle = `rgba(230,230,200,${0.25 - k * 0.06})`;
      ctx.fillRect(640 - wv / 2, y, wv, 10 - k * 2);
    }
  }

  function camMonster(key, x, y, sc, extra = {}) {
    const m = s.M[key];
    const stare = (Math.floor(now() / 2.3 + x) % 4) === 0;
    drawMonster(ctx, m.kind, x, y, sc, { bright: extra.bright ?? 0.75, glow: stare || extra.glow, stare, ...extra });
  }
  const here = (key, room) => s.M[key].room === room;

  function drawCurtains(gap, col) {
    const half = gap / 2;
    for (const sg of [-1, 1]) {
      const x0 = sg < 0 ? 380 : 640 + half;
      const x1 = sg < 0 ? 640 - half : 900;
      if (x1 <= x0) continue;
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      const folds = 6;
      for (let i = 0; i <= folds; i++) g.addColorStop(i / folds, i % 2 ? col : '#1e0d2a');
      ctx.fillStyle = g;
      ctx.fillRect(x0, 140, x1 - x0, 420);
      ctx.fillStyle = '#d8c040';
      for (let i = 0; i < 6; i++) {
        const sx = x0 + ((i * 53 + (sg < 0 ? 17 : 31)) % Math.max(1, x1 - x0));
        const sy = 180 + ((i * 97) % 340);
        ctx.font = '20px sans-serif'; ctx.fillText('★', sx, sy);
      }
    }
  }

  function drawRoom(id) {
    const t = now();
    switch (id) {
      case '1A': {
        ctx.fillStyle = '#1e0e0e'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#d0b050'; ctx.font = '22px sans-serif';
        for (let i = 0; i < 18; i++) ctx.fillText('★', (i * 173) % W, 120 + ((i * 71) % 260));
        ctx.fillStyle = '#5a1515'; ctx.fillRect(0, 0, W, 70);
        ctx.fillStyle = '#e8d080'; ctx.font = 'bold 40px "Courier New", monospace'; ctx.textAlign = 'center';
        ctx.fillText("GRINLO'S PIZZA PARTY", 640, 50);
        ctx.fillStyle = '#3a2a20'; ctx.fillRect(0, 540, W, 60);
        ctx.fillStyle = '#2a1d16'; ctx.fillRect(0, 600, W, 120);
        for (const sg of [0, 1]) {
          const x0 = sg ? 1080 : 0;
          const g = ctx.createLinearGradient(x0, 0, x0 + 200, 0);
          for (let i = 0; i <= 5; i++) g.addColorStop(i / 5, i % 2 ? '#7a1818' : '#3a0808');
          ctx.fillStyle = g; ctx.fillRect(x0, 70, 200, 530);
        }
        if (here('patches', '1A')) camMonster('patches', 400, 560, 0.85);
        if (here('grinlo', '1A')) camMonster('grinlo', 640, 560, 0.9);
        if (here('clank', '1A')) camMonster('clank', 880, 560, 0.85);
        break;
      }
      case '1B': {
        wallFloor('#221d1a', '#2a2a2a', '#0f0f0f', 360);
        ctx.fillStyle = '#4a2a2a'; ctx.fillRect(150, 120, 120, 150); ctx.fillStyle = '#2a3a4a'; ctx.fillRect(1000, 140, 130, 140);
        if (here('grinlo', '1B')) camMonster('grinlo', 640, 470, 0.5);
        if (here('patches', '1B')) camMonster('patches', 420, 520, 0.6);
        if (here('clank', '1B')) camMonster('clank', 860, 520, 0.6);
        for (const [y, sc] of [[470, 0.75], [620, 1.1]]) {
          for (const x of [220, 640, 1060]) {
            ctx.fillStyle = '#c8c8c0';
            rr(ctx, x - 170 * sc, y, 340 * sc, 60 * sc, 6); ctx.fill();
            ctx.fillStyle = '#9a9a92'; ctx.fillRect(x - 170 * sc, y + 50 * sc, 340 * sc, 10 * sc);
            for (let k = -1; k <= 1; k++) {
              ctx.fillStyle = ['#d33', '#33d', '#dd3'][k + 1];
              poly(ctx, [[x + k * 90 * sc - 14 * sc, y + 5], [x + k * 90 * sc + 14 * sc, y + 5], [x + k * 90 * sc, y - 36 * sc]]);
            }
          }
        }
        break;
      }
      case '1C': {
        ctx.fillStyle = '#140a1c'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#2a1a14'; ctx.fillRect(330, 560, 620, 50);
        ctx.fillStyle = '#100808'; ctx.fillRect(0, 610, W, 110);
        const m = s.M.mimi;
        let gap = 0;
        if (m.running) gap = 520;
        else if (m.stage === 1) gap = 24;
        else if (m.stage === 2) gap = 110;
        else if (m.stage >= 3) gap = 280;
        ctx.fillStyle = '#050307'; ctx.fillRect(640 - gap / 2, 140, gap, 420);
        if (!m.running) {
          if (m.stage === 1) {
            ctx.save(); ctx.fillStyle = PAL.fox.eye; ctx.shadowColor = PAL.fox.eye; ctx.shadowBlur = 14;
            ell(ctx, 632, 300, 4, 4); ctx.restore();
          } else if (m.stage === 2) {
            ctx.save(); ctx.translate(645, 320); ctx.scale(0.6, 0.6); ctx.filter = 'brightness(0.7)';
            drawHead(ctx, 'fox', { glow: true, stare: true }); ctx.filter = 'none'; ctx.restore();
          } else if (m.stage >= 3) {
            drawMonster(ctx, 'fox', 660, 575, 0.62, { bright: 0.75, glow: true, stare: true, open: 0.4 });
          }
        }
        drawCurtains(gap, '#4a2266');
        ctx.fillStyle = '#ccc'; ctx.fillRect(1010, 470, 6, 140);
        ctx.fillStyle = '#e8e0c0'; ctx.fillRect(950, 400, 130, 80);
        ctx.fillStyle = '#222'; ctx.font = 'bold 16px "Courier New", monospace'; ctx.textAlign = 'center';
        ctx.fillText('SORRY!', 1015, 430); ctx.fillText('OUT OF', 1015, 450); ctx.fillText('ORDER', 1015, 470);
        break;
      }
      case '2A': {
        drawHall('#2a2620', [[-1, 120, 260, '#6a5a3a'], [1, 1000, 1120, '#3a4a6a']]);
        if (here('patches', '2A')) camMonster('patches', 640, 560, 0.55);
        const m = s.M.mimi;
        if (m.running && m.runTimer <= 2.2) {
          const p = clamp(1 - m.runTimer / 2.2, 0, 1);
          drawMonster(ctx, 'fox', 640 - 420 * p, 420 + 360 * p, 0.25 + 1.0 * p, { bright: 0.85, glow: true, open: 0.6, stare: true });
        }
        break;
      }
      case '2B': {
        ctx.fillStyle = '#26221c'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 560, W, 160);
        for (let x = 0; x < W; x += 30) { ctx.fillStyle = (x / 30) % 2 ? '#2a2a2a' : '#0b0b0b'; ctx.fillRect(x, 400, 30, 30); }
        ctx.fillStyle = '#d6c8a0'; ctx.fillRect(200, 110, 240, 260);
        ctx.fillStyle = '#5a1515'; ctx.font = 'bold 30px "Courier New", monospace'; ctx.textAlign = 'center';
        ctx.fillText('SMILE!', 320, 150);
        ctx.save(); ctx.translate(320, 270); ctx.scale(0.55, 0.55); drawHead(ctx, 'rabbit', {}); ctx.restore();
        ctx.fillStyle = '#555'; ctx.fillRect(1100, 0, 22, H);
        if (here('patches', '2B')) camMonster('patches', 780, 790, 1.15, { glow: true, stare: true });
        break;
      }
      case '3': {
        ctx.fillStyle = '#1c1c18'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#121210'; ctx.fillRect(0, 600, W, 120);
        for (const x of [120, 900]) {
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = '#3a3a34'; ctx.fillRect(x, 160 + k * 120, 260, 12);
            for (let b = 0; b < 3; b++) { ctx.fillStyle = ['#6a5a3a', '#4a4a5a', '#5a3a3a'][(b + k) % 3]; ctx.fillRect(x + 15 + b * 80, 100 + k * 120, 60, 60); }
          }
        }
        ctx.fillStyle = '#8a7a20'; rr(ctx, 520, 560, 90, 70, 6); ctx.fill();
        ctx.fillStyle = '#777'; ctx.fillRect(590, 330, 8, 240);
        ctx.fillStyle = 'rgba(255,240,180,0.1)'; poly(ctx, [[640, 0], [420, H], [860, H]]);
        if (here('patches', '3')) camMonster('patches', 700, 690, 0.95);
        break;
      }
      case '4A': {
        drawHall('#202426', [[-1, 140, 280, '#4a3a5a'], [1, 980, 1120, '#6a3a2a']]);
        if (here('grinlo', '4A')) camMonster('grinlo', 560, 540, 0.45, { bright: 0.45 });
        if (here('clank', '4A')) camMonster('clank', 700, 570, 0.55);
        break;
      }
      case '4B': {
        ctx.fillStyle = '#1e2226'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#16181a'; ctx.fillRect(0, 560, W, 160);
        for (let x = 0; x < W; x += 30) { ctx.fillStyle = (x / 30) % 2 ? '#2a2a2a' : '#0b0b0b'; ctx.fillRect(x, 400, 30, 30); }
        ctx.fillStyle = '#d0d0d8'; ctx.fillRect(860, 120, 220, 250);
        ctx.fillStyle = '#123'; ctx.font = 'bold 22px "Courier New", monospace'; ctx.textAlign = 'center';
        ctx.fillText("CLANK'S", 970, 160); ctx.fillText('SNACK TIME!', 970, 190);
        ctx.save(); ctx.translate(970, 285); ctx.scale(0.5, 0.5); drawHead(ctx, 'crow', {}); ctx.restore();
        if (here('grinlo', '4B')) camMonster('grinlo', 300, 760, 1.05, { bright: 0.35, glow: true, stare: true });
        if (here('clank', '4B')) camMonster('clank', 640, 800, 1.2, { glow: true, stare: true });
        break;
      }
      case '5': {
        ctx.fillStyle = '#1a1c1e'; ctx.fillRect(0, 0, W, H);
        for (let y = 0; y < 560; y += 40) for (let x = (y / 40) % 2 ? 0 : 40; x < W; x += 80) { ctx.fillStyle = '#202326'; ctx.fillRect(x, y, 40, 40); }
        ctx.fillStyle = '#3a3a3a'; ctx.fillRect(60, 250, 420, 14);
        ['bear', 'rabbit', 'crow'].forEach((k, i) => {
          ctx.save(); ctx.translate(130 + i * 140, 200); ctx.scale(0.42, 0.42); ctx.filter = 'brightness(0.55)';
          drawHead(ctx, k, { blackEyes: true }); ctx.filter = 'none'; ctx.restore();
        });
        ctx.fillStyle = '#2a2420'; ctx.fillRect(820, 520, 380, 30); ctx.fillRect(840, 550, 16, 120); ctx.fillRect(1160, 550, 16, 120);
        ctx.fillStyle = '#666'; for (let i = 0; i < 5; i++) ctx.fillRect(860 + i * 60, 505, 40, 15);
        ctx.fillStyle = '#121212'; ctx.fillRect(0, 600, W, 120);
        if (here('patches', '5')) camMonster('patches', 640, 740, 1.05, { glow: true, stare: true });
        break;
      }
      case '7': {
        ctx.fillStyle = '#2a2c2c'; ctx.fillRect(0, 0, W, H);
        for (let y = 0; y < 560; y += 32) for (let x = 0; x < W; x += 32) { ctx.strokeStyle = '#1e2020'; ctx.strokeRect(x, y, 32, 32); }
        ctx.fillStyle = '#141414'; ctx.fillRect(0, 560, W, 160);
        for (const [x, label] of [[180, 'BOYS'], [900, 'GIRLS']]) {
          ctx.fillStyle = '#3a2c22'; ctx.fillRect(x, 220, 200, 340);
          ctx.fillStyle = '#ccc'; ctx.fillRect(x + 50, 250, 100, 34);
          ctx.fillStyle = '#222'; ctx.font = 'bold 22px "Courier New", monospace'; ctx.textAlign = 'center';
          ctx.fillText(label, x + 100, 274);
        }
        if (here('clank', '7')) camMonster('clank', 520, 640, 0.75);
        if (here('grinlo', '7')) camMonster('grinlo', 760, 620, 0.68, { bright: 0.5 });
        break;
      }
    }
    void t;
  }

  function drawCamera() {
    const id = s.cam;
    if (id === '6') {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ddd'; ctx.font = 'bold 34px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.fillText('CAMERA DISABLED', 640, 330);
      ctx.font = '26px "Courier New", monospace'; ctx.fillText('- AUDIO ONLY -', 640, 380);
      drawNoise(0.12);
    } else {
      ctx.save();
      const pan = Math.sin(now() * 0.25) * 40;
      ctx.translate(640 + pan, 360); ctx.scale(1.08, 1.08); ctx.translate(-640, -360);
      drawRoom(id);
      ctx.restore();
      ctx.fillStyle = 'rgba(30,60,45,0.22)'; ctx.fillRect(0, 0, W, H);
      vignette(0.75);
      drawNoise(0.1 + Math.random() * 0.05);
    }
    if (s.disrupted > 0) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      drawNoise(0.9);
    }
    ctx.fillStyle = scanPattern; ctx.fillRect(0, 0, W, H);
    // overlay
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, W - 40, H - 40);
    if (Math.floor(now() * 1.5) % 2 === 0) { ctx.fillStyle = '#e22'; ell(ctx, 56, 112, 11, 11); }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px "Courier New", monospace'; ctx.textAlign = 'left';
    ctx.fillText('REC', 76, 120);
  }

  function drawJumpscare() {
    const t = s.js.t;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const shake = 30 * (1 - Math.min(1, t / 1.5));
    const sc = 1.6 + Math.min(1, t / 0.18) * 2.6;
    ctx.save();
    ctx.translate(640 + rand(-shake, shake), 420 + rand(-shake, shake));
    ctx.scale(sc, sc);
    ctx.rotate(rand(-0.05, 0.05));
    drawHead(ctx, s.js.kind, { open: 0.75 + 0.25 * Math.sin(t * 40), glow: true, stare: true });
    ctx.restore();
    if (Math.floor(t * 12) % 3 === 0) { ctx.fillStyle = 'rgba(255,0,0,0.15)'; ctx.fillRect(0, 0, W, H); }
    drawNoise(0.2);
  }

  function drawMenuBG() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const t = now();
    const twitch = Math.random() < 0.03;
    ctx.save();
    ctx.translate(930 + (twitch ? rand(-8, 8) : 0), 380);
    ctx.scale(2.6, 2.6);
    ctx.rotate(twitch ? rand(-0.1, 0.1) : Math.sin(t * 0.5) * 0.03);
    ctx.filter = `brightness(${0.35 + (Math.random() < 0.05 ? 0.3 : 0)})`;
    drawHead(ctx, Math.floor(t / 6) % 2 && twitch ? 'rabbit' : 'bear', { glow: true, stare: true, blackEyes: twitch });
    ctx.filter = 'none';
    ctx.restore();
    vignette(0.9);
    drawNoise(0.12 + (Math.random() < 0.06 ? 0.3 : 0));
    ctx.fillStyle = scanPattern; ctx.fillRect(0, 0, W, H);
  }

  function render(dt) {
    switch (s.screen) {
      case 'menu': drawMenuBG(); break;
      case 'playing':
        if (s.camUp) drawCamera(); else drawOffice(dt);
        if (s.camSwitch > 0) drawNoise(s.camSwitch);
        break;
      case 'jumpscare': drawJumpscare(); break;
      case 'gameover': ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); drawNoise(0.35); break;
      default: ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    }
  }

  // ================================================================
  // DOM UI
  // ================================================================
  const ui = {
    hud: $('hud'), office: $('office-ui'), cams: $('cam-ui'), toggle: $('cam-toggle'),
    time: $('time-text'), night: $('night-text'), power: $('power-text'), usage: $('usage-bars'),
    caption: $('caption'), camName: $('cam-name'),
    ldoor: $('btn-ldoor'), rdoor: $('btn-rdoor'), llight: $('btn-llight'), rlight: $('btn-rlight'),
  };
  const camButtons = {};
  const cache = new Map();
  function setText(el, v) { if (cache.get(el) !== v) { cache.set(el, v); el.textContent = v; } }
  function setHTML(el, v) { if (cache.get(el) !== v) { cache.set(el, v); el.innerHTML = v; } }

  function buildMap() {
    const svg = $('map-svg');
    let html = '';
    for (const [a, b] of MAP_LINKS) {
      const [x1, y1] = ROOMS[a].map, [x2, y2] = ROOMS[b].map;
      html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#888" stroke-width="2.2"/>`;
    }
    html += `<line x1="33" y1="82" x2="46.5" y2="92" stroke="#888" stroke-width="2.2"/>`;
    html += `<line x1="60" y1="82" x2="46.5" y2="92" stroke="#888" stroke-width="2.2"/>`;
    svg.innerHTML = html;
    const map = $('map');
    for (const id of CAM_ORDER) {
      const b = document.createElement('button');
      b.className = 'cam-btn';
      b.textContent = `CAM ${id}`;
      b.style.left = ROOMS[id].map[0] + '%';
      b.style.top = ROOMS[id].map[1] + '%';
      b.addEventListener('click', (e) => { e.stopPropagation(); selectCam(id); });
      map.appendChild(b);
      camButtons[id] = b;
    }
  }

  function updateUI() {
    const inGame = s.screen === 'playing';
    ui.hud.classList.toggle('hidden', !inGame);
    ui.office.classList.toggle('hidden', !inGame || s.camUp || s.powerOut);
    ui.cams.classList.toggle('hidden', !inGame || !s.camUp);
    ui.toggle.classList.toggle('hidden', !inGame || s.powerOut);
    if (!inGame) return;
    setText(ui.time, `${s.hour === 0 ? 12 : s.hour} AM`);
    setText(ui.night, s.custom ? 'Custom Night' : `Night ${s.night}`);
    setText(ui.power, String(Math.max(0, Math.ceil(s.power))));
    const u = s.powerOut ? 0 : s.usage;
    let bars = '';
    for (let i = 0; i < u; i++) bars += `<span class="${i < 2 ? 'u-g' : i < 4 ? 'u-y' : 'u-r'}"></span>`;
    setHTML(ui.usage, bars);
    setText(ui.caption, s.caption || '');
    ui.ldoor.classList.toggle('on', s.leftDoor);
    ui.rdoor.classList.toggle('on', s.rightDoor);
    ui.llight.classList.toggle('on', s.leftLight);
    ui.rlight.classList.toggle('on', s.rightLight);
    for (const [btn, side] of [[ui.ldoor, 'left'], [ui.llight, 'left'], [ui.rdoor, 'right'], [ui.rlight, 'right']]) {
      btn.classList.toggle('jammed', jammed(side));
    }
    if (s.camUp) {
      setText(ui.camName, `CAM ${s.cam} - ${ROOMS[s.cam].name}`);
      for (const id of CAM_ORDER) camButtons[id].classList.toggle('active', id === s.cam);
    }
  }

  // ================================================================
  // Input
  // ================================================================
  ui.ldoor.addEventListener('click', () => toggleDoor('left'));
  ui.rdoor.addEventListener('click', () => toggleDoor('right'));
  ui.llight.addEventListener('click', () => toggleLight('left'));
  ui.rlight.addEventListener('click', () => toggleLight('right'));
  ui.toggle.addEventListener('click', toggleCams);

  window.addEventListener('keydown', (e) => {
    if (e.repeat || !playing()) return;
    switch (e.code) {
      case 'Space': case 'KeyS': toggleCams(); e.preventDefault(); break;
      case 'KeyA': toggleDoor('left'); break;
      case 'KeyD': toggleDoor('right'); break;
      case 'KeyQ': toggleLight('left'); break;
      case 'KeyE': toggleLight('right'); break;
      case 'ArrowLeft': case 'ArrowRight': {
        if (!s.camUp) break;
        const i = CAM_ORDER.indexOf(s.cam);
        const n = CAM_ORDER.length;
        selectCam(CAM_ORDER[(i + (e.code === 'ArrowRight' ? 1 : n - 1)) % n]);
        e.preventDefault();
        break;
      }
    }
  });
  document.addEventListener('pointerdown', () => Snd.init());

  function refreshMenu() {
    const p = loadProgress();
    const btn = $('btn-continue');
    btn.textContent = `Continue - Night ${p.night}`;
    btn.classList.toggle('hidden', !p.night || p.night <= 1);
  }
  function goMenu() {
    Snd.stopAll();
    s = { screen: 'menu' };
    refreshMenu();
    showScreen('menu');
  }

  $('btn-new').addEventListener('click', () => startNight(1));
  $('btn-continue').addEventListener('click', () => startNight(loadProgress().night || 1));
  $('btn-custom-toggle').addEventListener('click', () => { $('custom-panel').classList.toggle('hidden'); $('howto-panel').classList.add('hidden'); });
  $('btn-howto-toggle').addEventListener('click', () => { $('howto-panel').classList.toggle('hidden'); $('custom-panel').classList.add('hidden'); });
  $('btn-custom-start').addEventListener('click', () => {
    const v = (id) => clamp(parseInt($(id).value, 10) || 0, 0, 20);
    startNight(7, { patches: v('ai-patches'), clank: v('ai-clank'), grinlo: v('ai-grinlo'), mimi: v('ai-mimi') });
  });
  $('btn-retry').addEventListener('click', () => startNight(s.night, s.custom));
  $('btn-menu1').addEventListener('click', goMenu);
  $('btn-menu2').addEventListener('click', goMenu);
  $('btn-next').addEventListener('click', () => startNight(s.night + 1));

  // ================================================================
  // Main loop
  // ================================================================
  buildMap();
  refreshMenu();
  window.__nightShiftDebug = () => s;
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    update(dt);
    render(dt);
    updateUI();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
