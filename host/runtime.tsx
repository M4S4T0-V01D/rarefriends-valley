/**
 * Trusted runtime page for RareFriends Valley.
 *
 * This is the SDK's own GameHost: wallet connection, owned-Friend picker, fresh eligibility check,
 * simulated ledger, confirmations and the sandboxed frame. It adds three things for the game:
 *  1. A read-only discovery of the connected account's eligible Friends with the SDK's `readOwnedFriends`,
 *     so your other owned Friends can move into the valley.
 *  2. Per-wallet saves. The sandbox has no storage, so this trusted page keeps each wallet's farm in its own
 *     localStorage, keyed by wallet address.
 *  3. Sharing. On the player's click, it posts a diary picture, a GIF or a video with the share sheet (phones), or
 *     saves the file and opens a prefilled X post (desktop), or copies a picture. The sandbox has none of these powers.
 * They reach the sandboxed game only over postMessage, when it asks. The watcher session only uses `eth_accounts`:
 * no signing and no extra prompts. GameHost still owns connection and selection.
 */
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GameHost } from "@rarefriends/friendsdk/runtime";
import { parseChanceGame } from "@rarefriends/friendsdk/game";
import { readOwnedFriends } from "@rarefriends/friendsdk/owned";
import { createFriendPublicClient, createFriendWalletSession } from "@rarefriends/friendsdk/wallet";
import {
  HOST_HELLO, HOST_STATE, SAVE_WRITE, SHARE_REQUEST, SHARE_RESULT, SHARE_TYPES, shareFilename, type ShareAction, type ShareOutcome,
} from "../games/rarefriends-valley/roster.ts";
import gameJson from "../games/rarefriends-valley/game.json";
import "@rarefriends/friendsdk/frame.css";
import "@rarefriends/friendsdk/runtime.css";

const definition = parseChanceGame(gameJson);
const saveKey = (account: string) => `rarefriends-valley:save:v1:${account.toLowerCase()}`;
function readSave(account: string): unknown {
  try { const raw = localStorage.getItem(saveKey(account)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeSave(account: string, save: unknown) {
  try { const raw = JSON.stringify(save); if (raw.length < 200_000) localStorage.setItem(saveKey(account), raw); } catch { /* Storage full or blocked: play continues unsaved. */ }
}

function download(file: Blob, filename: string) {
  const url = URL.createObjectURL(file), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
async function copyImage(image: Blob) {
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]); return true; } catch { return false; }
}
/** Runs inside the click's user activation, which the browser passes up from the game frame. */
async function share(action: ShareAction, text: string, file: Blob, filename: string): Promise<ShareOutcome> {
  const png = file.type === "image/png";
  if (action === "copy") return png && await copyImage(file) ? "copied" : "failed";
  if (action === "save") { download(file, filename); return "saved"; }
  // Phones: the share sheet can send the picture, GIF or video with the text straight to the X app.
  const shared = new File([file], filename, { type: file.type });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [shared], text })) {
    try { await navigator.share({ files: [shared], text }); return "shared"; }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return "cancelled"; }
  }
  // Desktop: X post links can't carry media, so copy the picture (or save the file), then open the prefilled post.
  const copied = png && await copyImage(file);
  if (!copied) download(file, filename);
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  return copied ? "copied-and-opened" : "saved-and-opened";
}

function ValleyHost() {
  useEffect(() => {
    const session = createFriendWalletSession(), client = createFriendPublicClient();
    let account: string | null = null, controller: AbortController | null = null, roster: string[] | null = null;
    const frames = () => [...document.querySelectorAll("iframe")].flatMap(frame => frame.contentWindow ? [frame.contentWindow] : []);
    // Nothing is sent until this wallet's roster is known, so the game can match it to its verified Friend.
    const send = (target: Window) => { if (account && roster) target.postMessage({ type: HOST_STATE, ids: roster, save: readSave(account) }, "*"); };
    const broadcast = () => frames().forEach(send);
    const check = () => {
      const snapshot = session.getSnapshot();
      const next = snapshot.status === "connected" ? snapshot.account : null;
      if (next === account) return;
      account = next; controller?.abort(); roster = null;
      if (!next) return;
      const current = controller = new AbortController();
      void readOwnedFriends(client, next, { signal: current.signal })
        .then(result => { if (!current.signal.aborted) { roster = result.friends.map(friend => `${friend.id}:${friend.generation}`); broadcast(); } })
        .catch(() => { /* The roster is optional; the valley still has its villagers. */ });
    };
    // Only the game frame we host may ask, save or share. Saves are accepted only for a Friend in this wallet's roster.
    const receive = (event: MessageEvent) => {
      if (!event.source || !frames().includes(event.source as Window)) return;
      const data = event.data;
      if (data?.type === HOST_HELLO) send(event.source as Window);
      else if (data?.type === SAVE_WRITE && account && roster?.some(entry => entry.split(":")[0] === String(data.manager))) writeSave(account, data.save);
      else if (data?.type === SHARE_REQUEST && ["post", "copy", "save"].includes(data.action) && data.file instanceof Blob && SHARE_TYPES[data.file.type]
        && data.file.size <= SHARE_TYPES[data.file.type].limit && typeof data.text === "string" && data.text.length <= 1000) {
        const source = event.source as Window, action = data.action as ShareAction, id = typeof data.id === "string" ? data.id.slice(0, 40) : "";
        void share(action, data.text, data.file, shareFilename(data.filename, data.file.type)).catch((): ShareOutcome => "failed")
          .then(result => source.postMessage({ type: SHARE_RESULT, action, result, id }, "*"));
      }
    };
    window.addEventListener("message", receive);
    const unsubscribe = session.subscribe(check); check();
    // Pick up a connection made through GameHost even if the wallet emits no accountsChanged event.
    const poll = setInterval(() => { if (session.getSnapshot().status !== "connected") void session.refresh(); }, 2500);
    return () => { clearInterval(poll); unsubscribe(); window.removeEventListener("message", receive); controller?.abort(); session.dispose(); };
  }, []);
  return <GameHost definition={definition} frameUrl="./game.html" />;
}

createRoot(document.getElementById("root")!).render(<ValleyHost />);
