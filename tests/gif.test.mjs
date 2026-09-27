import test from "node:test";
import assert from "node:assert/strict";
import { GifRecorder, lzwEncode } from "../games/rarefriends-valley/gif.ts";

/** Reference GIF LZW decoder (from the spec) to check the encoder round-trips. */
function lzwDecode(data, minCodeSize, pixelCount) {
  const clear = 1 << minCodeSize, end = clear + 1, out = [];
  let codeSize = minCodeSize + 1, dict = [], bit = 0, previous = null;
  const reset = () => { dict = Array.from({ length: clear }, (_, i) => [i]); dict.push(null, null); codeSize = minCodeSize + 1; previous = null; };
  reset();
  const read = () => { let code = 0; for (let i = 0; i < codeSize; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i; return code; };
  while (bit + codeSize <= data.length * 8) {
    const code = read();
    if (code === clear) { reset(); continue; }
    if (code === end) break;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (previous) entry = [...previous, previous[0]];
    else throw new Error("bad code");
    out.push(...entry);
    if (previous && dict.length < 4096) dict.push([...previous, entry[0]]);
    previous = entry;
    if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
  }
  return out.slice(0, pixelCount);
}
function readGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++], u16 = () => bytes[p++] | (bytes[p++] << 8), text = n => String.fromCharCode(...bytes.slice(p, p += n));
  assert.equal(text(6), "GIF89a");
  const width = u16(), height = u16(), packed = u8(); u8(); u8();
  const paletteSize = 2 << (packed & 7), palette = bytes.slice(p, p += paletteSize * 3);
  const frames = []; let loops = false, delays = [];
  for (;;) {
    const block = u8();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = u8();
      if (label === 0xf9) { u8(); u8(); delays.push(u16()); u8(); u8(); }
      else { let size; if (label === 0xff) { const n = u8(); loops = text(n) === "NETSCAPE2.0"; } while ((size = u8())) p += size; }
      continue;
    }
    assert.equal(block, 0x2c);
    u16(); u16(); assert.equal(u16(), width); assert.equal(u16(), height); u8();
    const min = u8(), chunks = []; let size;
    while ((size = u8())) { chunks.push(...bytes.slice(p, p + size)); p += size; }
    frames.push(lzwDecode(Uint8Array.from(chunks), min, width * height));
  }
  return { width, height, palette, frames, loops, delays };
}

test("LZW round-trips short, repetitive and table-overflowing data", () => {
  let seed = 3;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const input of [
    [7], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], Array.from({ length: 5000 }, (_, i) => i % 7),
    Array.from({ length: 40000 }, () => Math.floor(random() * 256)), Array.from({ length: 20000 }, () => Math.floor(random() * 3) * 40),
  ]) {
    const data = lzwEncode(Uint8Array.from(input), 8);
    assert.deepEqual(lzwDecode(data, 8, input.length), input);
  }
});

test("GIF recorder writes a looping animated GIF whose frames decode to the recorded colours", async () => {
  const width = 24, height = 16, recorder = new GifRecorder(width, height);
  const colors = [[22, 22, 22], [239, 237, 231], [216, 182, 180], [180, 195, 171]];
  for (let frame = 0; frame < 5; frame++) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) { const c = colors[(i + frame) % colors.length]; rgba.set([...c, 255], i * 4); }
    recorder.addFrame(rgba);
  }
  let progress = 0;
  const bytes = await recorder.encode(8, value => { progress = value; });
  assert.equal(progress, 1);
  const gif = readGif(bytes);
  assert.equal(gif.width, width); assert.equal(gif.height, height); assert.equal(gif.frames.length, 5); assert.ok(gif.loops);
  assert.deepEqual(gif.delays, [8, 8, 8, 8, 8]);
  for (let frame = 0; frame < 5; frame++) for (const i of [0, 1, 2, 3, 100, 383]) {
    const index = gif.frames[frame][i], expected = colors[(i + frame) % colors.length];
    const actual = [...gif.palette.slice(index * 3, index * 3 + 3)];
    actual.forEach((value, channel) => assert.ok(Math.abs(value - expected[channel]) <= 8, `frame ${frame} px ${i}`));
  }
});
