/**
 * Procedural valley audio (WebAudio, no files): a cute tune per season, a night lullaby, the café's Street Bossa,
 * and little farm sounds. Nothing plays until the player's first gesture. `stream()` feeds the mix to the clip
 * recorder, so saved videos carry the music.
 */
import type { Season } from "./data.ts";

export type TrackId = "auto" | "sprouts" | "bossa" | "harvest" | "snowglobe" | "fireflies";
type Chord = readonly number[];
type Voice = "kalimba" | "epiano" | "musicbox" | "vibes";
type Track = Readonly<{ id: Exclude<TrackId, "auto">; name: string; mood: string; bpm: number; swing: boolean; bossa?: boolean; lead: Voice; chords: readonly Chord[]; melody: readonly (number | null)[] }>;

const Q: Record<string, readonly number[]> = {
  maj: [0, 4, 7], maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14], dom7: [0, 4, 7, 10], dom13: [0, 4, 10, 14, 21],
  dom7b9: [0, 4, 10, 13], m7b5: [0, 3, 6, 10], six9: [0, 4, 9, 14], sus: [0, 5, 7], add9: [0, 4, 7, 14],
};
const NOTE: Record<string, number> = { C: 36, Db: 37, D: 38, Eb: 39, E: 40, F: 41, Gb: 42, G: 43, Ab: 44, A: 45, Bb: 46, B: 47 };
const chord = (name: string): Chord => { const match = /^([A-G]b?)(.*)$/.exec(name)!; return [NOTE[match[1]], ...Q[match[2]]]; };
/** A fixed, singable melody: scale degrees (semitones above the key's middle octave) per eighth, null for a rest. */
const tune = (text: string) => text.trim().split(/\s+/).map(token => token === "." ? null : Number(token));

