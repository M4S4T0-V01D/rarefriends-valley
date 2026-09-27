/**
 * Friend Films: record a few seconds of the valley as a looping GIF and, where the browser supports it, a video
 * with the music. Frames come straight from the game canvas; the audio comes from the game's own mix.
 */
import { GifRecorder } from "./gif.ts";

export const CLIP_SECONDS = 6, CLIP_MAX_SECONDS = 10, GIF_FPS = 12, GIF_WIDTH = 420;
export type Clip = { gif: Blob | null; video: Blob | null; poster: string; seconds: number; frames: number; videoType: string | null };

/** Best recordable video type: MP4 posts straight to X; WebM is the fallback. */
export function videoType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch { /* keep looking */ }
  }
  return null;
}

export class ClipRecorder {
  private gif: GifRecorder | null = null;
  private scratch: HTMLCanvasElement | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private started = 0; private lastFrame = -Infinity; private poster = "";
  private stopped: Promise<Blob | null> = Promise.resolve(null);
  recording = false;

  /** Start recording `canvas`, mixing in `audio` (the game's music) when given. */
  start(canvas: HTMLCanvasElement, audio: MediaStream | null, now: number) {
    const aspect = canvas.height / Math.max(1, canvas.width), width = Math.min(GIF_WIDTH, canvas.width), height = Math.max(2, Math.round(width * aspect / 2) * 2);
    this.gif = new GifRecorder(width, height);
    this.scratch = document.createElement("canvas"); this.scratch.width = width; this.scratch.height = height;
    this.started = now; this.lastFrame = -Infinity; this.chunks = []; this.poster = ""; this.recording = true;
    const type = videoType();
    this.recorder = null; this.stopped = Promise.resolve(null);
    if (type && typeof canvas.captureStream === "function") {
      try {
        const stream = canvas.captureStream(30);
        for (const track of audio?.getAudioTracks() ?? []) stream.addTrack(track);
        const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 3_000_000 });
        this.stopped = new Promise(resolve => {
          recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
          recorder.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: type.split(";")[0] }) : null);
          recorder.onerror = () => resolve(null);
        });
        recorder.start(500); this.recorder = recorder;
      } catch { this.recorder = null; this.stopped = Promise.resolve(null); }
    }
  }
  /** Seconds recorded so far. */
  elapsed(now: number) { return this.recording ? (now - this.started) / 1000 : 0; }
  /** Call once per rendered frame; grabs a GIF frame when one is due. Returns true when the clip hit its limit. */
  frame(canvas: HTMLCanvasElement, now: number, limit = CLIP_SECONDS): boolean {
    if (!this.recording || !this.gif || !this.scratch) return false;
    if (now - this.lastFrame >= 1000 / GIF_FPS - 4) {
      this.lastFrame = now;
      const ctx = this.scratch.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = true; ctx.drawImage(canvas, 0, 0, this.scratch.width, this.scratch.height);
      this.gif.addFrame(ctx.getImageData(0, 0, this.scratch.width, this.scratch.height).data);
      if (!this.poster && this.gif.frameCount === Math.round(GIF_FPS * 1.5)) this.poster = this.scratch.toDataURL("image/png");
    }
    return this.elapsed(now) >= limit;
  }
  /** Stop and encode. `onProgress` reports GIF encoding from 0 to 1. */
  async stop(onProgress?: (fraction: number) => void): Promise<Clip> {
    const gif = this.gif, seconds = this.gif ? this.gif.frameCount / GIF_FPS : 0;
    this.recording = false;
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    const type = this.recorder?.mimeType ?? null;
    const [video, bytes] = await Promise.all([this.stopped, gif && gif.frameCount ? gif.encode(Math.round(100 / GIF_FPS), onProgress) : Promise.resolve(null)]);
    if (!this.poster && this.scratch) this.poster = this.scratch.toDataURL("image/png");
    const frames = gif?.frameCount ?? 0;
    this.gif = null; this.recorder = null;
    return { gif: bytes ? new Blob([bytes as BlobPart], { type: "image/gif" }) : null, video, poster: this.poster, seconds, frames, videoType: type ? type.split(";")[0] : null };
  }
  cancel() { this.recording = false; if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop(); this.gif = null; this.recorder = null; }
}
