/**
 * Messages between the sandboxed game and its trusted host page (host/runtime.tsx).
 *
 * - The game asks with HOST_HELLO. The host answers with HOST_STATE: the connected account's eligible Friend IDs
 *   (found with the SDK's `readOwnedFriends`) and that wallet's saved farm from the host page's localStorage.
 * - The game sends SAVE_WRITE with its progress; the host stores it under the connected wallet address.
 *
 * The game accepts HOST_STATE only from its parent window, and only when the roster contains the runtime-verified
 * Friend, so roster and save belong to the same wallet. It writes saves only after such a confirmation.
 */
export const HOST_HELLO = "rarefriends-valley:hello";
export const HOST_STATE = "rarefriends-valley:state";
export const SAVE_WRITE = "rarefriends-valley:save";

/** One roster entry per owned Friend: `"<token id>:<generation>"`. */
export type RosterFriend = { id: number; generation: number | null };
/**
 * Parse the host's roster. Returns the verified Friend's generation and the other owned Friends, or null when the
 * roster does not belong to the verified Friend's wallet (it must be listed).
 */
export function parseRoster(ids: unknown, friendId: bigint, limit = 40): { self: number | null; others: RosterFriend[] } | null {
  if (!Array.isArray(ids)) return null;
  const seen = new Set<number>(), friends: RosterFriend[] = [];
  for (const entry of ids) {
    const match = typeof entry === "string" ? /^([0-9]{1,15})(?::([0-9]{1,3}))?$/.exec(entry) : null;
    if (!match) continue;
    const id = Number(match[1]), generation = match[2] === undefined ? null : Number(match[2]);
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id); friends.push({ id, generation: generation !== null && generation >= 1 && generation <= 255 ? generation : null });
  }
  const selfEntry = friends.find(friend => friend.id === Number(friendId));
  if (!selfEntry) return null;
  return { self: selfEntry.generation, others: friends.filter(friend => friend !== selfEntry).slice(0, limit) };
}

/**
 * Sharing a picture, GIF or video. The sandbox can't copy, download, open tabs or use the share sheet, so on a click
 * the game sends SHARE_REQUEST (action, post text, file blob, filename) and the trusted host performs it, replying
 * with SHARE_RESULT. Copying works for PNG pictures only (browsers' clipboards hold PNG images).
 */
export const SHARE_REQUEST = "rarefriends-valley:share";
export const SHARE_RESULT = "rarefriends-valley:share-result";
export type ShareAction = "post" | "copy" | "save";
export type ShareOutcome = "shared" | "copied-and-opened" | "saved-and-opened" | "copied" | "saved" | "cancelled" | "failed";
/** File types the host will share or save, with their size limits (X accepts GIFs up to 15 MB). */
export const SHARE_TYPES: Readonly<Record<string, { extension: string; limit: number }>> = {
  "image/png": { extension: "png", limit: 5_000_000 },
  "image/gif": { extension: "gif", limit: 15_000_000 },
  "video/mp4": { extension: "mp4", limit: 40_000_000 },
  "video/webm": { extension: "webm", limit: 40_000_000 },
};
/** A safe download name: lowercase letters, digits and dashes, with the extension for its type. */
export function shareFilename(name: unknown, type: string): string {
  const extension = SHARE_TYPES[type]?.extension ?? "bin";
  const base = typeof name === "string" ? name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) : "";
  return `${base || "rarefriends-valley"}.${extension}`;
}
