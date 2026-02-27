import { useCallback, useRef, useState } from "react";

export type SoundType =
  | "move"
  | "capture"
  | "check"
  | "castle"
  | "checkmate"
  | "gameStart"
  | "gameEnd"
  | "illegal";

const STORAGE_KEY = "chess-sound-muted";

function getInitialMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useChessSound() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [muted, setMuted] = useState(getInitialMuted);

  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const playTone = useCallback(
    (
      type: OscillatorType,
      freq: number,
      duration: number,
      freqEnd?: number,
      startTime?: number,
      gain?: number,
    ) => {
      const ctx = getCtx();
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + (startTime ?? 0));
      if (freqEnd !== undefined) {
        osc.frequency.linearRampToValueAtTime(
          freqEnd,
          ctx.currentTime + (startTime ?? 0) + duration,
        );
      }
      vol.gain.setValueAtTime(gain ?? 0.15, ctx.currentTime + (startTime ?? 0));
      vol.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + (startTime ?? 0) + duration,
      );
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.start(ctx.currentTime + (startTime ?? 0));
      osc.stop(ctx.currentTime + (startTime ?? 0) + duration);
    },
    [getCtx],
  );

  const playSound = useCallback(
    (type: SoundType) => {
      if (muted) return;
      try {
        switch (type) {
          case "move":
            playTone("square", 800, 0.05, undefined, 0, 0.1);
            break;
          case "capture":
            playTone("triangle", 200, 0.12, 100, 0, 0.2);
            break;
          case "check":
            playTone("sine", 600, 0.1, 900, 0, 0.15);
            playTone("sine", 900, 0.12, undefined, 0.1, 0.12);
            break;
          case "castle":
            playTone("square", 600, 0.06, undefined, 0, 0.1);
            playTone("square", 700, 0.06, undefined, 0.08, 0.1);
            break;
          case "checkmate":
            playTone("sine", 800, 0.15, 400, 0, 0.2);
            playTone("sine", 400, 0.25, 200, 0.15, 0.15);
            break;
          case "gameStart":
            playTone("sine", 523, 0.1, undefined, 0, 0.1);
            playTone("sine", 659, 0.1, undefined, 0.1, 0.1);
            playTone("sine", 784, 0.15, undefined, 0.2, 0.12);
            break;
          case "gameEnd":
            playTone("sine", 400, 0.15, undefined, 0, 0.12);
            playTone("sine", 300, 0.25, undefined, 0.15, 0.1);
            break;
          case "illegal":
            playTone("sawtooth", 150, 0.2, undefined, 0, 0.12);
            break;
        }
      } catch {
        // AudioContext not available
      }
    },
    [muted, playTone],
  );

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { playSound, muted, toggleMute };
}
