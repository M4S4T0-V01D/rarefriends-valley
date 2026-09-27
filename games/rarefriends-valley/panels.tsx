"use client";

import { useEffect, useRef } from "react";
import { CROPS, FOODS, FORAGE, HEART, MAX_FRIENDSHIP, cropById, itemInfo, type CropId, type DecorKind, type ItemId, type Season, type ToolId } from "./data.ts";
import { TRACKS, type TrackId } from "./audio.ts";
import type { Prefs, Slot } from "./engine.ts";
import { drawDecor, INK } from "./render.ts";

/** A small canvas showing a 16 × 16 one-bit Friend frame in the canonical black-with-white-halo style. */
export function SpriteChip({ rows, size = 36, label }: { rows: readonly string[] | null; size?: number; label: string }) {
  const node = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = node.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 54, 54);
    if (!rows) return;
    ctx.fillStyle = "#fff";
    rows.forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === "#") ctx.fillRect(x * 3, y * 3, 9, 9); }));
    ctx.fillStyle = INK;
    rows.forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === "#") ctx.fillRect(x * 3 + 3, y * 3 + 3, 3, 3); }));
  }, [rows]);
  return <canvas ref={node} className="valley-chip" width={54} height={54} style={{ width: size, height: size }} role="img" aria-label={label} />;
}