export const TRACKS: readonly Track[] = [
  { id: "sprouts", name: "Morning Sprouts", mood: "Spring · bouncy kalimba", bpm: 104, swing: true, lead: "kalimba",
    chords: ["Cadd9", "Am7", "Fmaj7", "Gsus"].map(chord),
    melody: tune("7 . 9 12 . 9 7 . | 4 . 7 9 . . . . | 5 . 9 12 14 12 9 . | 7 . 4 2 . . . .".replace(/\|/g, "")) },
  { id: "bossa", name: "Street Bossa", mood: "Summer · the café's bossa nova", bpm: 128, swing: false, bossa: true, lead: "vibes",
    chords: ["Am9", "Ddom13", "Gmaj7", "Cmaj7", "Gbm7b5", "Bdom7b9", "Em9", "Em9"].map(chord),
    melody: tune("19 . 17 . 15 . . 14 | 12 . . 10 12 . . . | 17 . 15 . 14 . 12 . | 10 . . . . . . . | 15 . 14 . 12 . 9 . | 14 . . 12 . . . . | 10 . 12 . 14 15 14 . | 7 . . . . . . .".replace(/\|/g, "")) },
  { id: "harvest", name: "Harvest Moon Waltz", mood: "Autumn · mellow and warm", bpm: 88, swing: true, lead: "epiano",
    chords: ["Fmaj7", "Dm7", "Bbmaj7", "Cdom7"].map(chord),
    melody: tune("12 . 9 . 7 . 4 . | 5 . . 9 12 . . . | 14 . 12 . 9 . 7 . | 7 . 5 . 4 . . .".replace(/\|/g, "")) },
  { id: "snowglobe", name: "Snowglobe", mood: "Winter · tinkly music box", bpm: 76, swing: false, lead: "musicbox",
    chords: ["Ebmaj7", "Cm7", "Abmaj7", "Bbdom7"].map(chord),
    melody: tune("19 . 16 14 . 12 . . | 16 . 12 . 9 . . . | 17 . 16 12 . 16 17 . | 14 . . . . . . .".replace(/\|/g, "")) },
  { id: "fireflies", name: "Firefly Lullaby", mood: "Night · soft vibraphone", bpm: 62, swing: true, lead: "vibes",
    chords: ["Dbmaj9", "Bbm7", "Gbmaj7", "Absix9"].map(chord),
    melody: tune("12 . . 9 7 . . . | 5 . . . 7 . 9 . | 11 . . 9 7 . . . | 4 . . . . . . .".replace(/\|/g, "")) },
];
const SEASON_TRACK: Record<Season, Exclude<TrackId, "auto">> = { spring: "sprouts", summer: "bossa", autumn: "harvest", winter: "snowglobe" };
export const trackFor = (choice: TrackId, season: Season, night: boolean): Exclude<TrackId, "auto"> => choice !== "auto" ? choice : night ? "fireflies" : SEASON_TRACK[season];
export const trackName = (id: Exclude<TrackId, "auto">) => TRACKS.find(track => track.id === id)!.name;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class ValleyAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private musicBus!: GainNode; private sfxBus!: GainNode; private output!: GainNode; private noise!: AudioBuffer;
  private recorder: MediaStreamAudioDestinationNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0; private step = 0; private lastSfx = new Map<string, number>();
  track: Exclude<TrackId, "auto"> = "sprouts"; musicOn = true; sfxOn = true; muted = false; volume = 0.6;

  /** Create or resume the audio context from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      const ctx = this.ctx = new Context();
      // Master → gentle compressor → make-up gain: loud enough for laptop and phone speakers without clipping.
      const glue = ctx.createDynamicsCompressor(); this.output = ctx.createGain();
      glue.threshold.value = -18; glue.knee.value = 10; glue.ratio.value = 4; glue.attack.value = 0.004; glue.release.value = 0.25;
      this.output.gain.value = 1.3; glue.connect(this.output).connect(ctx.destination);
      this.master = ctx.createGain(); this.master.connect(glue);
      const warmth = ctx.createBiquadFilter(); warmth.type = "lowpass"; warmth.frequency.value = 6000; warmth.connect(this.master);
      this.musicBus = ctx.createGain(); this.musicBus.connect(warmth);
      this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
      this.applyLevels();
    }
    // iOS: play through the ringer switch like media, and prime output with a silent buffer inside the gesture.
    try { const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession; if (session) session.type = "playback"; } catch { /* unsupported */ }
    if (this.ctx.state !== "running") {
      const primer = this.ctx.createBufferSource(); primer.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate); primer.connect(this.ctx.destination); primer.start();
      void this.ctx.resume().catch(() => { /* retried on the next gesture */ });
    }
    this.syncMusic();
  }
  get running() { return this.ctx?.state === "running"; }
  /** The mixed output as a MediaStream for the clip recorder (null before audio starts). */
  stream(): MediaStream | null {
    if (!this.ctx) return null;
    if (!this.recorder) { this.recorder = this.ctx.createMediaStreamDestination(); this.output.connect(this.recorder); }
    return this.recorder.stream;
  }
  setMuted(muted: boolean) { this.muted = muted; this.applyLevels(); this.syncMusic(); }
  setMusic(on: boolean) { this.musicOn = on; this.applyLevels(); this.syncMusic(); }
  setSfx(on: boolean) { this.sfxOn = on; this.applyLevels(); }
  setVolume(volume: number) { this.volume = Math.max(0, Math.min(1, volume)); this.applyLevels(); }
  setTrack(track: Exclude<TrackId, "auto">) { if (track !== this.track) { this.track = track; this.step = 0; } this.syncMusic(); }
  dispose() { if (this.timer) clearInterval(this.timer); this.timer = null; void this.ctx?.close(); this.ctx = null; this.recorder = null; }

  private applyLevels() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicOn ? 1.1 : 0, now, 0.2);
    this.sfxBus.gain.setTargetAtTime(this.sfxOn ? 1 : 0, now, 0.02);
  }
  private syncMusic() {
    const playing = Boolean(this.ctx && this.musicOn && !this.muted);
    if (playing && !this.timer) { this.nextTime = this.ctx!.currentTime + 0.1; this.timer = setInterval(() => this.schedule(), 50); }
    if (!playing && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // ---------- Instruments ----------
  private envelope(gain: GainNode, t: number, peak: number, attack: number, decay: number) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  private osc(type: OscillatorType, frequency: number, t: number, length: number, peak: number, bus: AudioNode, attack = 0.005) {
    const ctx = this.ctx!, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.value = frequency; osc.connect(gain).connect(bus);
    this.envelope(gain, t, peak, attack, length); osc.start(t); osc.stop(t + attack + length + 0.05);
    return osc;
  }
  /** Kalimba: a bright sine with a quick metallic overtone. */
  private kalimba(midi: number, t: number, length: number, velocity = 1) {
    this.osc("sine", hz(midi), t, length * 1.6, 0.16 * velocity, this.musicBus, 0.003);
    this.osc("sine", hz(midi) * 5.4, t, 0.08, 0.03 * velocity, this.musicBus, 0.002);
  }
  private musicbox(midi: number, t: number, length: number, velocity = 1) {
    this.osc("sine", hz(midi), t, length * 2.2, 0.13 * velocity, this.musicBus, 0.002);
    this.osc("triangle", hz(midi) * 2, t, length * 0.8, 0.04 * velocity, this.musicBus, 0.002);
    this.osc("sine", hz(midi) * 4.2, t, 0.12, 0.02 * velocity, this.musicBus, 0.002);
  }
  /** Rhodes-like electric piano: a sine carrier with a gentle FM bark. */
  private epiano(midi: number, t: number, length: number, velocity: number) {
    const ctx = this.ctx!, f = hz(midi), carrier = ctx.createOscillator(), modulator = ctx.createOscillator(), depth = ctx.createGain(), gain = ctx.createGain();
    carrier.frequency.value = f; modulator.frequency.value = f * 2; depth.gain.setValueAtTime(f * 1.2, t); depth.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.4);
    modulator.connect(depth).connect(carrier.frequency); carrier.connect(gain).connect(this.musicBus);
    this.envelope(gain, t, 0.08 * velocity, 0.008, length);
    carrier.start(t); modulator.start(t); carrier.stop(t + length + 0.1); modulator.stop(t + length + 0.1);
  }
  private vibes(midi: number, t: number, length: number, velocity = 1) {
    const ctx = this.ctx!, gain = ctx.createGain(), tremolo = ctx.createOscillator(), depth = ctx.createGain(), mix = ctx.createGain();
    tremolo.frequency.value = 5.5; depth.gain.value = 0.35; tremolo.connect(depth).connect(mix.gain);
    for (const [ratio, level] of [[1, 1], [4, 0.18], [10, 0.05]]) {
      const osc = ctx.createOscillator(), partial = ctx.createGain(); osc.frequency.value = hz(midi) * ratio; partial.gain.value = level;
      osc.connect(partial).connect(mix); osc.start(t); osc.stop(t + length + 0.1);
    }
    mix.connect(gain).connect(this.musicBus);
    this.envelope(gain, t, 0.08 * velocity, 0.004, length);
    tremolo.start(t); tremolo.stop(t + length + 0.1);
  }
  private lead(voice: Voice, midi: number, t: number, length: number) {
    if (voice === "kalimba") this.kalimba(midi, t, length);
    else if (voice === "musicbox") this.musicbox(midi, t, length);
    else if (voice === "epiano") this.epiano(midi, t, length * 1.4, 1.1);
    else this.vibes(midi, t, length * 1.6, 1);
  }
  private bass(midi: number, t: number, length: number, level = 0.3) {
    const ctx = this.ctx!, osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    osc.type = "triangle"; osc.frequency.value = hz(midi); filter.type = "lowpass"; filter.frequency.value = 560;
    osc.connect(filter).connect(gain).connect(this.musicBus);
    this.envelope(gain, t, level, 0.012, length);
    osc.start(t); osc.stop(t + length + 0.05);
  }
  private hiss(t: number, length: number, frequency: number, level: number, bus: AudioNode, type: BiquadFilterType = "highpass", q = 0.7) {
    const ctx = this.ctx!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noise; filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    source.connect(filter).connect(gain).connect(bus);
    this.envelope(gain, t, level, 0.004, length);
    source.start(t, Math.random() * 0.5); source.stop(t + length + 0.05);
  }
  private kick(t: number, level = 0.24) {
    const ctx = this.ctx!, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.setValueAtTime(110, t); osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    osc.connect(gain).connect(this.musicBus); this.envelope(gain, t, level, 0.005, 0.22); osc.start(t); osc.stop(t + 0.3);
  }

  // ---------- Sequencer ----------
  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const track = TRACKS.find(item => item.id === this.track) ?? TRACKS[0], eighth = 60 / track.bpm / 2;
    // After a throttled or backgrounded tab, pick up from now instead of flooding the missed notes.
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.3) {
      const odd = this.step % 2 === 1, length = track.swing ? eighth * (odd ? 2 / 3 : 4 / 3) : eighth;
      this.play(track, this.step, this.nextTime, eighth);
      this.nextTime += length; this.step++;
    }
  }
  private play(track: Track, step: number, t: number, eighth: number) {
    const bar = Math.floor(step / 8), inBar = step % 8, onBeat = inBar % 2 === 0;
    const current = track.chords[bar % track.chords.length], next = track.chords[(bar + 1) % track.chords.length];
    const root = current[0], tones = current.slice(1), key = track.chords[0][0] + 24;
    // The tune: a fixed melody over the changes, so each track is recognisable.
    const note = track.melody[step % track.melody.length];
    if (note !== null && note !== undefined) this.lead(track.lead, key + note, t, eighth * 1.6);
    if (track.bossa) {
      if (inBar === 0) this.bass(root, t, eighth * 2.6);
      if (inBar === 3) this.bass(root + 7, t, eighth * 0.9);
      if (inBar === 4) this.bass(root + 7, t, eighth * 1.8);
      if (inBar === 7) this.bass(next[0], t, eighth * 0.9);
      if ([0, 3, 5].includes(inBar)) tones.forEach(interval => this.epiano(root + 24 + interval, t, eighth * 1.2, 0.55));
      if ([0, 3, 6, 10, 12].includes(step % 16)) this.hiss(t, 0.03, 2500, 0.09, this.musicBus, "bandpass", 4);
      this.hiss(t, 0.05, 7000, 0.025, this.musicBus);
      if (inBar === 0 && bar % 2 === 0) this.kick(t);
      return;
    }
    if (track.lead === "musicbox" || track.id === "fireflies") {
      // Gentle: a low pad note per bar and a soft broken chord.
      if (inBar === 0) { this.bass(root + 12, t, eighth * 7, 0.18); tones.forEach(interval => this.osc("sine", hz(root + 24 + interval), t, eighth * 7, 0.025, this.musicBus, 0.3)); }
      if (inBar % 4 === 2) this.lead(track.lead === "musicbox" ? "musicbox" : "vibes", root + 36 + tones[(inBar / 2) % tones.length], t, eighth * 2);
      return;
    }
    // Bouncy: bass on the beat, a strum on the offbeat, shaker and a soft kick.
    if (onBeat) this.bass(inBar === 4 ? root + 7 : root, t, eighth * 1.4, 0.26);
    else if (inBar === 3 || inBar === 7) tones.slice(0, 3).forEach(interval => this.epiano(root + 24 + interval, t, eighth * 1.2, 0.45));
    this.hiss(t, 0.04, 8000, onBeat ? 0.02 : 0.035, this.musicBus);
    if (inBar === 0) this.kick(t, 0.18);
  }

  // ---------- Sound effects ----------
  private can(name: string, gap = 0.06) {
    if (!this.ctx || !this.sfxOn || this.muted) return null;
    const now = this.ctx.currentTime;
    if (now - (this.lastSfx.get(name) ?? -1) < gap) return null;
    this.lastSfx.set(name, now);
    return now;
  }
  private tone(midi: number, t: number, length: number, level: number, type: OscillatorType = "sine", glideTo?: number) {
    const osc = this.osc(type, hz(midi), t, length, level, this.sfxBus);
    if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(hz(glideTo), t + length);
  }
  private melody(notes: readonly number[], gap: number, level = 0.16, type: OscillatorType = "triangle") {
    const t = this.ctx!.currentTime;
    notes.forEach((midi, index) => { this.tone(midi, t + index * gap, gap * 1.8, level, type); this.tone(midi + 12, t + index * gap, gap, level * 0.25); });
  }
  till() { const t = this.can("till"); if (t === null) return; this.tone(48, t, 0.12, 0.22, "sine", 38); this.hiss(t, 0.12, 900, 0.14, this.sfxBus, "lowpass"); }
  water() {
    const t = this.can("water", 0.15); if (t === null) return;
    const ctx = this.ctx!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noise; filter.type = "bandpass"; filter.Q.value = 2; filter.frequency.setValueAtTime(3200, t); filter.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    source.connect(filter).connect(gain).connect(this.sfxBus); this.envelope(gain, t, 0.22, 0.02, 0.35); source.start(t); source.stop(t + 0.45);
    for (let i = 0; i < 3; i++) this.tone(84 + i * 3, t + 0.05 + i * 0.07, 0.05, 0.05, "sine", 90 + i * 3);
  }
  plant() { const t = this.can("plant"); if (t === null) return; this.tone(67, t, 0.08, 0.14, "sine", 79); this.hiss(t, 0.05, 1500, 0.06, this.sfxBus, "lowpass"); }
  harvest(golden: boolean) {
    const t = this.can("harvest", 0.08); if (t === null) return;
    this.tone(62, t, 0.08, 0.18, "sine", 86);
    [79, 83, 86].forEach((midi, index) => this.tone(midi, t + 0.06 + index * 0.05, 0.12, 0.08, "triangle"));
    if (golden) [91, 95, 98, 103].forEach((midi, index) => this.tone(midi, t + 0.2 + index * 0.06, 0.25, 0.07, "sine"));
  }
  clear() { const t = this.can("clear"); if (t === null) return; this.hiss(t, 0.1, 2400, 0.2, this.sfxBus, "bandpass", 3); this.tone(45, t, 0.14, 0.16, "triangle", 36); }
  refill() { const t = this.can("refill", 0.3); if (t === null) return; for (let i = 0; i < 5; i++) this.tone(60 + i * 4, t + i * 0.06, 0.07, 0.07, "sine", 70 + i * 4); }
  forage() { const t = this.can("forage"); if (t === null) return; [76, 81, 88].forEach((midi, index) => this.tone(midi, t + index * 0.05, 0.1, 0.1, "triangle")); }
  coins() { const t = this.can("coins", 0.1); if (t === null) return; for (const [index, midi] of [88, 93, 100].entries()) this.tone(midi, t + index * 0.05, 0.14, 0.07, "triangle"); }
  /** A Friend's little chirp, pitched per family. */
  chirp(family: number) {
    const t = this.can("chirp", 0.12); if (t === null) return;
    const base = 72 + (family * 3) % 10;
    this.tone(base, t, 0.07, 0.1, "square", base + 5); this.tone(base + 5, t + 0.08, 0.1, 0.08, "square", base + 12);
  }
  gift(reaction: "love" | "like" | "neutral" | "dislike") {
    if (this.can("gift", 0.3) === null) return;
    if (reaction === "love") this.melody([79, 83, 86, 91], 0.07, 0.14);
    else if (reaction === "like") this.melody([79, 84], 0.09, 0.12);
    else if (reaction === "neutral") this.melody([76], 0.1, 0.1);
    else { const t = this.ctx!.currentTime; this.tone(50, t, 0.25, 0.1, "sawtooth", 44); }
  }
  heart() { if (this.can("heart", 0.4) === null) return; this.melody([84, 88, 91, 96], 0.08, 0.13, "sine"); }
  tired() { const t = this.can("tired", 0.5); if (t === null) return; this.tone(71, t, 0.7, 0.1, "triangle", 59); this.hiss(t + 0.1, 0.5, 900, 0.04, this.sfxBus, "lowpass"); }
  exhausted() { if (this.can("exhausted", 1) === null) return; this.melody([67, 64, 60, 55], 0.14, 0.12); }
  drowsy() { const t = this.can("drowsy", 1); if (t === null) return; this.tone(64, t, 1.1, 0.09, "sine", 52); }
  travel() { const t = this.can("travel", 0.5); if (t === null) return; this.hiss(t, 0.5, 1200, 0.08, this.sfxBus, "bandpass", 1); [72, 76, 79].forEach((midi, index) => this.tone(midi, t + index * 0.08, 0.14, 0.07, "triangle")); }
  morning() { if (this.can("morning", 2) === null) return; const t = this.ctx!.currentTime; [[84, 88], [88, 91], [86, 84]].forEach(([a, b], index) => this.tone(a, t + index * 0.16, 0.12, 0.08, "sine", b)); this.melody([72, 76, 79, 84], 0.12, 0.1); }
  season() { if (this.can("season", 2) === null) return; this.melody([72, 76, 79, 84, 88, 91], 0.1, 0.14); }
  eat() { const t = this.can("eat", 0.2); if (t === null) return; for (let i = 0; i < 3; i++) this.hiss(t + i * 0.1, 0.05, 1800, 0.1, this.sfxBus, "bandpass", 2); this.tone(79, t + 0.32, 0.2, 0.08, "triangle", 84); }
  buy() { const t = this.can("buy", 0.15); if (t === null) return; this.tone(88, t, 0.1, 0.1, "triangle"); this.tone(96, t + 0.08, 0.3, 0.09, "sine"); }
  place() { const t = this.can("place"); if (t === null) return; this.tone(50, t, 0.12, 0.2, "sine", 40); this.hiss(t, 0.05, 1200, 0.06, this.sfxBus, "lowpass"); }
  request() { if (this.can("request", 0.5) === null) return; this.melody([72, 76, 79, 84, 79, 84], 0.08, 0.13); }
  shutter() { const t = this.can("shutter", 0.2); if (t === null) return; this.hiss(t, 0.03, 3000, 0.22, this.sfxBus, "bandpass", 1); this.hiss(t + 0.07, 0.04, 2400, 0.18, this.sfxBus, "bandpass", 1); }
  bump() { const t = this.can("bump", 0.25); if (t === null) return; this.tone(55, t, 0.12, 0.1, "triangle", 50); }
  crank() { const t = this.can("crank", 0.3); if (t === null) return; for (let i = 0; i < 6; i++) this.hiss(t + i * 0.07, 0.03, 3000, 0.12, this.sfxBus, "bandpass", 5); this.tone(60, t + 0.45, 0.2, 0.15, "sine", 48); }
  sparkle() { if (this.can("sparkle", 0.2) === null) return; this.melody([91, 95, 98, 103], 0.06, 0.1, "sine"); }
  select() { const t = this.can("select", 0.05); if (t === null) return; this.tone(79, t, 0.06, 0.07, "triangle"); }
}
