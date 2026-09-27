/** The farm diary card (1200 × 675, X's 16:9 image size) and the text for posts about a day or a clip. */
import { FAMILY_NAMES, SEASON_NAMES, itemInfo } from "./data.ts";
import type { Diary, ValleyState } from "./engine.ts";

export const SHARE_URL = "https://rarefriends.com/";
export const SHARE_TAGS = "@RareFriendsNFT #RareFriends #RareFriendsValley";
const WEATHER = { sun: "☀ sunny", rain: "☂ rainy", snow: "❄ snowy" } as const;

export function diaryText(diary: Diary, friendId: bigint, familyId: number): string {
  const lines = [
    `${SEASON_NAMES[diary.season]} ${diary.day}, Year ${diary.year} on my farm 🌱 harvested ${diary.harvested}, earned ${diary.earned} G${diary.hearts.length ? `, made friends with ${diary.hearts.slice(0, 2).join(" & ")}` : ""}.`,
    `My Rare Friend #${friendId} (${FAMILY_NAMES[familyId] ?? "Friend"}) is a farmer now!`,
    SHARE_URL, SHARE_TAGS,
  ];
  return lines.join("\n");
}
export function clipText(state: ValleyState, friendId: bigint): string {
  return [`A little clip from my farm in RareFriends Valley 🎬 ${SEASON_NAMES[["spring", "summer", "autumn", "winter"][state.season] as keyof typeof SEASON_NAMES]} ${state.day}, Year ${state.year} · Friend #${friendId}`, SHARE_URL, SHARE_TAGS].join("\n");
}
/** X counts every link as 23 characters. */
export const postLength = (text: string) => text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;

const INK = "#161616", PAPER = "#efede7", MUTED = "#6d6b67";
const SEASON_ACCENT = { spring: "#e6c3c1", summer: "#b4c3ab", autumn: "#e2c9a0", winter: "#c9d6e0" } as const;

export function renderDiaryCard(options: { diary: Diary; friendId: bigint; familyId: number; scene: CanvasImageSource | null; portrait: readonly string[] | null }): HTMLCanvasElement {
  const { diary, friendId, familyId, scene, portrait } = options;
  const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 675;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, 1200, 675);
  ctx.fillStyle = "rgba(22,22,22,.05)";
  for (let y = 6; y < 675; y += 14) for (let x = (y / 14) % 2 ? 12 : 5; x < 1200; x += 14) ctx.fillRect(x, y, 2, 2);

  // A taped photo of the farm.
  ctx.save(); ctx.translate(46, 44); ctx.rotate(-0.012);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 690, 510); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeRect(0, 0, 690, 510);
  if (scene) { ctx.save(); ctx.beginPath(); ctx.rect(14, 14, 662, 430); ctx.clip(); ctx.filter = "grayscale(.2) contrast(1.02)"; drawCover(ctx, scene, 14, 14, 662, 430); ctx.restore(); }
  ctx.strokeRect(14, 14, 662, 430);
  ctx.fillStyle = INK; ctx.font = "bold 22px ui-monospace, Menlo, monospace"; ctx.textAlign = "left";
  ctx.fillText(`${SEASON_NAMES[diary.season].toUpperCase()} ${diary.day} · YEAR ${diary.year}`, 20, 484);
  ctx.fillStyle = SEASON_ACCENT[diary.season]; ctx.globalAlpha = 0.85; ctx.fillRect(250, -14, 180, 34); ctx.globalAlpha = 1;
  ctx.restore();

  const x = 790;
  ctx.textAlign = "left"; ctx.fillStyle = INK; ctx.font = "bold 30px ui-monospace, Menlo, monospace"; ctx.fillText("FARM DIARY", x, 80);
  ctx.fillStyle = SEASON_ACCENT[diary.season]; ctx.fillRect(x, 94, 370, 8);
  ctx.fillStyle = MUTED; ctx.font = "18px ui-monospace, Menlo, monospace"; ctx.fillText(`${WEATHER[diary.weather]} · tomorrow ${WEATHER[diary.tomorrow].split(" ")[0]}`, x, 132);
  const best = [...diary.shipped].sort((a, b) => itemInfo(b.id).sell * b.count - itemInfo(a.id).sell * a.count)[0];
  const rows: [string, string][] = [
    ["Harvested", String(diary.harvested)], ["Crops grew", `${diary.grown}${diary.bonusGrowth ? ` (+${diary.bonusGrowth} boosted)` : ""}`],
    ["Shipped", best ? `${diary.shipped.reduce((sum, slot) => sum + slot.count, 0)} items` : "nothing"], ["Gold earned", `${diary.earned} G`],
    ["Best seller", best ? itemInfo(best.id).name : "–"], ["New hearts", diary.hearts.length ? diary.hearts.slice(0, 2).join(", ") : "–"],
    ["Tilled · watered", `${diary.tilled} · ${diary.watered}`],
  ];
  rows.forEach(([label, value], index) => {
    const y = 180 + index * 40;
    ctx.fillStyle = INK; ctx.font = "20px ui-monospace, Menlo, monospace"; ctx.textAlign = "left"; ctx.fillText(label, x, y);
    ctx.font = "bold 20px ui-monospace, Menlo, monospace"; ctx.textAlign = "right"; ctx.fillText(value.length > 18 ? `${value.slice(0, 17)}…` : value, x + 370, y);
    ctx.strokeStyle = "rgba(22,22,22,.2)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x + 370, y + 12); ctx.stroke(); ctx.setLineDash([]);
  });

  const py = 470;
  ctx.fillStyle = SEASON_ACCENT[diary.season]; ctx.fillRect(x, py, 96, 96); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeRect(x, py, 96, 96);
  if (portrait) {
    const s = 5, ox = x + 8, oy = py + 8;
    ctx.fillStyle = "#fff"; portrait.forEach((row, ry) => [...row].forEach((pixel, rx) => { if (pixel === "#") ctx.fillRect(ox + rx * s - s, oy + ry * s - s, s * 3, s * 3); }));
    ctx.fillStyle = INK; portrait.forEach((row, ry) => [...row].forEach((pixel, rx) => { if (pixel === "#") ctx.fillRect(ox + rx * s, oy + ry * s, s, s); }));
  }
  ctx.textAlign = "left"; ctx.fillStyle = INK; ctx.font = "bold 22px ui-monospace, Menlo, monospace"; ctx.fillText(`Farmer #${friendId}`, x + 112, py + 38);
  ctx.fillStyle = MUTED; ctx.font = "18px ui-monospace, Menlo, monospace"; ctx.fillText(`${FAMILY_NAMES[familyId] ?? "Friend"}${diary.passedOut ? " · passed out!" : ""}`, x + 112, py + 68);

  ctx.fillStyle = INK; ctx.fillRect(0, 615, 1200, 60);
  ctx.fillStyle = PAPER; ctx.font = "bold 22px ui-monospace, Menlo, monospace"; ctx.textAlign = "left"; ctx.fillText("🌱 RareFriends Valley", 40, 653);
  ctx.textAlign = "right"; ctx.font = "20px ui-monospace, Menlo, monospace"; ctx.fillText(SHARE_TAGS, 1160, 653);
  return canvas;
}
/** Draw an image to fill a box, cropping the overflow (like CSS object-fit: cover). */
function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, w: number, h: number) {
  const source = image as { width: number; height: number }, scale = Math.max(w / source.width, h / source.height);
  const sw = w / scale, sh = h / scale;
  ctx.drawImage(image, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, x, y, w, h);
}
