"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { expectedReward, maximumPrize, type GameSnapshot } from "@rarefriends/friendsdk/game";
import { createFriendReader, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { createFriendSoundKit, type FriendSoundCue, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import {
  BACKPACK_SLOTS, BLESSINGS, CAN_CAPACITY, CROPS, DECOR, EXCLUSIVES, FAMILY_NAMES, FAMILY_PERKS, FOODS, FERTILIZER_PRICE, HELPER_HEARTS, SEASON_NAMES,
  SHOP_HOURS, TOOL_NAMES, VILLAGERS, cropById, decorByKind, itemInfo, type DecorKind, type ItemId, type ToolId,
} from "./data.ts";
import {
  actInFront, actionFor, activeSeeds, binValue, canCapacity, clockText, collectFromBlessing, countItem, createValley, dateText, deliverRequest, eat,
  farmerTile, giftReaction, giveGift, hearts, helpers, isNight, maxEnergy, pickUpDecor, placeDecor, placementProblem, priceOf, purchase, restoreValley,
  ripeCrops, season, serializeValley, setBlessings, setManual, setOwnedFriends, ship, shopOpen, sleep, talk, tapTile, thirstyCrops, update, wakeUp,
  decorAt, type Prefs, type Purchase, type ValleyState,
} from "./engine.ts";
import { createGuests } from "./guests.ts";
import { DecorPreview, Hearts, Hotbar, Inventory, ItemIcon, MusicControls, SpriteChip, type Tool } from "./panels.tsx";
import { REGULAR_SPRITES } from "./regulars.ts";
import { friendRows, renderScene, residentUnder, type Facing, type Floater } from "./render.ts";
import { HOST_HELLO, HOST_STATE, SAVE_WRITE, SHARE_REQUEST, SHARE_RESULT, parseRoster, type ShareAction, type ShareOutcome } from "./roster.ts";
import { clipText, diaryText, renderDiaryCard } from "./card.ts";
import { ValleyAudio, trackFor, trackName, type TrackId } from "./audio.ts";
import { CLIP_SECONDS, ClipRecorder, type Clip } from "./clip.ts";
import { MAPS, screenToWorldDir, tileUnder, type Camera, type Tile } from "./world.ts";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";

const GUESTS = createGuests(18);
const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;
const DIRECTIONS: Record<string, { dx: number; dy: number }> = {
  w: { dx: 0, dy: -1 }, arrowup: { dx: 0, dy: -1 }, s: { dx: 0, dy: 1 }, arrowdown: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 }, arrowleft: { dx: -1, dy: 0 }, d: { dx: 1, dy: 0 }, arrowright: { dx: 1, dy: 0 },
};
const TOOLS: readonly ToolId[] = ["hand", "hoe", "can", "seeds", "fertilizer"];
/** Villagers with canonical sprites: Pip is #7730 (a Hoverer), Kumo is #3412 (a Skeleton). */
const CANONICAL: Record<string, bigint> = { pip: 7730n, kumo: 3412n };
type Menu = { kind: "bag" | "settings" | "help" | "bed" | "bin" | "store" | "cafe" | "market" | "board" | "decor" | "clip" } | { kind: "talk"; id: string; line: string } | null;
type Hud = {
  phase: ValleyState["phase"]; date: string; clock: string; weather: ValleyState["weather"]; gold: number; energy: number; maxEnergy: number;
  water: number; capacity: number; map: string; tool: ToolId; night: boolean; minute: number; seeds: number; fertilizer: number; charges: number;
};
const readHud = (state: ValleyState): Hud => ({
  phase: state.phase, date: dateText(state), clock: clockText(Math.floor(state.minute)), weather: state.weather, gold: state.gold,
  energy: Math.round(state.energy), maxEnergy: maxEnergy(state), water: state.water, capacity: canCapacity(state), map: state.farmer.map,
  tool: state.tool, night: isNight(state), minute: Math.floor(state.minute), seeds: activeSeeds(state)?.count ?? 0,
  fertilizer: countItem(state, "fertilizer"), charges: state.sproutCharges,
});
type Reveal = { outcomeId: number; exclusive: DecorKind | null; gold: number; redeemed: boolean };
const WEATHER_ICON = { sun: "☀", rain: "☂", snow: "❄" } as const;
const PLACE_NAMES = { store: "General Store", cafe: "RareFriends Cafe", market: "Moonlight Market" } as const;
const CAPSULE_COLORS = ["#b4c3ab", "#b9bfc6", "#c6bed4", "#e2d49e"];

/** RareFriends Valley. The SDK runtime supplies wallet connection, the verified owned Friend and the fixed (simulated) RF client. */
export default function RareFriendsValley({ friendId, client, paused }: GameComponentProps) {
  const canvas = useRef<HTMLCanvasElement>(null), portrait = useRef<HTMLCanvasElement>(null);
  const valley = useRef<ValleyState | null>(null), friend = useRef<GenerationSprites | null>(null);
  const ownedSprites = useRef(new Map<number, GenerationSprites>()), loadingSprites = useRef(new Set<number>());
  const floaters = useRef<Floater[]>([]), hover = useRef<Tile | null>(null), sound = useRef<FriendSoundKit | null>(null), audio = useRef<ValleyAudio | null>(null);
  const cameraAngle = useRef({ current: 0, target: 0 }), focus = useRef({ x: 4, y: 6 }), view = useRef({ width: 960, height: 640, scale: 1 });
  const recorder = useRef(new ClipRecorder()), orbitFrom = useRef(0);
  const epoch = useRef(0), locked = useRef(false), linked = useRef(false), lastSave = useRef(""), bedPhoto = useRef<HTMLCanvasElement | null>(null);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState("Waking up the valley and loading your Friend…"), [failed, setFailed] = useState(false), [revision, setRevision] = useState(0);
  const [hud, setHud] = useState<Hud | null>(null), [menu, setMenu] = useState<Menu>(null), [toast, setToast] = useState(""), [hint, setHint] = useState("");
  const [muted, setMuted] = useState(false), [reducedMotion, setReducedMotion] = useState(false);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [reveal, setReveal] = useState<Reveal[] | null>(null), [marketTab, setMarketTab] = useState<"blessings" | "collection" | "kept">("blessings"), [spinning, setSpinning] = useState(false);
  const [placing, setPlacing] = useState<{ kind: DecorKind | "pickup"; tile: Tile | null } | null>(null);
  const [recording, setRecording] = useState(0), [encoding, setEncoding] = useState<number | null>(null), [clip, setClip] = useState<(Clip & { gifUrl: string | null }) | null>(null);
  const [card, setCard] = useState<{ key: string; blob: Blob; url: string; text: string } | null>(null), [shareStatus, setShareStatus] = useState("");
  const [bagSelected, setBagSelected] = useState(0), [storeTab, setStoreTab] = useState<"seeds" | "tools" | "decor">("seeds"), [, setTick] = useState(0);
  const live = useRef({ paused, menu, reducedMotion, reveal, placing, recording: 0 }); live.current = { paused, menu, reducedMotion, reveal, placing, recording };
  const definition = client.definition;

  const say = useCallback((text: string) => { if (text) setToast(text); }, []);
  const cue = useCallback((name: FriendSoundCue) => { sound.current?.play(name); }, []);
  const refresh = () => setTick(value => value + 1);
  const syncBlessings = useCallback((value: GameSnapshot) => {
    if (valley.current) setBlessings(valley.current, value.inventory.map(amount => Number(amount > 99n ? 99n : amount)));
  }, []);
  /** Canonical artwork for owned Friends and the two canonical villagers, loaded on demand; guest art stands in until it arrives. */
  const loadSprites = useCallback((ids: readonly number[]) => {
    for (const id of ids.slice(0, 16)) {
      if (ownedSprites.current.has(id) || loadingSprites.current.has(id)) continue;
      loadingSprites.current.add(id);
      const version = epoch.current;
      void createFriendReader().read(BigInt(id)).then(sprites => { if (version === epoch.current) { ownedSprites.current.set(id, sprites); refresh(); } })
        .catch(() => { /* Keep the stand-in art. */ }).finally(() => loadingSprites.current.delete(id));
    }
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(preference.matches); change(); preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 3600); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if ((paused || menu) && valley.current) setManual(valley.current, null); }, [paused, menu]);

  // Load the verified Friend's canonical artwork and the runtime session, then run the valley.
  useEffect(() => {
    const version = ++epoch.current;
    const node = canvas.current, ctx = node?.getContext("2d");
    sound.current = createFriendSoundKit({ muted: false }); setMuted(false);
    audio.current?.dispose(); audio.current = new ValleyAudio();
    valley.current = null; friend.current = null; floaters.current = []; locked.current = false; ownedSprites.current = new Map();
    setHud(null); setMenu(null); setSnapshot(null); setReveal(null); setError(""); setBusy(false); setFailed(false); setPlacing(null); setClip(null);
    setStatus("Waking up the valley and loading your Friend…");
    if (!node || !ctx) { setFailed(true); setStatus("This browser cannot draw the valley."); return; }
    let frame = 0, previous = 0, lastHud = 0;
    const resize = () => {
      const rect = node.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2.5);
      node.width = Math.max(1, Math.round(rect.width * ratio)); node.height = Math.max(1, Math.round(rect.height * ratio));
      // Fit the shorter side to ~560 logical pixels (~400 in small phone frames), so tiles stay big and readable.
      const scale = Math.max(0.2, Math.min(node.width, node.height) / (rect.width < 640 ? 400 : 560));
      view.current = { width: node.width / scale, height: node.height / scale, scale };
    };
    const observer = new ResizeObserver(resize); observer.observe(node); resize();
    const stop = () => { if (valley.current) setManual(valley.current, null); };
    window.addEventListener("blur", stop); document.addEventListener("visibilitychange", stop);
    const pendingHost = { current: null as unknown };
    const applyHost = (data: { ids?: unknown; save?: unknown }) => {
      const state = valley.current, roster = parseRoster(data.ids, friendId);
      if (!state || roster === null) return;
      if (!linked.current && data.save && restoreValley(state, data.save)) { setToast("Welcome back! This wallet's farm has been restored."); applyPrefs(state.prefs); }
      setOwnedFriends(state, roster.others.map(item => ({ id: item.id, family: null })));
      loadSprites(roster.others.map(item => item.id));
      linked.current = true; setHud(readHud(state)); refresh();
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type === SHARE_RESULT) {
        if (shareTimer.current) clearTimeout(shareTimer.current);
        const messages: Record<ShareOutcome, string> = {
          shared: "Shared! Pick X in your share sheet to post it.", cancelled: "Share cancelled.", failed: "Couldn't share from this browser. Try Save.",
          "copied-and-opened": "Picture copied and X opened: paste it into your post (Ctrl/Cmd+V), then press Post.",
          "saved-and-opened": "File saved and X opened: attach the saved file to your post, then press Post.",
          copied: "Copied as a picture.", saved: "Saved to your downloads.",
        };
        setShareStatus(messages[event.data.result as ShareOutcome] ?? messages.failed);
        return;
      }
      if (event.data?.type !== HOST_STATE) return;
      if (valley.current) applyHost(event.data); else pendingHost.current = event.data;
    };
    const saveNow = () => {
      const state = valley.current, save = state && linked.current ? serializeValley(state) : null;
      if (!save) return;
      const raw = JSON.stringify(save);
      if (raw !== lastSave.current) { lastSave.current = raw; window.parent.postMessage({ type: SAVE_WRITE, manager: friendId.toString(), save }, "*"); }
    };
    const saver = setInterval(saveNow, 4000);
    window.addEventListener("pagehide", saveNow);
    linked.current = false; lastSave.current = "";
    window.addEventListener("message", receive);
    void Promise.all([createFriendReader().read(friendId), client.read()]).then(([sprites, value]) => {
      if (version !== epoch.current) return;
      if (value.friendId !== friendId) throw new Error("This game session does not match the selected Friend.");
      friend.current = sprites;
      for (const regular of REGULAR_SPRITES) if (regular.tokenId !== friendId) ownedSprites.current.set(Number(regular.tokenId), regular);
      valley.current = createValley({ familyId: sprites.familyId });
      if (pendingHost.current) applyHost(pendingHost.current as { ids?: unknown; save?: unknown });
      window.parent.postMessage({ type: HOST_HELLO }, "*");
      setSnapshot(value); syncBlessings(value); setHud(readHud(valley.current)); setStatus("");
      focus.current = { x: valley.current.farmer.x, y: valley.current.farmer.y };
      const render = (now: number) => {
        const state = valley.current!, dt = previous ? Math.min((now - previous) / 1000, 0.1) : 0; previous = now;
        const running = !live.current.paused && !live.current.menu && !live.current.reveal && !live.current.placing && !document.hidden;
        if (running) update(state, dt);
        handleEvents(state);
        if (running) for (const floater of floaters.current) floater.age += dt;
        floaters.current = floaters.current.filter(floater => floater.age < 1.6);
        // Camera: ease toward the target angle and follow your Friend. Clips can slowly orbit.
        const angle = cameraAngle.current;
        if (live.current.recording && state.prefs.orbit && !live.current.reducedMotion) angle.target = orbitFrom.current + recorder.current.elapsed(now) / CLIP_SECONDS * 0.5;
        angle.current += (angle.target - angle.current) * Math.min(1, dt * (live.current.recording ? 20 : 7));
        if (Math.abs(angle.target - angle.current) < 0.001) angle.current = angle.target;
        const world = MAPS[state.farmer.map];
        if (Math.abs(focus.current.x - state.farmer.x) > 8 || Math.abs(focus.current.y - state.farmer.y) > 8) focus.current = { x: state.farmer.x, y: state.farmer.y };
        focus.current.x += (state.farmer.x - focus.current.x) * Math.min(1, dt * 5); focus.current.y += (state.farmer.y - focus.current.y) * Math.min(1, dt * 5);
        const { width, height, scale } = view.current;
        const camera: Camera = { angle: angle.current, cx: world.width / 2, cy: world.height / 2, focusX: focus.current.x, focusY: focus.current.y, zoom: 1.25, width, height };
        cameraRef.current = camera;
        renderScene(ctx, {
          state, camera, now, reducedMotion: live.current.reducedMotion, friend: sprites, art: artFor, floaters: floaters.current,
          hover: hover.current, placing: live.current.placing && live.current.placing.kind !== "pickup" && live.current.placing.tile
            ? { kind: live.current.placing.kind, tile: live.current.placing.tile, valid: !placementProblem(state, live.current.placing.kind, live.current.placing.tile) } : null,
          watermark: live.current.recording ? `RareFriends Valley · ${SEASON_NAMES[season(state)]} ${state.day} · #${friendId}` : null,
          statue: friendRows(sprites, "down", false, 0),
        }, width, height, scale);
        if (recorder.current.recording && recorder.current.frame(node, now)) void finishClip();
        if (now - lastHud > 150) {
          lastHud = now; setHud(readHud(state));
          if (live.current.recording) setRecording(Math.max(0.1, recorder.current.elapsed(now)));
          const target = hover.current ?? frontTile(state);
          const plan = target ? actionFor(state, target) : null;
          setHint(plan && plan.action !== "walk" && plan.action !== "none" ? plan.label : plan?.label ?? "");
        }
        frame = requestAnimationFrame(render);
      };
      frame = requestAnimationFrame(render);
    }).catch(cause => {
      if (version !== epoch.current) return;
      setFailed(true);
      setStatus(cause instanceof Error && cause.message.includes("does not match") ? cause.message : "Your Friend's artwork or the game session could not load. Check your connection and retry.");
    });
    return () => {
      epoch.current++; cancelAnimationFrame(frame); observer.disconnect(); stop(); recorder.current.cancel();
      window.removeEventListener("blur", stop); document.removeEventListener("visibilitychange", stop); window.removeEventListener("message", receive);
      saveNow(); clearInterval(saver); window.removeEventListener("pagehide", saveNow);
      sound.current?.dispose(); sound.current = null; audio.current?.dispose(); audio.current = null;
    };
  }, [friendId, client, revision, syncBlessings, loadSprites]);
  const cameraRef = useRef<Camera | null>(null);

  const frontTile = (state: ValleyState): Tile => { const here = farmerTile(state); return { x: here.x + state.farmer.dirX, y: here.y + state.farmer.dirY }; };
  /** Villager art: canonical sprites for owned Friends and the canonical regulars, procedural Friends for the rest. */
  function artFor(resident: ValleyState["residents"][number], facing: Facing, walking: boolean, frameIndex: number): readonly string[] {
    const token = resident.owned ?? (CANONICAL[resident.id] !== undefined && CANONICAL[resident.id] !== friendId ? Number(CANONICAL[resident.id]) : null);
    const sprites = token !== null ? ownedSprites.current.get(token) : undefined;
    if (sprites) return friendRows(sprites, facing, walking, frameIndex);
    const guest = GUESTS.filter(item => item.family === FAMILY_NAMES[resident.family])[resident.owned !== null ? resident.owned % 2 : 0] ?? GUESTS[resident.family % GUESTS.length];
    return guest.frames[walking ? frameIndex % 2 : 0];
  }

  /** Engine events → sounds, floating text, toasts and menus. */
  function handleEvents(state: ValleyState) {
    const player = audio.current;
    for (const event of state.events.splice(0)) {
      if (event.kind === "action") {
        if (event.action === "till") player?.till(); else if (event.action === "water") player?.water(); else if (event.action === "plant") player?.plant();
        else if (event.action === "clear") player?.clear(); else if (event.action === "refill") player?.refill(); else if (event.action === "forage") player?.forage();
        else if (event.action === "harvest") { player?.harvest(Boolean(event.golden)); if (event.golden || event.bonus) floaters.current.push({ text: event.golden ? "golden!" : "×2", x: event.x, y: event.y, age: 0, tone: event.golden ? "golden" : "info" }); }
      } else if (event.kind === "say") say(event.text);
      else if (event.kind === "bump") player?.bump();
      else if (event.kind === "coins") { player?.coins(); floaters.current.push({ text: `+${event.amount} G`, x: state.farmer.x, y: state.farmer.y, age: 0, tone: "gold" }); }
      else if (event.kind === "talk") player?.chirp(event.family);
      else if (event.kind === "gift") player?.gift(event.reaction);
      else if (event.kind === "heart") { player?.heart(); const who = state.residents.find(item => item.id === event.villager); if (who) floaters.current.push({ text: "♥", x: who.walker.x, y: who.walker.y, age: 0, tone: "heart" }); say(`${who?.name ?? "A friend"} now has ${event.hearts} heart${event.hearts > 1 ? "s" : ""} for you!`); }
      else if (event.kind === "tired") { player?.tired(); say("You're getting tired. Eat something, or head to bed soon."); }
      else if (event.kind === "exhausted") player?.exhausted();
      else if (event.kind === "drowsy") { player?.drowsy(); say("It's past midnight… you'll pass out at 2 am. Get to bed!"); }
      else if (event.kind === "travel") { player?.travel(); focus.current = { x: state.farmer.x, y: state.farmer.y }; say(event.map === "town" ? "Welcome to town! Shops, the café and the Moonlight Market are north of the plaza." : "Back on the farm."); }
      else if (event.kind === "morning") player?.morning();
      else if (event.kind === "season") { player?.season(); say(`${SEASON_NAMES[event.season]} has arrived! New seeds are at the General Store.`); }
      else if (event.kind === "eat") player?.eat();
      else if (event.kind === "buy") player?.buy();
      else if (event.kind === "place") player?.place();
      else if (event.kind === "request") player?.request();
      else if (event.kind === "open") openPlace(state, event.what, event.target);
    }
  }
  function openPlace(state: ValleyState, what: "talk" | "bin" | "bed" | "shop" | "board", target?: string) {
    if (what === "talk" && target) { const line = talk(state, target); setMenu({ kind: "talk", id: target, line }); setBagSelected(firstGift(state)); return; }
    if (what === "shop" && (target === "store" || target === "cafe" || target === "market")) {
      if (!shopOpen(state, target)) { say(`${PLACE_NAMES[target]} is closed. Open ${clockText(SHOP_HOURS[target][0])}–${clockText(SHOP_HOURS[target][1])}.`); audio.current?.bump(); return; }
      audio.current?.select(); setError(""); setMenu({ kind: target }); return;
    }
    audio.current?.select(); setError("");
    setMenu({ kind: what === "board" ? "board" : what === "bin" ? "bin" : "bed" });
  }
  const firstGift = (state: ValleyState) => Math.max(0, state.inventory.findIndex(slot => slot && !slot.id.startsWith("seed:") && slot.id !== "fertilizer"));

  // ---------- Audio ----------
  const wake = useRef(() => {});
  wake.current = wakeAudio;
  useEffect(() => {
    const listener = () => wake.current();
    const events = ["pointerup", "click", "keydown", "touchend"] as const;
    for (const name of events) window.addEventListener(name, listener, { capture: true, passive: true });
    return () => { for (const name of events) window.removeEventListener(name, listener, { capture: true }); };
  }, []);
  /** Start audio from a user gesture and apply the saved preferences. */
  function wakeAudio() {
    const player = audio.current, state = valley.current;
    if (!player) return;
    if (state) applyPrefs(state.prefs);
    player.unlock(); void sound.current?.unlock();
  }
  function applyPrefs(prefs: Prefs) {
    const player = audio.current, state = valley.current;
    if (!player) return;
    player.setMusic(prefs.music); player.setSfx(prefs.sfx); player.setVolume(prefs.volume);
    if (state) player.setTrack(trackFor(prefs.track as TrackId, season(state), isNight(state)));
  }
  // The soundtrack follows the season and switches to the lullaby at night.
  const seasonKey = hud ? `${hud.date.split(" ")[0]}:${hud.night}` : "";
  useEffect(() => { const state = valley.current; if (state) applyPrefs(state.prefs); }, [seasonKey]);
  function changePrefs(prefs: Prefs) {
    const state = valley.current;
    if (!state) return;
    state.prefs = prefs; applyPrefs(prefs); audio.current?.unlock(); refresh();
  }
  function toggleMute() {
    const next = !muted; setMuted(next); sound.current?.setMuted(next); audio.current?.setMuted(next);
    if (!next) wakeAudio();
  }

  // ---------- Input ----------
  const blocked = paused || menu !== null || reveal !== null || !hud || hud.phase !== "play";
  function pointerToView(event: { clientX: number; clientY: number }) {
    const rect = canvas.current!.getBoundingClientRect(), { width, height } = view.current;
    return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height };
  }
  function tap(event: React.PointerEvent<HTMLCanvasElement>) {
    const state = valley.current, camera = cameraRef.current;
    if (!state || !camera || (blocked && !placing)) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); setManual(state, null);
    const point = pointerToView(event), tile = tileUnder(camera, point.x, point.y);
    if (placing) { placeAt(tile); return; }
    const resident = residentUnder({ state, camera }, point.x, point.y);
    const feedback = tapTile(state, resident ? { x: Math.round(resident.walker.x), y: Math.round(resident.walker.y) } : tile);
    if (feedback) { say(feedback); if (/can't|first|no |closer|full|exhausted|empty/i.test(feedback)) audio.current?.bump(); }
    setHud(readHud(state));
  }
  function placeAt(tile: Tile) {
    const state = valley.current;
    if (!state || !placing) return;
    if (placing.kind === "pickup") { const problem = pickUpDecor(state, tile); say(problem ?? "Picked up. It's back in Decorate."); setPlacing({ ...placing, tile }); refresh(); return; }
    const problem = placeDecor(state, placing.kind, tile);
    if (problem) { say(problem); audio.current?.bump(); setPlacing({ ...placing, tile }); return; }
    say(`${decorByKind(placing.kind).name} placed.`); setPlacing(null); refresh(); focusCanvas();
  }
  function keyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const state = valley.current;
    if (!state || event.target !== canvas.current) return;
    const key = event.key.toLowerCase();
    if (placing) {
      const cursor = placing.tile ?? frontTile(state);
      if (DIRECTIONS[key]) { event.preventDefault(); const d = screenToWorldDir(cameraAngle.current.target, DIRECTIONS[key].dx, DIRECTIONS[key].dy); setPlacing({ ...placing, tile: { x: cursor.x + d.dx, y: cursor.y + d.dy } }); }
      else if (key === "enter" || key === " " || key === "e") { event.preventDefault(); placeAt(cursor); }
      else if (key === "escape") { event.preventDefault(); setPlacing(null); }
      return;
    }
    if (key === "q" || key === "[") { event.preventDefault(); rotate(-1); return; }
    if (key === "r" || key === "]") { event.preventDefault(); rotate(1); return; }
    if (blocked) return;
    if (DIRECTIONS[key]) { event.preventDefault(); setManual(state, screenToWorldDir(cameraAngle.current.target, DIRECTIONS[key].dx, DIRECTIONS[key].dy)); return; }
    if (event.repeat) return;
    if (/^[1-5]$/.test(key)) { event.preventDefault(); chooseTool(TOOLS[Number(key) - 1]); }
    else if (key === "e" || key === " " || key === "enter") { event.preventDefault(); const message = actInFront(state); if (message) say(message); }
    else if (key === "b" || key === "i") { event.preventDefault(); openMenu({ kind: "bag" }); }
    else if (key === "c") { event.preventDefault(); void toggleClip(); }
    setHud(readHud(state));
  }
  function keyUp(event: ReactKeyboardEvent<HTMLElement>) {
    const direction = DIRECTIONS[event.key.toLowerCase()], state = valley.current;
    if (!direction || !state?.manual) return;
    const world = screenToWorldDir(cameraAngle.current.target, direction.dx, direction.dy);
    if (state.manual.dx === world.dx && state.manual.dy === world.dy) setManual(state, null);
  }
  function rotate(turn: number) { cameraAngle.current.target = Math.round(cameraAngle.current.target) + turn; audio.current?.select(); }
  function chooseTool(tool: ToolId) {
    const state = valley.current;
    if (!state) return;
    // Pressing Seeds again cycles through your seed packets.
    if (tool === "seeds" && state.tool === "seeds") {
      const packets = state.inventory.map((slot, index) => ({ slot, index })).filter(item => item.slot?.id.startsWith("seed:"));
      if (packets.length > 1) { const at = packets.findIndex(item => item.index === state.selected); state.selected = packets[(at + 1) % packets.length].index; }
      else if (packets[0]) state.selected = packets[0].index;
    } else if (tool === "seeds") { const seeds = activeSeeds(state); if (seeds) state.selected = state.inventory.indexOf(seeds); }
    state.tool = tool; audio.current?.select();
    const seeds = activeSeeds(state);
    say(tool === "seeds" ? (seeds ? `${itemInfo(seeds.id).name} × ${seeds.count}${cropById(seeds.id.slice(5) as never).season !== season(state) ? " (out of season!)" : ""}` : "No seeds. Buy some at the General Store in town.") : tool === "hand" ? "Hands: tap to harvest, till, plant or water, whatever the tile needs." : TOOL_NAMES[tool]);
    setHud(readHud(state)); focusCanvas();
  }
  const focusCanvas = () => requestAnimationFrame(() => canvas.current?.focus({ preventScroll: true }));
  function openMenu(next: Menu) { if (!paused && !busy) { setMenu(next); setError(""); } }
  function closeMenu() { if (busy) return; setMenu(null); focusCanvas(); }

  // ---------- Days ----------
  function startDay() { const state = valley.current; if (!state || paused) return; wakeAudio(); wakeUp(state); setShareStatus(""); setMenu(null); setHud(readHud(state)); cue("action-ready"); focusCanvas(); }
  function goToBed() {
    const state = valley.current, node = canvas.current;
    if (!state || paused) return;
    if (node) { const photo = document.createElement("canvas"); photo.width = node.width; photo.height = node.height; photo.getContext("2d")!.drawImage(node, 0, 0); bedPhoto.current = photo; }
    sleep(state); setMenu(null); setHud(readHud(state)); saveSoon();
  }
  const saveSoon = () => { lastSave.current = ""; };

  // Diary card for the day that just ended.
  const diaryKey = hud?.phase === "diary" && valley.current?.lastDiary ? `${valley.current.lastDiary.season}-${valley.current.lastDiary.day}-${valley.current.lastDiary.year}` : null;
  useEffect(() => {
    const state = valley.current, sprites = friend.current, diary = state?.lastDiary;
    if (!diaryKey || !state || !sprites || !diary) return;
    const image = renderDiaryCard({ diary, friendId, familyId: sprites.familyId, scene: bedPhoto.current ?? canvas.current, portrait: friendRows(sprites, "down", false, 0) });
    let url = "", cancelled = false;
    image.toBlob(blob => { if (!blob || cancelled) return; url = URL.createObjectURL(blob); setCard({ key: diaryKey, blob, url, text: diaryText(diary, friendId, sprites.familyId) }); }, "image/png");
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [diaryKey, friendId]);
  function shareFile(action: ShareAction, file: Blob, text: string, filename: string) {
    if (paused) return;
    setShareStatus(action === "post" ? "Opening X…" : action === "copy" ? "Copying…" : "Saving…");
    window.parent.postMessage({ type: SHARE_REQUEST, action, text, file, filename }, "*");
    if (shareTimer.current) clearTimeout(shareTimer.current);
    shareTimer.current = setTimeout(() => setShareStatus("Sharing works on the RareFriends Valley page (the GitHub Pages link), not in this runtime."), 2500);
    cue("select");
  }
  useEffect(() => () => { if (shareTimer.current) clearTimeout(shareTimer.current); }, []);

  // ---------- Friend Films: GIF + video clips ----------
  async function toggleClip() {
    const node = canvas.current, state = valley.current;
    if (!node || !state || paused || encoding !== null) return;
    if (recorder.current.recording) { await finishClip(); return; }
    wakeAudio(); audio.current?.shutter();
    setMenu(null); orbitFrom.current = cameraAngle.current.target;
    recorder.current.start(node, audio.current?.stream() ?? null, performance.now());
    setRecording(0.1); say("Recording a clip… tap ■ to stop early.");
  }
  async function finishClip() {
    if (!recorder.current.recording) return;
    audio.current?.shutter(); setRecording(0); setEncoding(0);
    cameraAngle.current.target = Math.round(cameraAngle.current.current);
    const result = await recorder.current.stop(fraction => setEncoding(fraction));
    setEncoding(null);
    if (clip?.gifUrl) URL.revokeObjectURL(clip.gifUrl);
    setClip({ ...result, gifUrl: result.gif ? URL.createObjectURL(result.gif) : null }); setShareStatus(""); setMenu({ kind: "clip" });
  }

  // ---------- Shops ----------
  function buy(item: Purchase) {
    const state = valley.current;
    if (!state || paused) return;
    const problem = purchase(state, item);
    setError(problem ?? ""); if (!problem) cue("purchase");
    setHud(readHud(state)); refresh();
  }

  // ---------- Moonlight Blessings: the SDK's simulated RF chance-game actions ----------
  async function act(work: () => Promise<void>, after?: (value: GameSnapshot) => void) {
    if (locked.current || paused) return;
    const version = epoch.current; locked.current = true; setBusy(true); setError(""); void sound.current?.unlock();
    try {
      await work();
      const value = await client.read();
      if (version === epoch.current) { setSnapshot(value); syncBlessings(value); after?.(value); }
    } catch (cause) {
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : "The blessing action did not complete.");
    } finally { if (version === epoch.current) { locked.current = false; setBusy(false); } }
  }
  const maxPrize = maximumPrize(definition);
  const pendingPlays = snapshot?.plays.filter(play => play.outcomeId === null) ?? [];
  const canBuy = (count: number) => Boolean(snapshot && snapshot.rfBalance >= definition.price * BigInt(count)
    && snapshot.freeStake >= maxPrize && snapshot.freeStake + definition.price * BigInt(count) >= maxPrize * BigInt(count));
  const openBlessings = (count: number) => {
    wakeAudio(); audio.current?.crank(); setSpinning(true);
    return act(async () => {
      const version = epoch.current, state = valley.current;
      const plays = pendingPlays.length ? pendingPlays : await client.play(BigInt(count));
      const results: Reveal[] = [];
      for (const play of plays) {
        const settled = await client.settle(play.id);
        if (settled.outcomeId === null || !state) continue;
        results.push({ outcomeId: settled.outcomeId, ...collectFromBlessing(state, settled.outcomeId - 1), redeemed: false });
      }
      if (version !== epoch.current || !results.length) return;
      const best = Math.max(...results.map(result => result.outcomeId));
      audio.current?.sparkle(); cue(best >= 4 ? "reveal-legendary" : best >= 2 ? "reveal-rare" : "reveal-common");
      setReveal(results); if (state) setHud(readHud(state));
    }).finally(() => setSpinning(false));
  };

  const state = valley.current;
  const familyName = friend.current ? FAMILY_NAMES[friend.current.familyId] : "";
  const familyPerk = friend.current ? FAMILY_PERKS[friend.current.familyId] : null;
  const kept = snapshot?.inventory.reduce((sum, amount) => sum + amount, 0n) ?? 0n;
  const statueRows = friend.current ? friendRows(friend.current, "down", false, 0) : null;
  const tools: Tool[] = hud ? [
    { id: "hand", label: "Hands" }, { id: "hoe", label: "Hoe" }, { id: "can", label: "Can", count: `${hud.water}` },
    { id: "seeds", label: "Seeds", count: `${hud.seeds}` }, { id: "fertilizer", label: "Fertilizer", count: `${hud.fertilizer}${hud.charges ? `+${hud.charges}` : ""}` },
  ] : [];

  // HUD portrait: the verified Friend's canonical idle frame.
  const portraitReady = Boolean(hud);
  useEffect(() => {
    const node = portrait.current, ctx = node?.getContext("2d"), sprites = friend.current;
    if (!node || !ctx || !sprites) return;
    const rows = sprites.clips.idle[sprites.familyId === 6 ? "right" : "down"][0].rows;
    ctx.clearRect(0, 0, 54, 54); ctx.fillStyle = "#fff";
    rows.forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === "#") ctx.fillRect(x * 3, y * 3, 9, 9); }));
    ctx.fillStyle = "#161616";
    rows.forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === "#") ctx.fillRect(x * 3 + 3, y * 3 + 3, 3, 3); }));
  }, [portraitReady, friendId]);

  const talking = menu?.kind === "talk" && state ? state.residents.find(item => item.id === menu.id) ?? null : null;
  const talkingInfo = talking ? VILLAGERS.find(item => item.id === talking.id) : null;
  const giftSlot = state?.inventory[bagSelected] ?? null;
  const clockPercent = hud ? Math.min(100, Math.max(0, (hud.minute - 360) / (1560 - 360) * 100)) : 0;

  return <section className="valley-game" aria-label="RareFriends Valley" aria-busy={busy}
    data-phase={hud?.phase ?? "loading"} data-gold={hud?.gold ?? 0} data-energy={hud?.energy ?? 0} data-map={hud?.map ?? ""} data-minute={hud?.minute ?? 0}
    data-tool={hud?.tool ?? ""} data-recording={recording ? "on" : "off"} data-linked={linked.current ? "yes" : "no"} data-owned={state?.residents.filter(item => item.owned !== null).length ?? 0}
    data-angle={Math.round(cameraAngle.current.target)} data-decor={state?.decor.length ?? 0} data-day={state ? `${state.season}-${state.day}` : ""}
    data-tile={state ? `${farmerTile(state).x},${farmerTile(state).y}` : ""} data-crops={state ? [...state.plots.values()].filter(plot => plot.crop).length : 0}
    data-tilled={state ? [...state.plots.values()].filter(plot => plot.tilled).length : 0} data-watered={state ? [...state.plots.values()].filter(plot => plot.watered).length : 0}>
    <div className="valley-world" inert={menu !== null || reveal !== null || paused || undefined}>
      <canvas ref={canvas} tabIndex={blocked && !placing ? -1 : 0}
        aria-label={placing ? "Decorate: tap a tile (or use arrow keys and Enter) to place; Escape to stop." : "Your farm. Tap tiles to use your tool, tap villagers to talk. Keys: WASD or arrows walk, E acts, 1 to 5 pick tools, Q and R rotate the camera, B opens your bag, C records a clip."}
        onPointerDown={tap}
        onPointerMove={event => {
          const state = valley.current, camera = cameraRef.current;
          if (event.pointerType !== "mouse" || !state || !camera) return;
          const point = pointerToView(event), tile = tileUnder(camera, point.x, point.y);
          if (placing) { if (tile.x !== placing.tile?.x || tile.y !== placing.tile?.y) setPlacing({ ...placing, tile }); return; }
          hover.current = tile;
        }}
        onPointerLeave={() => { hover.current = null; }}
        onKeyDown={keyDown} onKeyUp={keyUp} onBlur={() => { if (valley.current) setManual(valley.current, null); }} />
      {hud && <>
        <div className="valley-hud">
          <div className="valley-card">
            <canvas ref={portrait} className="valley-portrait" width={54} height={54} role="img" aria-label={`Your Friend #${friendId.toString()}, ${familyName}`} />
            <strong className="valley-title">{hud.date}</strong>
            <span className="valley-day">{WEATHER_ICON[hud.weather]} {hud.clock}<span className="valley-wide"> · {hud.map === "farm" ? "your farm" : "town"}</span></span>
            <span className="valley-clock" aria-hidden="true"><i style={{ width: `${clockPercent}%` }} /></span>
            <span className="valley-stats"><b aria-label={`${hud.gold} Gold`}>● {hud.gold} G</b><b aria-label={`Watering can ${hud.water} of ${hud.capacity}`}>💧{hud.water}</b></span>
            <span className={`valley-energy${hud.energy <= 25 ? " low" : ""}`} aria-label={`Energy ${hud.energy} of ${hud.maxEnergy}`}><i style={{ width: `${hud.energy / hud.maxEnergy * 100}%` }} /></span>
          </div>
          {!placing && <div className="valley-actions">
            <button type="button" className={recording ? "valley-rec on" : "valley-rec"} disabled={encoding !== null || paused || hud.phase !== "play"} onClick={() => void toggleClip()} aria-label={recording ? "Stop recording" : "Record a clip"}>
              {recording ? `■ ${recording.toFixed(1)}s` : encoding !== null ? `GIF ${Math.round(encoding * 100)}%` : "● Clip"}</button>
            <button type="button" className="valley-wide" onClick={() => rotate(-1)} aria-label="Rotate camera left" title="Rotate (Q)">↺</button>
            <button type="button" onClick={() => rotate(1)} aria-label="Rotate camera right" title="Rotate (R)">↻</button>
            {!recording && <>
              <button type="button" onClick={() => openMenu({ kind: "bag" })}>Bag</button>
              {hud.map === "farm" && <button type="button" className="valley-wide" onClick={() => openMenu({ kind: "decor" })}>Decorate</button>}
              <button type="button" onClick={() => openMenu({ kind: "settings" })} aria-label="Settings">⚙</button>
              <button type="button" className="valley-wide" aria-pressed={!muted} aria-label="Sound" title={muted ? "Sound off" : "Sound on"} onClick={toggleMute}>{muted ? "♪̸" : "♪"}</button>
            </>}
          </div>}
        </div>
        {hud.phase === "play" && !placing && <div className="valley-footer">
          <p role="status" aria-live="polite">{toast || hint || (hud.map === "farm" ? "Tap the field to work it · walk east to town" : "Tap a door to shop · walk west to the farm")}</p>
          {!recording && <Hotbar tools={tools} active={hud.tool} seeds={state ? activeSeeds(state) : null} onTool={chooseTool} />}
        </div>}
        {placing && <div className="valley-footer valley-placing">
          <p role="status">{toast || (placing.kind === "pickup" ? "Tap a décor item to pick it up." : `Placing ${decorByKind(placing.kind).name}: tap a tile. Its boost area is highlighted.`)}</p>
          <button type="button" className="rf-frame-primary" onClick={() => { setPlacing(null); focusCanvas(); }}>Done</button>
        </div>}
      </>}
    </div>

    {status && <div className="valley-status" role={failed ? "alert" : "status"}><div className="valley-sprout" aria-hidden="true">🌱</div><p>{status}</p>
      {failed && <button type="button" disabled={paused} onClick={() => setRevision(value => value + 1)}>Retry</button>}</div>}

    {hud?.phase === "intro" && !menu && state && <GameMenu title={state.started ? "Welcome back to the valley" : "Welcome to RareFriends Valley"}>
      {state.started ? <p>Your wallet's farm is restored: {dateText(state)}, {clockText(Math.floor(state.minute))}, {state.gold} Gold, {[...state.plots.values()].filter(plot => plot.crop).length} crops growing.</p>
        : <p>Your Rare Friend <strong>#{friendId.toString()}</strong> ({familyName}) just inherited a little farm on the edge of a greyscale valley. Everyone in town is a Rare Friend too{state.residents.some(item => item.owned !== null) ? `, including ${state.residents.filter(item => item.owned !== null).length} of your own Friends who moved in` : ""}.</p>}
      {familyPerk && <p className="valley-perk"><strong>{familyName} perk · {familyPerk.title}:</strong> {familyPerk.text}</p>}
      {!state.started && <ol className="valley-steps">
        <li><strong>Clear, till, plant, water.</strong> Tap the field with Hands and your Friend does whatever the tile needs. Water every day: crops grow overnight.</li>
        <li><strong>Ship</strong> crops in the bin by your house (paid each morning), then buy seeds and upgrades in <strong>town</strong>, east along the road.</li>
        <li><strong>Mind your energy.</strong> Eat, or sleep before 2 am. Seasons turn every {7} days; each has its own crops.</li>
        <li><strong>● Clip</strong> records a little GIF and video of your farm, with music, to save or post.</li>
      </ol>}
      <button type="button" className="rf-frame-primary" disabled={paused} onClick={startDay}>{state.started ? "Keep farming" : "Start farming"}</button>
      <button type="button" disabled={paused} onClick={() => openMenu({ kind: "help" })}>Controls</button>
    </GameMenu>}

    {hud?.phase === "diary" && !menu && state?.lastDiary && <GameMenu title={`${SEASON_NAMES[state.lastDiary.season]} ${state.lastDiary.day} · diary`}>
      {state.lastDiary.passedOut && <p className="valley-perk"><strong>You passed out!</strong> Pip carried you home. You lost a little Gold and woke up tired.</p>}
      <div className="valley-summary">
        <p><span>Harvested</span><strong>{state.lastDiary.harvested}</strong></p>
        <p><span>Crops grew</span><strong>{state.lastDiary.grown}{state.lastDiary.bonusGrowth ? ` (+${state.lastDiary.bonusGrowth} boosted)` : ""}</strong></p>
        <p><span>Shipped</span><strong>{state.lastDiary.shipped.map(slot => `${slot.count} ${itemInfo(slot.id).name}`).join(", ") || "nothing"}</strong></p>
        <p><span>Gold earned</span><strong>{state.lastDiary.earned} G</strong></p>
        {state.lastDiary.hearts.length > 0 && <p><span>New hearts</span><strong>{state.lastDiary.hearts.join(", ")}</strong></p>}
        {state.lastDiary.withered > 0 && <p><span>Withered (season ended)</span><strong>{state.lastDiary.withered}</strong></p>}
        <p><span>Today</span><strong>{WEATHER_ICON[state.weather]} {dateText(state)}</strong></p>
      </div>
      {helpers(state).length > 0 && <p className="valley-note">{helpers(state).map(item => item.name).join(", ")} will water some crops for you this morning.</p>}
      <div className="valley-share">
        <h3>Share your day on X</h3>
        {card?.key === diaryKey ? <img src={card.url} alt="Your farm diary card" /> : <p role="status">Drawing your diary card…</p>}
        <div className="valley-buttons">
          <button type="button" className="rf-frame-primary" disabled={paused || card?.key !== diaryKey} onClick={() => card && shareFile("post", card.blob, card.text, `rarefriends-valley-${diaryKey}`)}>Post to X</button>
          <button type="button" disabled={paused || card?.key !== diaryKey} onClick={() => card && shareFile("copy", card.blob, card.text, `rarefriends-valley-${diaryKey}`)}>Copy picture</button>
          <button type="button" disabled={paused || card?.key !== diaryKey} onClick={() => card && shareFile("save", card.blob, card.text, `rarefriends-valley-${diaryKey}`)}>Save picture</button>
        </div>
        {shareStatus && <p role="status">{shareStatus}</p>}
      </div>
      <button type="button" className="rf-frame-primary" disabled={paused} onClick={startDay}>Start the day</button>
    </GameMenu>}

    {menu?.kind === "bed" && state && <GameMenu title="Your house" onClose={closeMenu}>
      <p>It's {clockText(Math.floor(state.minute))}. Crops you watered today grow overnight, and the shipping bin pays out in the morning{binValue(state) ? ` (${binValue(state)} G waiting)` : ""}.</p>
      <p className="valley-note">{thirstyCrops(state) ? `${thirstyCrops(state)} crop${thirstyCrops(state) > 1 ? "s" : ""} still need water. ` : "Everything is watered. "}{ripeCrops(state) ? `${ripeCrops(state)} ready to harvest. ` : ""}Tomorrow looks {state.tomorrow === "sun" ? "sunny" : state.tomorrow === "rain" ? "rainy (no watering needed!)" : "snowy"}.</p>
      <button type="button" className="rf-frame-primary" disabled={paused} onClick={goToBed}>Sleep until morning</button>
      <button type="button" disabled={paused} onClick={closeMenu}>Not yet</button>
    </GameMenu>}

    {menu?.kind === "bin" && state && <GameMenu title={`Shipping bin · ${binValue(state)} G tonight`} onClose={closeMenu}>
      <p>Everything in the bin is paid tomorrow morning{state.familyId === 1 ? " (+10% Mask perk)" : ""}{state.blessings[2] ? ` (+${Math.min(3, state.blessings[2]) * 10}% Moon Bloom)` : ""}.</p>
      {state.inventory.filter((slot): slot is NonNullable<typeof slot> => Boolean(slot) && !slot!.id.startsWith("seed:") && slot!.id !== "fertilizer").map(slot =>
        <div className="valley-row" key={slot.id}><ItemIcon id={slot.id} /><span><strong>{itemInfo(slot.id).name} × {countItem(state, slot.id)}</strong><small>{itemInfo(slot.id).sell} G each</small></span>
          <button type="button" disabled={paused} onClick={() => { say(ship(state, slot.id, 1)); refresh(); }}>Ship 1</button>
          <button type="button" disabled={paused} onClick={() => { say(ship(state, slot.id, 999)); refresh(); }}>Ship all</button></div>)}
      {!state.inventory.some(slot => slot && !slot.id.startsWith("seed:") && slot.id !== "fertilizer") && <p className="valley-note">Nothing to ship yet. Harvest crops or pick up forage first.</p>}
      {state.bin.length > 0 && <p className="valley-note">In the bin: {state.bin.map(slot => `${slot.count} ${itemInfo(slot.id).name}`).join(", ")}.</p>}
    </GameMenu>}

    {menu?.kind === "board" && state && <GameMenu title="Notice board" onClose={closeMenu}>
      {state.request ? <div className="valley-row"><ItemIcon id={state.request.item} /><span>
        <strong>{VILLAGERS.find(item => item.id === state.request!.villager)?.name} wants {state.request.count} × {itemInfo(state.request.item).name}</strong>
        <small>{state.request.done ? "Delivered today. Thank you!" : `Reward: ${state.request.reward} G and friendship · you have ${countItem(state, state.request.item)}`}</small></span>
        <button type="button" disabled={paused || state.request.done || countItem(state, state.request.item) < state.request.count} onClick={() => { say(deliverRequest(state)); refresh(); }}>Deliver</button></div>
        : <p>No requests today.</p>}
      <p className="valley-note">A new request goes up every morning.</p>
    </GameMenu>}

    {talking && menu?.kind === "talk" && state && <GameMenu title={talking.name} onClose={closeMenu}>
      <div className="valley-talk">
        <SpriteChip rows={artFor(talking, "down", false, 0)} size={64} label={talking.name} />
        <div><p className="valley-line">“{menu.line}”</p>
          <p className="valley-note">{talkingInfo ? `${talking.name} ${talkingInfo.role}.` : `Your own Friend #${talking.owned}. At ${HELPER_HEARTS} hearts they help water your crops each morning.`}</p>
          <Hearts points={talking.points} /></div>
      </div>
      <h3>Give a gift {talking.gifted ? "(one a day: done)" : ""}</h3>
      <Inventory slots={state.inventory} selected={bagSelected} onSelect={setBagSelected} />
      {giftSlot && !giftSlot.id.startsWith("seed:") && giftSlot.id !== "fertilizer" ? <button type="button" className="rf-frame-primary" disabled={paused || talking.gifted} onClick={() => { say(giveGift(state, talking.id, giftSlot.id)); refresh(); }}>
        Give {itemInfo(giftSlot.id).name}{talkingInfo && giftReaction(talking.id, giftSlot.id) === "love" && hearts(talking) >= 1 ? " ♥" : ""}</button> : <p className="valley-note">Pick a crop, forage or food to give.</p>}
      {talkingInfo && hearts(talking) >= 2 && <p className="valley-note">{talking.name} loves {talkingInfo.loves.map(id => itemInfo(id).name).join(" and ")}.</p>}
    </GameMenu>}

    {menu?.kind === "bag" && state && <GameMenu title={`Bag · ${state.gold} G`} onClose={closeMenu}>
      <Inventory slots={state.inventory} selected={bagSelected} onSelect={index => { setBagSelected(index); const slot = state.inventory[index]; if (slot?.id.startsWith("seed:")) { state.selected = index; state.tool = "seeds"; } }} />
      {giftSlot && <div className="valley-row"><ItemIcon id={giftSlot.id} /><span><strong>{itemInfo(giftSlot.id).name} × {giftSlot.count}</strong>
        <small>{giftSlot.id.startsWith("seed:") ? `${cropById(giftSlot.id.slice(5) as never).season} crop · ${cropById(giftSlot.id.slice(5) as never).days} days to grow${cropById(giftSlot.id.slice(5) as never).regrow ? `, regrows every ${cropById(giftSlot.id.slice(5) as never).regrow}` : ""} · selected for the Seeds tool`
          : itemInfo(giftSlot.id).energy ? `Restores ${itemInfo(giftSlot.id).energy} energy · sells for ${itemInfo(giftSlot.id).sell} G` : `Sells for ${itemInfo(giftSlot.id).sell} G`}</small></span>
        {itemInfo(giftSlot.id).energy > 0 && <button type="button" disabled={paused} onClick={() => { say(eat(state, giftSlot.id)); refresh(); }}>Eat</button>}</div>}
      <div className="valley-buttons">
        {state.farmer.map === "farm" && <button type="button" disabled={paused} onClick={() => setMenu({ kind: "decor" })}>Decorate</button>}
        <button type="button" disabled={paused} onClick={() => setMenu({ kind: "settings" })}>Settings & music</button>
      </div>
      <p className="valley-note">Energy {Math.round(state.energy)}/{maxEnergy(state)} · watering can {state.water}/{canCapacity(state)} · {state.sproutCharges} Sprout Fertilizer charges · backpack {state.inventory.length} slots.</p>
    </GameMenu>}

    {menu?.kind === "store" && state && <GameMenu title={`General Store · ${state.gold} G`} onClose={closeMenu}>
      <div className="valley-tabs" role="tablist" aria-label="Store">
        {(["seeds", "tools", "decor"] as const).map(name => <button type="button" role="tab" key={name} aria-selected={storeTab === name} onClick={() => setStoreTab(name)}>{name === "seeds" ? "Seeds" : name === "tools" ? "Tools & supplies" : "Décor"}</button>)}
      </div>
      {storeTab === "seeds" ? <>{CROPS.filter(crop => crop.season === season(state)).map(crop => <div className="valley-row" key={crop.id}><ItemIcon id={`seed:${crop.id}`} />
        <span><strong>{crop.name} seeds</strong><small>{crop.days} days{crop.regrow ? `, regrows every ${crop.regrow}` : ""} · sells {crop.sell} G · you have {countItem(state, `seed:${crop.id}`)}</small></span>
        <button type="button" disabled={paused || state.gold < crop.seed} onClick={() => buy({ kind: "seed", crop: crop.id, count: 1 })}>{crop.seed} G</button>
        <button type="button" disabled={paused || state.gold < crop.seed * 5} onClick={() => buy({ kind: "seed", crop: crop.id, count: 5 })}>×5</button></div>)}
        <p className="valley-note">Only {SEASON_NAMES[season(state)].toLowerCase()} seeds are sold now. Crops left in the field when the season turns wither.</p></>
      : storeTab === "tools" ? <>
        <div className="valley-row"><ItemIcon id="fertilizer" /><span><strong>Fertilizer</strong><small>+30% chance a crop grows an extra day overnight · you have {countItem(state, "fertilizer")}</small></span>
          <button type="button" disabled={paused || state.gold < FERTILIZER_PRICE} onClick={() => buy({ kind: "fertilizer", count: 1 })}>{FERTILIZER_PRICE} G</button>
          <button type="button" disabled={paused || state.gold < FERTILIZER_PRICE * 5} onClick={() => buy({ kind: "fertilizer", count: 5 })}>×5</button></div>
        {([["can", `Watering can: ${CAN_CAPACITY[Math.min(state.canLevel + 1, 2)]} water, waters a line of three`, "can"], ["hoe", "Hoe: tills a line of three tiles", "hoe"], ["pack", `Backpack: ${BACKPACK_SLOTS[Math.min(state.packLevel + 1, 2)]} slots`, "seeds"]] as const).map(([kind, text, icon]) => {
          const price = priceOf(state, { kind });
          return <div className="valley-row" key={kind}><ItemIcon id={icon} /><span><strong>{kind === "can" ? "Watering can upgrade" : kind === "hoe" ? "Hoe upgrade" : "Bigger backpack"}</strong><small>{price === null ? "Fully upgraded" : text}</small></span>
            {price === null ? <em>Maxed</em> : <button type="button" disabled={paused || state.gold < price} onClick={() => buy({ kind })}>{price} G</button>}</div>;
        })}
      </> : <>{DECOR.filter(item => item.tier === undefined).map(item => <div className="valley-row" key={item.kind}><DecorPreview kind={item.kind} locked={false} statue={null} season={season(state)} />
        <span><strong>{item.name}</strong><small>{item.text} · you have {state.decorOwned[item.kind] ?? 0} to place</small></span>
        <button type="button" disabled={paused || state.gold < item.cost} onClick={() => buy({ kind: "decor", decor: item.kind })}>{item.cost} G</button></div>)}
        <p className="valley-note">Place décor from Decorate on your farm. RF-exclusive décor that boosts crops comes from Moonlight Blessings.</p></>}
      {error && <p role="alert">{error}</p>}
    </GameMenu>}

    {menu?.kind === "cafe" && state && <GameMenu title={`RareFriends Cafe · ${state.gold} G`} onClose={closeMenu}>
      <p>Pip slides a menu across the counter. Food restores energy right away.</p>
      {FOODS.map(food => <div className="valley-row" key={food.id}><ItemIcon id={food.id} /><span><strong>{food.name}</strong><small>{food.text}</small></span>
        <button type="button" disabled={paused || state.gold < food.price || state.energy >= maxEnergy(state)} onClick={() => { buy({ kind: "food", food: food.id }); say(`Delicious! Energy ${Math.round(state.energy)}/${maxEnergy(state)}.`); }}>{food.price} G</button></div>)}
      <p className="valley-note">Energy {Math.round(state.energy)}/{maxEnergy(state)}. Crops can be eaten from your bag too.</p>
      {error && <p role="alert">{error}</p>}
    </GameMenu>}

    {menu?.kind === "market" && !reveal && <GameMenu title="Moonlight Market" onClose={busy ? undefined : closeMenu}>
      {!snapshot || !state ? <p role="status">Loading the market…</p> : <>
        <div className="valley-machine" data-spin={spinning || busy} aria-hidden="true">
          <div className="dome">{[[12, 58], [40, 64], [66, 54], [22, 32], [52, 30], [34, 8], [70, 22]].map(([x, y], index) =>
            <i key={index} style={{ left: x, top: y, ["--c" as string]: CAPSULE_COLORS[index % 4] }} />)}</div>
          <div className="body"><b>RF · {snapshot.consumables.toString()}</b><span className="chute" /></div><span className="crank" />
        </div>
        <p className="valley-sim">{snapshot.mode === "preview" ? "Simulated RF preview. No real tokens or transactions." : "Live · Robinhood"} · Friend balance <strong>{rf(snapshot.rfBalance)}</strong> · {snapshot.consumables.toString()} blessing{snapshot.consumables === 1n ? "" : "s"} ready</p>
        <div className="valley-tabs" role="tablist" aria-label="Moonlight Market">
          {(["blessings", "collection", "kept"] as const).map(name => <button type="button" role="tab" key={name} aria-selected={marketTab === name} onClick={() => setMarketTab(name)}>
            {name === "blessings" ? "Blessings" : name === "collection" ? `RF décor · ${state.collection.size}/${EXCLUSIVES.length}` : `Kept · ${kept.toString()}`}</button>)}
        </div>
        {marketTab === "blessings" ? <>
          <p>Each Moonlight Blessing costs <strong>{rf(definition.price)}</strong>. It holds a <strong>blessing</strong> (keep it for daily fertilizer, dew or better prices, or redeem it for RF) plus an <strong>RF-exclusive décor piece</strong> that boosts the crops around it. Duplicates turn into Gold.</p>
          <div className="valley-buttons">
            <button type="button" className="rf-frame-primary" disabled={!canBuy(1) || busy || paused} onClick={() => void act(() => client.buy(1n), () => { cue("purchase"); say("One blessing added to your Friend."); })}>Buy 1 · {rf(definition.price)}</button>
            <button type="button" disabled={!canBuy(5) || busy || paused} onClick={() => void act(() => client.buy(5n), () => { cue("purchase"); say("Five blessings added to your Friend."); })}>Buy 5 · {rf(definition.price * 5n)}</button>
            <button type="button" disabled={busy || paused || (!pendingPlays.length && snapshot.consumables === 0n)} onClick={() => void openBlessings(1)}>{pendingPlays.length ? "Finish opening" : "Open one"}</button>
            <button type="button" disabled={busy || paused || pendingPlays.length > 0 || snapshot.consumables < 2n} onClick={() => void openBlessings(Number(snapshot.consumables > 99n ? 99n : snapshot.consumables))}>Open all ({snapshot.consumables.toString()})</button>
          </div>
          {!canBuy(1) && <p>{snapshot.rfBalance < definition.price ? "Not enough simulated RF in your Friend's wallet." : "New blessings are paused until the market has enough free backing."}</p>}
          <table className="valley-odds"><thead><tr><th>Blessing</th><th>Chance</th><th>RF value</th><th>Kept bonus</th><th>RF décor</th></tr></thead>
            <tbody>{definition.outcomes.map((item, index) => <tr key={item.name}><td>{item.name}</td><td>{item.chanceBps / 100}%</td><td>{rf(item.reward)}</td><td>{BLESSINGS[index]?.text}</td>
              <td>{EXCLUSIVES.filter(exclusive => exclusive.tier === index).map(exclusive => exclusive.name).join(", ")}</td></tr>)}</tbody></table>
          <p className="valley-note">Expected RF value {rf(expectedReward(definition))} per blessing. Every blessing reserves {rf(maxPrize)} of backing; kept blessings keep their RF value with no expiry. RF décor carries no RF value.</p>
        </> : marketTab === "collection" ? <div className="valley-collection">
          {EXCLUSIVES.map(item => {
            const owned = state.collection.has(item.kind), placed = state.decor.some(other => other.kind === item.kind);
            return <div key={item.kind} className={owned ? "" : "locked"}>
              <DecorPreview kind={item.kind} locked={!owned} statue={statueRows} season={season(state)} />
              <strong>{owned ? item.name : "???"}</strong><small>{definition.outcomes[item.tier!]?.name} · {item.radius ? `radius ${item.radius}` : ""}</small>
              <small>{owned ? item.text.replace("RF exclusive · ", "") : "Not collected yet"}</small>
              {owned && <button type="button" disabled={paused || placed || state.farmer.map !== "farm"} onClick={() => { setMenu(null); setPlacing({ kind: item.kind, tile: null }); focusCanvas(); }}>{placed ? "Placed" : state.farmer.map !== "farm" ? "Place on farm" : "Place"}</button>}
            </div>;
          })}
        </div> : <>
          {definition.outcomes.map((item, index) => <div className="valley-row" key={item.name}>
            <span><strong>{item.name} × {snapshot.inventory[index].toString()}</strong><small>{BLESSINGS[index]?.text}{snapshot.inventory[index] > 0n ? " · active" : ""}</small></span>
            <button type="button" disabled={busy || paused || snapshot.inventory[index] === 0n || item.reward === 0n} onClick={() => void act(() => client.redeem(index + 1, 1n), () => { cue("reward"); say(`Redeemed one ${item.name} for ${rf(item.reward)}.`); })}>Redeem · {rf(item.reward)}</button>
          </div>)}
          <p className="valley-note">Kept blessings live in the SDK's session ledger and reset on reload; your RF décor is saved with your farm.</p>
        </>}
      </>}
      {busy && <p role="status">Waiting for confirmation…</p>}
      {error && <p role="alert">{error}</p>}
    </GameMenu>}

    {reveal && state && <GameMenu title={reveal.length === 1 ? "Blessing opened" : `${reveal.length} blessings opened`}>
      <div className="valley-results">
        {reveal.map((result, index) => {
          const outcome = definition.outcomes[result.outcomeId - 1], exclusive = result.exclusive ? decorByKind(result.exclusive) : null;
          return <div className="valley-result" key={index}>
            <div className={`valley-reveal-${result.outcomeId}`}><div className="valley-capsule" aria-hidden="true"><span /></div></div>
            <span><strong>{outcome.name}</strong><small>{outcome.chanceBps / 100}% · worth {rf(outcome.reward)} (simulated) · kept: {BLESSINGS[result.outcomeId - 1]?.text}</small>
              <small>{exclusive ? `New RF décor: ${exclusive.name}` : `Duplicate décor: +${result.gold} Gold`}</small></span>
            <button type="button" disabled={busy || paused || result.redeemed} onClick={() => void act(() => client.redeem(result.outcomeId, 1n), () => {
              cue("reward"); setReveal(current => current?.map((item, other) => other === index ? { ...item, redeemed: true } : item) ?? null);
            })}>{result.redeemed ? "Redeemed" : `Redeem · ${rf(outcome.reward)}`}</button>
          </div>;
        })}
      </div>
      <div className="valley-buttons">
        <button type="button" className="rf-frame-primary" disabled={busy || paused} onClick={() => { setReveal(null); say("Kept blessings are working on your farm. New RF décor is in Decorate."); }}>Keep the rest</button>
        {reveal.some(result => result.exclusive) && state.farmer.map === "farm" && <button type="button" disabled={busy || paused} onClick={() => { const first = reveal.find(result => result.exclusive)!.exclusive!; setReveal(null); setMenu(null); setPlacing({ kind: first, tile: null }); focusCanvas(); }}>Place my new décor</button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </GameMenu>}

    {menu?.kind === "decor" && state && <GameMenu title="Decorate your farm" onClose={closeMenu}>
      <p className="valley-note">Pick something to place, then tap a tile on the farm. RF décor boosts crops in its radius.</p>
      <div className="valley-collection">
        {DECOR.filter(item => item.tier === undefined ? (state.decorOwned[item.kind] ?? 0) > 0 : state.collection.has(item.kind) && !state.decor.some(other => other.kind === item.kind)).map(item =>
          <div key={item.kind}><DecorPreview kind={item.kind} locked={false} statue={statueRows} season={season(state)} /><strong>{item.name}</strong>
            <small>{item.tier === undefined ? `× ${state.decorOwned[item.kind]}` : item.text.replace("RF exclusive · ", "")}</small>
            <button type="button" disabled={paused} onClick={() => { setMenu(null); setPlacing({ kind: item.kind, tile: null }); focusCanvas(); }}>Place</button></div>)}
      </div>
      {!DECOR.some(item => item.tier === undefined ? (state.decorOwned[item.kind] ?? 0) > 0 : state.collection.has(item.kind) && !state.decor.some(other => other.kind === item.kind)) &&
        <p>Nothing to place. Buy décor at the General Store, or open Moonlight Blessings for RF décor.</p>}
      {state.decor.length > 0 && <button type="button" disabled={paused} onClick={() => { setMenu(null); setPlacing({ kind: "pickup", tile: null }); focusCanvas(); }}>Pick something up</button>}
    </GameMenu>}

    {menu?.kind === "clip" && clip && state && <GameMenu title="Your clip" onClose={closeMenu}>
      {clip.gifUrl ? <img className="valley-clip" src={clip.gifUrl} alt="Your recorded GIF" /> : <p>No frames were recorded.</p>}
      <p className="valley-note">{clip.seconds.toFixed(1)} s · GIF {clip.gif ? `${Math.round(clip.gif.size / 1024)} KB` : "–"}{clip.video ? ` · video with music ${Math.round(clip.video.size / 1024)} KB (${clip.videoType === "video/mp4" ? "MP4" : "WebM"})` : " · this browser can't record video"}</p>
      <div className="valley-buttons">
        {clip.gif && <button type="button" className="rf-frame-primary" disabled={paused} onClick={() => shareFile("post", clip.gif!, clipText(state, friendId), "rarefriends-valley-clip")}>Post GIF to X</button>}
        {clip.gif && <button type="button" disabled={paused} onClick={() => shareFile("save", clip.gif!, clipText(state, friendId), "rarefriends-valley-clip")}>Save GIF</button>}
        {clip.video && <button type="button" disabled={paused} onClick={() => shareFile(clip.videoType === "video/mp4" ? "post" : "save", clip.video!, clipText(state, friendId), "rarefriends-valley-clip")}>{clip.videoType === "video/mp4" ? "Post video to X" : "Save video (with music)"}</button>}
        {clip.video && clip.videoType === "video/mp4" && <button type="button" disabled={paused} onClick={() => shareFile("save", clip.video!, clipText(state, friendId), "rarefriends-valley-clip")}>Save video</button>}
      </div>
      <p className="valley-note">GIFs are silent; the video carries the music. {clip.videoType === "video/webm" ? "X doesn't take WebM, so post the GIF (or convert the video)." : ""}</p>
      {shareStatus && <p role="status">{shareStatus}</p>}
      <button type="button" disabled={paused} onClick={() => { closeMenu(); void toggleClip(); }}>Record another</button>
    </GameMenu>}

    {menu?.kind === "settings" && state && <GameMenu title="Settings" onClose={closeMenu}>
      <button type="button" aria-pressed={!muted} onClick={toggleMute}>{muted ? "Sound off" : "Sound on"}</button>
      <MusicControls prefs={state.prefs} track={state.prefs.track as TrackId} current={trackName(trackFor("auto", season(state), isNight(state)))} onChange={changePrefs} onTrack={track => changePrefs({ ...state.prefs, track })} />
      <label className="valley-check"><input type="checkbox" checked={state.prefs.orbit} onChange={event => changePrefs({ ...state.prefs, orbit: event.target.checked })} /> Slow camera orbit while recording clips</label>
      <label className="valley-check"><input type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.target.checked)} /> Reduce motion</label>
      {familyPerk && <div className="valley-perk valley-row"><SpriteChip rows={statueRows} label="" /><span><strong>Farmer #{friendId.toString()} · {familyName}</strong><small>{familyPerk.title}: {familyPerk.text}</small></span></div>}
      <p>{linked.current ? "Your farm (crops, Gold, tools, friendships, décor) saves automatically for your connected wallet on this device." : "Progress saving is off: it needs the RareFriends Valley host page and your wallet's Friends to load."} RF balances and blessings are simulated by the SDK preview and reset on reload.</p>
      <button type="button" onClick={() => setMenu({ kind: "help" })}>Controls</button>
    </GameMenu>}

    {menu?.kind === "help" && <GameMenu title="Controls" onClose={closeMenu}>
      <ul className="valley-steps">
        <li><strong>Tap / click</strong> a tile: walk there and use your tool. <strong>Hands</strong> does what the tile needs (clear, till, plant, water, harvest).</li>
        <li><strong>Tap a villager</strong> to talk and give gifts. <strong>Tap a door</strong> to shop, the <strong>bin</strong> to ship, your <strong>house</strong> to sleep.</li>
        <li><strong>WASD / arrows</strong>: walk · <strong>E / Space</strong>: act in front · <strong>1–5</strong>: tools (Seeds again cycles packets) · <strong>Q / R</strong>: rotate the camera · <strong>B</strong>: bag · <strong>C</strong>: record a clip.</li>
        <li>Refill the watering can at the <strong>well</strong> or the <strong>pond</strong>. The road east leads to town.</li>
      </ul>
      <p>A day runs 6 am to 2 am (about five minutes). Energy drops as you work; eat or sleep to recover. The valley pauses while a menu is open.</p>
      <button type="button" onClick={closeMenu}>Back to the farm</button>
    </GameMenu>}
  </section>;
}