/** Hand-drawn item icons: seed packets, crops, golden crops, forage, food and fertilizer. */
function paintItem(ctx: CanvasRenderingContext2D, id: ItemId | ToolId, size: number) {
  const s = size / 32;
  ctx.save(); ctx.scale(s, s); ctx.lineWidth = 1.4; ctx.strokeStyle = INK;
  const circle = (x: number, y: number, r: number, fill: string) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); };
  const shape = (x: number, y: number, w: number, h: number, fill: string) => { ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); };
  const leaf = (color: string) => { ctx.beginPath(); ctx.moveTo(16, 11); ctx.quadraticCurveTo(10, 3, 12, 2); ctx.quadraticCurveTo(17, 5, 16, 11); ctx.moveTo(16, 11); ctx.quadraticCurveTo(22, 3, 21, 3); ctx.quadraticCurveTo(18, 7, 16, 11); ctx.fillStyle = color; ctx.fill(); ctx.stroke(); };
  if (id === "hand") { shape(16, 18, 8, 9, "#efe9df"); for (const x of [10, 14, 18, 22]) shape(x, 9, 2.2, 4.5, "#efe9df"); }
  else if (id === "hoe") { ctx.fillStyle = "#9c8672"; ctx.save(); ctx.translate(16, 16); ctx.rotate(-0.7); ctx.fillRect(-2, -13, 4, 26); ctx.strokeRect(-2, -13, 4, 26); ctx.fillStyle = "#b9bfc6"; ctx.fillRect(-8, -15, 12, 5); ctx.strokeRect(-8, -15, 12, 5); ctx.restore(); }
  else if (id === "can") { ctx.fillStyle = "#afbccb"; ctx.fillRect(7, 12, 16, 13); ctx.strokeRect(7, 12, 16, 13); ctx.beginPath(); ctx.moveTo(23, 16); ctx.lineTo(29, 9); ctx.lineTo(29, 12); ctx.lineTo(23, 20); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(15, 12, 5, Math.PI, 0); ctx.stroke(); }
  else if (id === "seeds" || id.startsWith("seed:")) {
    const crop = id.startsWith("seed:") ? cropById(id.slice(5) as CropId) : cropById("turnip");
    ctx.fillStyle = "#e9e4da"; ctx.fillRect(8, 5, 16, 22); ctx.strokeRect(8, 5, 16, 22);
    circle(16, 16, 5, crop.color); ctx.fillStyle = INK; ctx.fillRect(8, 5, 16, 3);
  } else if (id === "fertilizer") { ctx.fillStyle = "#c9b69e"; ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(24, 10); ctx.lineTo(26, 27); ctx.lineTo(6, 27); ctx.closePath(); ctx.fill(); ctx.stroke(); for (const [x, y] of [[12, 19], [17, 22], [20, 16]]) circle(x, y, 1.4, "#fff"); ctx.fillStyle = INK; ctx.fillRect(10, 7, 12, 3); }
  else {
    const golden = id.startsWith("golden:"), base = (golden ? id.slice(7) : id) as ItemId;
    const crop = CROPS.find(item => item.id === base), forage = FORAGE.find(item => item.id === base), food = FOODS.find(item => item.id === base);
    if (crop) {
      const color = golden ? "#e2c46a" : crop.color;
      if (crop.shape === "round") { leaf(crop.leaf); circle(16, 19, 8, color); }
      else if (crop.shape === "berry") { leaf(crop.leaf); for (const [x, y] of [[11, 17], [20, 17], [15, 23], [19, 24]]) circle(x, y, 4, color); }
      else if (crop.shape === "cob") { shape(16, 17, 5, 11, color); ctx.beginPath(); ctx.moveTo(10, 27); ctx.quadraticCurveTo(12, 14, 9, 8); ctx.moveTo(22, 27); ctx.quadraticCurveTo(20, 14, 23, 8); ctx.strokeStyle = "#8aa37c"; ctx.lineWidth = 2.4; ctx.stroke(); }
      else if (crop.shape === "big") { leaf(crop.leaf); shape(16, 19, 11, 9, color); }
      else if (crop.shape === "long") { leaf(crop.leaf); ctx.save(); ctx.translate(16, 19); ctx.rotate(0.5); shape(0, 0, 4.5, 10, color); ctx.restore(); }
      else { shape(16, 18, 11, 9, color); shape(12, 17, 5, 6, "#eef2f3"); }
      if (golden) { ctx.fillStyle = "#fff"; ctx.fillRect(22, 4, 2, 8); ctx.fillRect(19, 7, 8, 2); }
    } else if (forage) {
      if (base === "berry") { for (const [x, y] of [[12, 16], [20, 15], [16, 22]]) circle(x, y, 4.5, forage.color); }
      else if (base === "shell") { ctx.beginPath(); ctx.moveTo(6, 22); ctx.lineTo(16, 6); ctx.lineTo(26, 22); ctx.quadraticCurveTo(16, 28, 6, 22); ctx.fillStyle = forage.color; ctx.fill(); ctx.stroke(); }
      else if (base === "mushroom") { ctx.fillStyle = "#efe9df"; ctx.fillRect(13, 15, 6, 11); ctx.strokeRect(13, 15, 6, 11); shape(16, 14, 11, 6, forage.color); }
      else { ctx.beginPath(); ctx.moveTo(16, 4); ctx.lineTo(24, 16); ctx.lineTo(16, 28); ctx.lineTo(8, 16); ctx.closePath(); ctx.fillStyle = forage.color; ctx.fill(); ctx.stroke(); }
    } else if (food) {
      if (base === "latte") { ctx.fillStyle = "#f7f5f0"; ctx.fillRect(8, 11, 14, 15); ctx.strokeRect(8, 11, 14, 15); ctx.beginPath(); ctx.arc(24, 18, 4, -1.4, 1.4); ctx.stroke(); shape(15, 11, 7, 2.4, "#c9b08e"); }
      else if (base === "honeycake") { ctx.fillStyle = "#e9dcc0"; ctx.beginPath(); ctx.moveTo(5, 24); ctx.lineTo(27, 24); ctx.lineTo(27, 14); ctx.lineTo(5, 18); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#e2c46a"; ctx.fillRect(5, 16, 22, 3); circle(22, 11, 3, "#d49a98"); }
      else { shape(16, 20, 12, 6, "#e9e4da"); shape(16, 18, 10, 4, "#c99a7a"); }
    }
  }
  ctx.restore();
}
export function ItemIcon({ id, size = 28 }: { id: ItemId | ToolId; size?: number }) {
  const node = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const ctx = node.current?.getContext("2d"); if (!ctx) return; ctx.clearRect(0, 0, size * 2, size * 2); ctx.save(); ctx.scale(2, 2); paintItem(ctx, id, size); ctx.restore(); }, [id, size]);
  return <canvas ref={node} className="valley-icon" width={size * 2} height={size * 2} style={{ width: size, height: size }} aria-hidden="true" />;
}
/** A décor or RF-exclusive preview, drawn with the in-game renderer. */
export function DecorPreview({ kind, locked, statue, season }: { kind: DecorKind; locked: boolean; statue: readonly string[] | null; season: Season }) {
  const node = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = node.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 96, 96); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#e3e0d6"; ctx.beginPath(); ctx.moveTo(48, 60); ctx.lineTo(80, 76); ctx.lineTo(48, 92); ctx.lineTo(16, 76); ctx.closePath(); ctx.fill();
    if (locked) ctx.filter = "grayscale(1) brightness(.2) opacity(.35)";
    drawDecor(ctx, { angle: 0, cx: 0, cy: 0, focusX: 0, focusY: 0, zoom: 1, width: 96, height: 92 }, kind, 0, 0, 0, true, season, false, statue);
    ctx.filter = "none";
  }, [kind, locked, statue, season]);
  return <canvas ref={node} className="valley-decor" width={96} height={96} aria-hidden="true" />;
}

