/**
 * playSound.ts
 *
 * Browser-side Web Audio API helpers for the play_sound workflow node.
 * Handles three sources:
 *   1. Preset names  — built-in synthesised tones
 *   2. Custom URL    — fetch and decode audio file via AudioContext
 *   3. AI params     — synthesise from parameters returned by the server
 */

export type WaveformType = "sine" | "square" | "sawtooth" | "triangle";

export interface SoundNote {
  frequency: number;
  startTime: number;
  duration: number;
  gain: number;
}

export interface SoundEnvelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface SoundParams {
  waveform: WaveformType;
  notes: SoundNote[];
  totalDuration: number;
  envelope: SoundEnvelope;
}

export type SoundSource =
  | { type: "preset"; preset: string }
  | { type: "url"; url: string }
  | { type: "params"; params: SoundParams };

const PRESETS: Record<string, SoundParams> = {
  success: {
    waveform: "sine",
    totalDuration: 0.8,
    envelope: { attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.2 },
    notes: [
      { frequency: 523.25, startTime: 0,    duration: 0.18, gain: 0.5 },
      { frequency: 659.25, startTime: 0.18, duration: 0.18, gain: 0.5 },
      { frequency: 783.99, startTime: 0.36, duration: 0.30, gain: 0.6 },
    ],
  },
  error: {
    waveform: "square",
    totalDuration: 0.7,
    envelope: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.15 },
    notes: [
      { frequency: 440,    startTime: 0,    duration: 0.15, gain: 0.55 },
      { frequency: 415.30, startTime: 0.18, duration: 0.15, gain: 0.55 },
      { frequency: 392.00, startTime: 0.36, duration: 0.20, gain: 0.6  },
    ],
  },
  alert: {
    waveform: "sawtooth",
    totalDuration: 0.6,
    envelope: { attack: 0.01, decay: 0.08, sustain: 0.6, release: 0.1 },
    notes: [
      { frequency: 880, startTime: 0,    duration: 0.18, gain: 0.5 },
      { frequency: 880, startTime: 0.22, duration: 0.18, gain: 0.5 },
    ],
  },
  ping: {
    waveform: "sine",
    totalDuration: 0.4,
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.2 },
    notes: [
      { frequency: 1046.5, startTime: 0, duration: 0.3, gain: 0.45 },
    ],
  },
  fanfare: {
    waveform: "triangle",
    totalDuration: 1.2,
    envelope: { attack: 0.02, decay: 0.08, sustain: 0.7, release: 0.25 },
    notes: [
      { frequency: 523.25, startTime: 0,    duration: 0.18, gain: 0.5 },
      { frequency: 659.25, startTime: 0.18, duration: 0.18, gain: 0.5 },
      { frequency: 783.99, startTime: 0.36, duration: 0.18, gain: 0.55 },
      { frequency: 1046.5, startTime: 0.54, duration: 0.18, gain: 0.55 },
      { frequency: 1318.5, startTime: 0.72, duration: 0.35, gain: 0.6  },
    ],
  },
};

function playSoundParams(params: SoundParams): void {
  try {
    const ctx = new AudioContext();
    void ctx.resume().then(() => {
      const now = ctx.currentTime;
      for (const note of params.notes) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = params.waveform;
        osc.frequency.value = note.frequency;
        const t0 = now + note.startTime;
        const t1 = t0 + params.envelope.attack;
        const t2 = t0 + note.duration;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(note.gain, t1);
        gain.gain.setValueAtTime(note.gain * params.envelope.sustain, t2 - params.envelope.decay);
        gain.gain.exponentialRampToValueAtTime(0.001, t2 + params.envelope.release);
        osc.start(t0);
        osc.stop(t2 + params.envelope.release + 0.05);
      }
      setTimeout(() => { void ctx.close(); }, (params.totalDuration + 1) * 1000);
    });
  } catch {
    // AudioContext unavailable — silently skip
  }
}

async function playUrl(url: string): Promise<void> {
  try {
    const ctx = new AudioContext();
    const response = await fetch(url);
    const arrayBuf = await response.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    const source = ctx.createBufferSource();
    source.buffer = audioBuf;
    source.connect(ctx.destination);
    source.start();
    source.onended = () => { void ctx.close(); };
  } catch {
    // network or decode error — silently skip
  }
}

/**
 * playSoundFromParams
 *
 * Main entry point for the play_sound workflow node.
 * Accepts a source descriptor and plays the corresponding audio.
 */
export async function playSoundFromParams(source: SoundSource): Promise<void> {
  switch (source.type) {
    case "preset": {
      const params = PRESETS[source.preset] ?? PRESETS.ping;
      playSoundParams(params);
      break;
    }
    case "url": {
      await playUrl(source.url);
      break;
    }
    case "params": {
      playSoundParams(source.params);
      break;
    }
  }
}
