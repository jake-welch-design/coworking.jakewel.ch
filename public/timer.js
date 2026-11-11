// Session timer — Play / Pause / Stop with a minutes input.
// When time runs out, every pane gets a flashing dotted border until Dismiss is pressed.
// Per-browser only; survives reloads via localStorage.

(function () {
  'use strict';

  const STORAGE_KEY = 'coworking.timer.v1';
  const $ = (id) => document.getElementById(id);
  const display = $('timer-display');
  const minutesInput = $('timer-minutes');
  const playBtn = $('timer-play-btn');
  const pauseBtn = $('timer-pause-btn');
  const stopBtn = $('timer-stop-btn');
  const dismissBtn = $('timer-dismiss-btn');
  if (!display) return;

  // status: 'idle' | 'running' | 'paused' | 'done'
  let t = load();
  let tick = null;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (s && ['idle', 'running', 'paused', 'done'].includes(s.status)) return s;
    } catch {}
    return { status: 'idle', endAt: 0, remainingMs: 0, minutes: 25 };
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(t)); } catch {}
  }

  // Clamped duration from the input; only rewrites the field when asked (not while typing)
  function durationMs(normalize = false) {
    const m = Math.min(600, Math.max(1, Math.round(Number(minutesInput.value) || 25)));
    if (normalize) minutesInput.value = String(m);
    return m * 60000;
  }

  function fmt(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function remaining() {
    if (t.status === 'running') return t.endAt - Date.now();
    if (t.status === 'paused') return t.remainingMs;
    if (t.status === 'done') return 0;
    return durationMs();
  }

  function render() {
    if (t.status === 'running' && remaining() <= 0) finish();
    display.textContent = fmt(remaining());
    playBtn.disabled = t.status === 'running';
    pauseBtn.disabled = t.status !== 'running';
    stopBtn.disabled = t.status === 'idle';
    minutesInput.disabled = t.status === 'running' || t.status === 'paused';
    dismissBtn.hidden = t.status !== 'done';
    document.body.classList.toggle('timer-alarm', t.status === 'done');
  }

  function startTicking() {
    if (!tick) tick = setInterval(render, 250);
  }

  function stopTicking() {
    clearInterval(tick); tick = null;
  }

  function finish() {
    t = { ...t, status: 'done', endAt: 0, remainingMs: 0 };
    stopTicking(); save();
  }

  function reset() {
    t = { status: 'idle', endAt: 0, remainingMs: 0, minutes: Number(minutesInput.value) || 25 };
    stopTicking(); save(); render();
  }

  playBtn.addEventListener('click', () => {
    const ms = t.status === 'paused' ? t.remainingMs : durationMs(true);
    t = { status: 'running', endAt: Date.now() + ms, remainingMs: 0, minutes: Number(minutesInput.value) };
    save(); startTicking(); render();
  });

  pauseBtn.addEventListener('click', () => {
    if (t.status !== 'running') return;
    t = { ...t, status: 'paused', remainingMs: Math.max(0, t.endAt - Date.now()), endAt: 0 };
    stopTicking(); save(); render();
  });

  stopBtn.addEventListener('click', reset);
  dismissBtn.addEventListener('click', reset);
  minutesInput.addEventListener('input', () => { if (t.status === 'idle') display.textContent = fmt(durationMs()); });

  if (t.minutes) minutesInput.value = String(t.minutes);
  if (t.status === 'running') startTicking();
  render();
})();