export function Hearts({ points }: { points: number }) {
  const hearts = Math.floor(points / HEART), total = MAX_FRIENDSHIP / HEART;
  return <span className="valley-hearts" aria-label={`${hearts} of ${total} hearts`}>{"♥".repeat(hearts)}<i>{"♥".repeat(total - hearts)}</i></span>;
}

export type Tool = { id: ToolId; label: string; count?: string };
export function Hotbar({ tools, active, seeds, onTool }: { tools: readonly Tool[]; active: ToolId; seeds: Slot | null; onTool: (id: ToolId) => void }) {
  return <div className="valley-hotbar" role="toolbar" aria-label="Tools">
    {tools.map((tool, index) => <button type="button" key={tool.id} aria-pressed={active === tool.id} title={`${tool.label} (${index + 1})`} onClick={() => onTool(tool.id)}>
      <ItemIcon id={tool.id === "seeds" && seeds ? seeds.id : tool.id} size={26} />
      <span className="valley-key" aria-hidden="true">{index + 1}</span>
      <span className="valley-tool-label">{tool.label}</span>
      {tool.count && <b className="valley-count">{tool.count}</b>}
    </button>)}
  </div>;
}

export function Inventory({ slots, selected, onSelect }: { slots: readonly (Slot | null)[]; selected: number; onSelect: (index: number) => void }) {
  return <div className="valley-bag" role="listbox" aria-label="Backpack">
    {slots.map((slot, index) => <button type="button" role="option" key={index} aria-selected={selected === index} disabled={!slot}
      aria-label={slot ? `${itemInfo(slot.id).name} × ${slot.count}` : "Empty slot"} onClick={() => onSelect(index)}>
      {slot && <><ItemIcon id={slot.id} size={28} /><b>{slot.count}</b></>}
    </button>)}
  </div>;
}

export function MusicControls({ prefs, track, onChange, onTrack, current }: { prefs: Prefs; track: TrackId; current: string; onChange: (prefs: Prefs) => void; onTrack: (track: TrackId) => void }) {
  return <div className="valley-music">
    <label className="valley-check"><input type="checkbox" checked={prefs.music} onChange={event => onChange({ ...prefs, music: event.target.checked })} /> Music</label>
    <label className="valley-check"><input type="checkbox" checked={prefs.sfx} onChange={event => onChange({ ...prefs, sfx: event.target.checked })} /> Sound effects</label>
    <label className="valley-range">Volume <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={event => onChange({ ...prefs, volume: Number(event.target.value) })} /></label>
    <div className="valley-tracks" role="radiogroup" aria-label="Music">
      <button type="button" role="radio" aria-checked={track === "auto"} onClick={() => onTrack("auto")}><strong>By season</strong><small>Now: {current}</small></button>
      {TRACKS.map(item => <button type="button" role="radio" key={item.id} aria-checked={track === item.id} onClick={() => onTrack(item.id)}><strong>{item.name}</strong><small>{item.mood}</small></button>)}
    </div>
  </div>;
}
