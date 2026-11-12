// Shared session timer — one timer for the whole room, stored on the server.
// Play / Pause / Stop / Dismiss post to /api/timer; app.js passes server state in via
// CoworkingTimer.set() on load and whenever the poll's state token changes.
// When time runs out, every pane gets the marching-ants border until someone dismisses it.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const display = $('timer-display');
  const minutesInput = $('timer-minutes');
  const playBtn = $('timer-play-btn');
  const pauseBtn = $('timer-pause-btn');
  const stopBtn = $('timer-stop-btn');
  const dismissBtn = $('timer-dismiss-btn');
  const byLine = $('timer-by');
  if (!display) return;

  // Local view of the shared timer. endAt is in this browser's clock (derived from remaining_ms).
  // status: 'idle' | 'running' | 'paused' | 'done'
  let t = { status: 'idle', endAt: 0, remainingMs: 0, minutes: 25, by: null };
  let tick = null;
  let busy = false;

  function inputMs() {
    const m = Math.min(600, Math.max(1, Math.round(Number(minutesInput.value) || 25)));
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
    return inputMs();
  }

  // Alarm sound: plays once when the timer reaches zero (not on page load if it already had)
  const alarm = new Audio('/sounds/timer-done.mp3');
  alarm.preload = 'auto';
  // Mute NTS while the alarm plays, then bring it back
  const muteRadio = (m) => window.CoworkingRadio && window.CoworkingRadio.setMuted(m);
  alarm.addEventListener('play', () => muteRadio(true));
  alarm.addEventListener('pause', () => muteRadio(false));
  alarm.addEventListener('ended', () => muteRadio(false));
  let lastStatus = null;
  function updateSound() {
    if (t.status === 'done' && lastStatus !== null && lastStatus !== 'done') {
      alarm.currentTime = 0;
      alarm.play().catch(() => {}); // browsers may block sound until the page has been clicked once
    } else if (t.status !== 'done' && !alarm.paused) {
      alarm.pause(); // dismissed or restarted
    }
    lastStatus = t.status;
  }

  function render() {
    // Reaching zero flips to done locally; the server reports the same once anyone reloads
    if (t.status === 'running' && remaining() <= 0) t = { ...t, status: 'done' };
    display.textContent = fmt(remaining());
    playBtn.disabled = busy || t.status === 'running';
    pauseBtn.disabled = busy || t.status !== 'running';
    stopBtn.disabled = busy || t.status === 'idle';
    minutesInput.disabled = t.status === 'running' || t.status === 'paused';
    dismissBtn.hidden = t.status !== 'done';
    dismissBtn.disabled = busy;
    document.body.classList.toggle('timer-alarm', t.status === 'done');
    updateSound();

    const verb = { running: 'Started', paused: 'Paused', done: 'Started' }[t.status];
    byLine.hidden = !(verb && t.by);
    if (verb && t.by) byLine.textContent = `${verb} by ${t.by}`;

    if (t.status === 'running') { if (!tick) tick = setInterval(render, 250); }
    else { clearInterval(tick); tick = null; }
  }

  // Server state → local view
  function set(timer) {
    if (!timer) return;
    t = {
      status: timer.status,
      endAt: timer.status === 'running' ? Date.now() + (timer.remaining_ms || 0) : 0,
      remainingMs: timer.remaining_ms || 0,
      minutes: timer.minutes || 25,
      by: timer.updated_by_username || null
    };
    // Show the shared duration, unless someone is typing a new one
    if (document.activeElement !== minutesInput) minutesInput.value = String(t.minutes);
    render();
  }

  async function send(action) {
    busy = true; render();
    try {
      const res = await fetch('/api/timer', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, minutes: Math.round(inputMs() / 60000) })
      });
      if (res.status === 401) { window.location.href = '/login.html'; return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      busy = false;
      set(data.timer);
    } catch (e) {
      alert(e.message);
    } finally {
      busy = false; render();
    }
  }

  playBtn.addEventListener('click', () => send('play'));
  pauseBtn.addEventListener('click', () => send('pause'));
  stopBtn.addEventListener('click', () => send('stop'));
  dismissBtn.addEventListener('click', () => send('dismiss'));
  minutesInput.addEventListener('input', () => { if (t.status === 'idle') display.textContent = fmt(inputMs()); });

  window.CoworkingTimer = { set };
  render();
})();
