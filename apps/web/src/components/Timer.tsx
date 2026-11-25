import { Pause, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Tip } from "./Tip";

/**
 * A countdown timer or stopwatch floating over the board, for exercises and presentations.
 * It ends with a soft chime (made with Web Audio, no sound files). Not saved with the board.
 */
type Mode = "timer" | "stopwatch";
interface TimerState {
  open: boolean;
  mode: Mode;
  /** The countdown length (ms). */
  duration: number;
  /** Running since (performance.now()), or null when paused. */
  since: number | null;
  /** Time counted before the current run (ms). */
  banked: number;
  /** The countdown reached zero. */
  done: boolean;
}

const PRESETS = [1, 3, 5, 10];
let state: TimerState = { open: false, mode: "timer", duration: 5 * 60_000, since: null, banked: 0, done: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<TimerState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export const timer = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  toggle() {
    set({ open: !state.open });
  },
};

export function useTimerOpen(): boolean {
  return useSyncExternalStore(timer.subscribe, () => state.open);
}

const elapsed = (s: TimerState, now: number) => s.banked + (s.since !== null ? now - s.since : 0);

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

let audio: AudioContext | null = null;
/** Three soft rising notes. The context is created on the click that starts the timer. */
function chime(): void {
  if (!audio) return;
  const t0 = audio.currentTime + 0.05;
  [660, 880, 1320].forEach((f, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    const t = t0 + i * 0.22;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 1);
  });
}

function start(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    /* no sound available: the timer still works */
  }
  if (state.mode === "timer" && (state.done || elapsed(state, performance.now()) >= state.duration)) set({ banked: 0, done: false });
  set({ since: performance.now() });
}
const pause = () => set({ banked: elapsed(state, performance.now()), since: null });
const reset = () => set({ banked: 0, since: null, done: false });

export function Timer() {
  const s = useSyncExternalStore(timer.subscribe, timer.get);
  const [now, setNow] = useState(() => performance.now());

  // Tick while running; ring once at zero.
  useEffect(() => {
    if (!s.open || s.since === null) return;
    const id = setInterval(() => {
      const t = performance.now();
      setNow(t);
      if (state.mode === "timer" && !state.done && elapsed(state, t) >= state.duration) {
        set({ banked: state.duration, since: null, done: true });
        chime();
      }
    }, 200);
    return () => clearInterval(id);
  }, [s.open, s.since]);

  if (!s.open) return null;
  const running = s.since !== null;
  const spent = elapsed(s, running ? now : performance.now());
  const shown = s.mode === "timer" ? s.duration - spent : spent;
  const progress = s.mode === "timer" ? Math.min(1, spent / s.duration) : 0;

  return (
    <div className="panel timer" role="timer" aria-label={s.mode === "timer" ? "Timer" : "Stopwatch"} data-done={s.done || undefined}>
      <div className="timer-top">
        <div className="segmented timer-mode" role="radiogroup" aria-label="Mode">
          {(["timer", "stopwatch"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={s.mode === m} onClick={() => set({ mode: m, banked: 0, since: null, done: false })}>
              {m === "timer" ? "Timer" : "Stopwatch"}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" aria-label="Close timer" onClick={() => set({ open: false })}>
          <X size={15} strokeWidth={1.9} />
        </button>
      </div>
      <div className="timer-digits" aria-live={s.done ? "assertive" : "off"}>
        {s.done ? "Time’s up" : format(shown)}
      </div>
      {s.mode === "timer" && <div className="timer-bar" style={{ transform: `scaleX(${1 - progress})` }} aria-hidden="true" />}
      <div className="timer-controls">
        <button type="button" className="btn primary timer-go" onClick={running ? pause : start}>
          {running ? <Pause size={15} strokeWidth={2} /> : <Play size={15} strokeWidth={2} />}
          {running ? "Pause" : spent > 0 && !s.done ? "Resume" : "Start"}
        </button>
        <button type="button" className="icon-btn" aria-label="Reset" onClick={reset} disabled={spent === 0 && !s.done}>
          <RotateCcw size={15} strokeWidth={1.9} />
          <Tip label="Reset" side="bottom" />
        </button>
      </div>
      {s.mode === "timer" && (
        <div className="timer-presets" role="group" aria-label="Length">
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={s.duration === m * 60_000}
              onClick={() => set({ duration: m * 60_000, banked: 0, since: running ? performance.now() : null, done: false })}
            >
              {m} min
            </button>
          ))}
          <button type="button" aria-label="One minute less" disabled={s.duration <= 60_000} onClick={() => set({ duration: Math.max(60_000, s.duration - 60_000), done: false })}>
            −1
          </button>
          <button type="button" aria-label="One minute more" disabled={s.duration >= 180 * 60_000} onClick={() => set({ duration: s.duration + 60_000, done: false })}>
            +1
          </button>
        </div>
      )}
    </div>
  );
}
