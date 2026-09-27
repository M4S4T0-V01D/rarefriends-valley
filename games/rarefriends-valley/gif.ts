/**
 * A small animated-GIF encoder (GIF89a, looping, LZW) for the clip recorder. Pure code, no dependencies.
 *
 * Frames are stored as 15-bit colour (two bytes a pixel) while recording, and a histogram of those colours is kept.
 * Encoding picks the 256 most common colours as one global palette — ideal for the valley's limited, faded palette —
 * maps every pixel to its nearest palette entry, and LZW-compresses each frame. `encode` yields to the event loop
 * between frames so the page stays responsive.
 */
export class GifRecorder {
  readonly width: number; readonly height: number;
  private frames: Uint16Array[] = [];
  private histogram = new Uint32Array(32768);

  constructor(width: number, height: number) { this.width = width; this.height = height; }
  get frameCount() { return this.frames.length; }

  /** Add one RGBA frame of exactly width × height pixels. */
  addFrame(rgba: Uint8ClampedArray | Uint8Array) {
    const pixels = this.width * this.height, frame = new Uint16Array(pixels);
    for (let i = 0, p = 0; i < pixels; i++, p += 4) {
      const color = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
      frame[i] = color;
      // Sample the histogram (every 3rd pixel) to keep recording cheap.
      if (i % 3 === 0) this.histogram[color]++;
    }
    this.frames.push(frame);
  }

  /** The 256-colour palette (RGB triples) built from the histogram. */
  palette(): Uint8Array {
    const ranked = [...this.histogram.keys()].filter(color => this.histogram[color] > 0).sort((a, b) => this.histogram[b] - this.histogram[a]).slice(0, 256);
    const palette = new Uint8Array(256 * 3);
    ranked.forEach((color, index) => {
      palette[index * 3] = ((color >> 10) & 31) * 255 / 31;
      palette[index * 3 + 1] = ((color >> 5) & 31) * 255 / 31;
      palette[index * 3 + 2] = (color & 31) * 255 / 31;
    });
    return palette;
  }

  /** Encode all frames. `delay` is in hundredths of a second per frame. */
  async encode(delay: number, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
    const palette = this.palette(), lookup = new Int16Array(32768).fill(-1), colors = palette.length / 3;
    const nearest = (color: number) => {
      const cached = lookup[color];
      if (cached >= 0) return cached;
      const r = ((color >> 10) & 31) * 255 / 31, g = ((color >> 5) & 31) * 255 / 31, b = (color & 31) * 255 / 31;
      let best = 0, bestDistance = Infinity;
      for (let index = 0; index < colors; index++) {
        const dr = palette[index * 3] - r, dg = palette[index * 3 + 1] - g, db = palette[index * 3 + 2] - b;
        const distance = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (distance < bestDistance) { bestDistance = distance; best = index; if (!distance) break; }
      }
      lookup[color] = best;
      return best;
    };
    const out = new ByteWriter();
    out.text("GIF89a"); out.u16(this.width); out.u16(this.height);
    out.byte(0xf7); out.byte(0); out.byte(0); out.bytes(palette);
    // Loop forever (NETSCAPE2.0 application extension).
    out.bytes([0x21, 0xff, 0x0b]); out.text("NETSCAPE2.0"); out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
    const indices = new Uint8Array(this.width * this.height);
    for (let frameIndex = 0; frameIndex < this.frames.length; frameIndex++) {
      const frame = this.frames[frameIndex];
      for (let i = 0; i < frame.length; i++) indices[i] = nearest(frame[i]);
      out.bytes([0x21, 0xf9, 0x04, 0x04]); out.u16(Math.max(2, Math.round(delay))); out.bytes([0x00, 0x00]);
      out.byte(0x2c); out.u16(0); out.u16(0); out.u16(this.width); out.u16(this.height); out.byte(0);
      out.byte(8);
      const data = lzwEncode(indices, 8);
      for (let offset = 0; offset < data.length; offset += 255) { const chunk = data.subarray(offset, offset + 255); out.byte(chunk.length); out.bytes(chunk); }
      out.byte(0);
      onProgress?.((frameIndex + 1) / this.frames.length);
      if (frameIndex % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
    }
    out.byte(0x3b);
    return out.result();
  }
}

class ByteWriter {
  private buffer = new Uint8Array(1 << 16); private length = 0;
  private grow(extra: number) { if (this.length + extra <= this.buffer.length) return; let size = this.buffer.length * 2; while (size < this.length + extra) size *= 2; const next = new Uint8Array(size); next.set(this.buffer.subarray(0, this.length)); this.buffer = next; }
  byte(value: number) { this.grow(1); this.buffer[this.length++] = value & 255; }
  u16(value: number) { this.byte(value); this.byte(value >> 8); }
  bytes(values: ArrayLike<number>) { this.grow(values.length); this.buffer.set(values, this.length); this.length += values.length; }
  text(value: string) { for (const char of value) this.byte(char.charCodeAt(0)); }
  result() { return this.buffer.slice(0, this.length); }
}

/** GIF-flavoured LZW: variable code width from minCodeSize + 1 up to 12 bits, with clear and end codes. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize, end = clear + 1, out = new ByteWriter();
  let codeSize = minCodeSize + 1, next = end + 1, bits = 0, bitCount = 0;
  const emit = (code: number) => { bits |= code << bitCount; bitCount += codeSize; while (bitCount >= 8) { out.byte(bits & 255); bits >>>= 8; bitCount -= 8; } };
  let table = new Map<number, number>();
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], id = (prefix << 8) | k, found = table.get(id);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      table.set(id, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else { emit(clear); table = new Map(); codeSize = minCodeSize + 1; next = end + 1; }
    prefix = k;
  }
  emit(prefix); emit(end);
  if (bitCount > 0) out.byte(bits & 255);
  return out.result();
}
