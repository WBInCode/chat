// Notification sounds, synthesized at runtime via the Web Audio API.
//
// Deliberately NOT an audio file: every tone below is generated from sine
// oscillators in the browser, so there is nothing to license or attribute —
// no external asset is downloaded, bundled, or played back. This sidesteps
// the "royalty-free but still copyrighted" question entirely.
//
// Autoplay note: browsers block audio until a user gesture has occurred on
// the page. By the time any of these fire, the user has already logged in
// (a click), so the AudioContext can resume without issue; the resume call
// is still wrapped defensively in case it hasn't.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/**
 * Wspólne wzmocnienie wszystkich powiadomień. Dotychczasowe szczyty rzędu 0,15
 * ginęły w hałasie biura. Trzymamy zapas do 1,0, bo tony częściowo na siebie
 * nachodzą i suma nie może przesterować.
 */
const GLOSNOSC = 2.4;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** Wyjście z ogranicznikiem, żeby podbita głośność nie trzeszczała przy nakładaniu tonów. */
function getMaster(c: AudioContext): GainNode {
  if (master && master.context === c) return master;
  const gain = c.createGain();
  gain.gain.value = GLOSNOSC;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  gain.connect(limiter).connect(c.destination);
  master = gain;
  return gain;
}

/** One short sine tone with a soft attack/decay so it never clicks or pops. */
function tone(c: AudioContext, freq: number, startAt: number, duration: number, peakGain = 0.16) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(getMaster(c));
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Soft two-note "ping" for a new incoming message (not your own, not muted). */
export function playMessageChime() {
  const c = getContext();
  if (!c) return;
  const t = c.currentTime;
  tone(c, 880, t, 0.12, 0.15);
  tone(c, 1318.5, t + 0.09, 0.16, 0.12);
}

/** Bright three-note "chime" used for direct mentions/DMs (a touch louder than the plain ping). */
export function playMentionChime() {
  const c = getContext();
  if (!c) return;
  const t = c.currentTime;
  tone(c, 987.77, t, 0.1, 0.17);
  tone(c, 1244.5, t + 0.08, 0.1, 0.17);
  tone(c, 1567.98, t + 0.16, 0.2, 0.15);
}

let ringInterval: ReturnType<typeof setInterval> | null = null;

/** Classic alternating two-tone ring, repeating until stopRing() is called (incoming voice call). */
export function startRing() {
  stopRing();
  const c = getContext();
  if (!c) return;
  const ringOnce = () => {
    const ctxNow = getContext();
    if (!ctxNow) return;
    const t = ctxNow.currentTime;
    // Dzwonek ma przebić się przez rozmowę w pokoju, więc jest wyraźnie
    // mocniejszy od zwykłego powiadomienia. Tony się nie nakładają.
    tone(ctxNow, 987.77, t, 0.35, 0.34);
    tone(ctxNow, 1174.66, t + 0.4, 0.35, 0.34);
  };
  ringOnce();
  ringInterval = setInterval(ringOnce, 1800);
}

export function stopRing() {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
}
