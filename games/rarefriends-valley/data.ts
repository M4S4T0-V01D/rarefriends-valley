/** Static game data for RareFriends Valley: seasons, crops, items, tools, villagers, décor and RF blessings. */

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = typeof SEASONS[number];
export const SEASON_NAMES: Record<Season, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };
/** A short season keeps the whole year playable in a jam session. */
export const DAYS_PER_SEASON = 7;

// ---------- Clock ----------
/** In-game minutes. The day starts at 6:00; after midnight you get drowsy; at 2:00 you pass out. */
export const DAY_START = 6 * 60, DROWSY = 24 * 60, PASS_OUT = 26 * 60;
/** Real seconds per in-game minute: a full day (6:00 → 2:00) lasts five minutes. */
export const SECONDS_PER_MINUTE = 0.25;
export const SHOP_HOURS = { store: [7 * 60, 18 * 60], cafe: [7 * 60, 21 * 60], market: [7 * 60, 24 * 60] } as const;

// ---------- Energy (fatigue) ----------
export const MAX_ENERGY = 100;
export const TIRED_AT = 25;
export const ENERGY_COST = { till: 4, water: 2, plant: 1, harvest: 1, clear: 6, fertilize: 1 } as const;
/** Minutes that each action takes on the clock. */
export const ACTION_MINUTES = { till: 10, water: 5, plant: 5, harvest: 5, clear: 15, fertilize: 5, refill: 5 } as const;

// ---------- Crops ----------
export type CropId = "turnip" | "potato" | "strawberry" | "tomato" | "corn" | "melon" | "pumpkin" | "eggplant" | "sweetpotato" | "snowcabbage";
export type CropShape = "round" | "long" | "berry" | "cob" | "big" | "leafy";
export type Crop = Readonly<{
  id: CropId; name: string; season: Season; days: number; regrow: number | null; seed: number; sell: number; energy: number;
  color: string; leaf: string; shape: CropShape;
}>;
export const CROPS: readonly Crop[] = [
  { id: "turnip", name: "Turnip", season: "spring", days: 4, regrow: null, seed: 20, sell: 60, energy: 6, color: "#efe9df", leaf: "#9fb593", shape: "round" },
  { id: "potato", name: "Potato", season: "spring", days: 6, regrow: null, seed: 30, sell: 90, energy: 8, color: "#c9b08e", leaf: "#8ea483", shape: "round" },
  { id: "strawberry", name: "Strawberry", season: "spring", days: 7, regrow: 3, seed: 60, sell: 45, energy: 5, color: "#d49a98", leaf: "#8ea483", shape: "berry" },
  { id: "tomato", name: "Tomato", season: "summer", days: 7, regrow: 3, seed: 50, sell: 40, energy: 5, color: "#d58f86", leaf: "#8aa37c", shape: "berry" },
  { id: "corn", name: "Corn", season: "summer", days: 9, regrow: 4, seed: 70, sell: 55, energy: 7, color: "#e2d09a", leaf: "#9cb08a", shape: "cob" },
  { id: "melon", name: "Melon", season: "summer", days: 10, regrow: null, seed: 90, sell: 260, energy: 14, color: "#b8cba6", leaf: "#8aa37c", shape: "big" },
  { id: "pumpkin", name: "Pumpkin", season: "autumn", days: 9, regrow: null, seed: 80, sell: 240, energy: 12, color: "#e0b286", leaf: "#9aa47f", shape: "big" },
  { id: "eggplant", name: "Eggplant", season: "autumn", days: 6, regrow: 3, seed: 40, sell: 35, energy: 5, color: "#a99bb8", leaf: "#8f9f80", shape: "long" },
  { id: "sweetpotato", name: "Sweet Potato", season: "autumn", days: 5, regrow: null, seed: 30, sell: 80, energy: 8, color: "#c99a9a", leaf: "#8f9f80", shape: "long" },
  { id: "snowcabbage", name: "Snow Cabbage", season: "winter", days: 6, regrow: null, seed: 50, sell: 150, energy: 10, color: "#dfe6ea", leaf: "#b3c2c4", shape: "leafy" },
];
export const cropById = (id: CropId) => CROPS.find(crop => crop.id === id)!;
/** Growth stages drawn on the field: 0 seed, 1 sprout, 2 young, 3 ripe. */
export const cropStage = (crop: Crop, grown: number, regrowing: boolean) => {
  if (grown >= (regrowing ? crop.regrow! : crop.days)) return 3;
  const total = regrowing ? crop.regrow! : crop.days, fraction = grown / total;
  return regrowing ? 2 : fraction < 0.25 ? 0 : fraction < 0.6 ? 1 : 2;
};

// ---------- Items ----------
export type ForageId = "berry" | "shell" | "mushroom" | "crystal";
export type FoodId = "latte" | "honeycake" | "stew";
export type ItemId = CropId | `seed:${CropId}` | ForageId | FoodId | "fertilizer" | `golden:${CropId}`;
export type ItemInfo = Readonly<{ id: ItemId; name: string; sell: number; energy: number; kind: "crop" | "seed" | "forage" | "food" | "fertilizer" | "golden" }>;
export const FORAGE: readonly Readonly<{ id: ForageId; name: string; season: Season; sell: number; energy: number; color: string }>[] = [
  { id: "berry", name: "Wild Berry", season: "spring", sell: 25, energy: 4, color: "#b8a3c9" },
  { id: "shell", name: "Pond Shell", season: "summer", sell: 40, energy: 0, color: "#e8dccb" },
  { id: "mushroom", name: "Forest Mushroom", season: "autumn", sell: 45, energy: 6, color: "#c7a48a" },
  { id: "crystal", name: "Snow Crystal", season: "winter", sell: 70, energy: 0, color: "#c9d6e0" },
];
export const FOODS: readonly Readonly<{ id: FoodId; name: string; price: number; energy: number; text: string }>[] = [
  { id: "latte", name: "Friend Latte", price: 60, energy: 30, text: "Warm milk and espresso. Restores 30 energy." },
  { id: "honeycake", name: "Honey Cake", price: 140, energy: 70, text: "A whole slice. Restores 70 energy." },
  { id: "stew", name: "Harvest Stew", price: 90, energy: 45, text: "Made with local crops. Restores 45 energy." },
];
export const FERTILIZER_PRICE = 25;
export function itemInfo(id: ItemId): ItemInfo {
  if (id === "fertilizer") return { id, name: "Fertilizer", sell: 5, energy: 0, kind: "fertilizer" };
  if (id.startsWith("seed:")) { const crop = cropById(id.slice(5) as CropId); return { id, name: `${crop.name} Seeds`, sell: Math.floor(crop.seed / 4), energy: 0, kind: "seed" }; }
  if (id.startsWith("golden:")) { const crop = cropById(id.slice(7) as CropId); return { id, name: `Golden ${crop.name}`, sell: crop.sell * 3, energy: crop.energy * 2, kind: "golden" }; }
  const crop = CROPS.find(item => item.id === id);
  if (crop) return { id, name: crop.name, sell: crop.sell, energy: crop.energy, kind: "crop" };
  const forage = FORAGE.find(item => item.id === id);
  if (forage) return { id, name: forage.name, sell: forage.sell, energy: forage.energy, kind: "forage" };
  const food = FOODS.find(item => item.id === id)!;
  return { id, name: food.name, sell: Math.floor(food.price / 3), energy: food.energy, kind: "food" };
}
export const isItemId = (value: unknown): value is ItemId => {
  if (typeof value !== "string") return false;
  if (value === "fertilizer") return true;
  const [prefix, rest] = value.includes(":") ? value.split(":") : ["", value];
  if (prefix && prefix !== "seed" && prefix !== "golden") return false;
  if (CROPS.some(crop => crop.id === rest)) return true;
  return !prefix && (FORAGE.some(item => item.id === rest) || FOODS.some(item => item.id === rest));
};

// ---------- Tools ----------
export type ToolId = "hand" | "hoe" | "can" | "seeds" | "fertilizer";
export const TOOL_NAMES: Record<ToolId, string> = { hand: "Hands", hoe: "Hoe", can: "Watering can", seeds: "Seeds", fertilizer: "Fertilizer" };
/** Watering can capacity by level, and upgrade costs (Gold). Level 2+ waters a line of three. */
export const CAN_CAPACITY = [20, 40, 70] as const;
export const CAN_UPGRADES = [600, 1600] as const;
/** Hoe level 2 tills a line of three tiles. */
export const HOE_UPGRADES = [800] as const;
export const BACKPACK_SLOTS = [8, 12, 16] as const;
export const BACKPACK_UPGRADES = [400, 1200] as const;
export const STACK = 99;

// ---------- Family perks (from the verified Friend's Generations family) ----------
export type FamilyPerk = Readonly<{ title: string; text: string }>;
export const FAMILY_NAMES = ["Skeleton", "Mask", "Family", "Cellular", "Asymmetry", "Hoverer", "Colossus", "Sparkling", "Hollow"] as const;
export const FAMILY_PERKS: readonly FamilyPerk[] = [
  { title: "Light bones", text: "Tools cost 20% less energy." },
  { title: "Market face", text: "Everything sells for 10% more." },
  { title: "Good neighbour", text: "Friendship grows 25% faster." },
  { title: "Self-seeding", text: "15% chance a planted seed isn't used up." },
  { title: "Lucky rows", text: "10% chance of a double harvest." },
  { title: "Floaty steps", text: "You walk 30% faster." },
  { title: "Big and strong", text: "+30 maximum energy." },
  { title: "Green sparkle", text: "Crops get an extra 10% nightly growth chance." },
  { title: "Deep pockets", text: "The watering can holds twice as much." },
];

// ---------- RF blessings (outcome order matches game.json) ----------
export type Blessing = Readonly<{ name: string; text: string }>;
export const BLESSINGS: readonly Blessing[] = [
  { name: "Sprout Charm", text: "+1 Sprout Fertilizer charge each morning per charm (max 5)" },
  { name: "Silver Dew", text: "Morning dew waters 4 crops per dew (max 12)" },
  { name: "Moon Bloom", text: "Shipped crops sell +10% per bloom (max 30%)" },
  { name: "Golden Harvest", text: "8% of harvests turn golden (×3 price)" },
];
export const BLESSING_CAPS = [5, 3, 3, 1] as const;

// ---------- Décor and RF-exclusive cosmetics ----------
export type DecorKind = "flowerbed" | "lamp" | "bench" | "birdbath" | "scarecrow" | "chime" | "arch" | "sprinkler" | "beehive" | "lantern" | "windmill" | "statue";
export type Boost = "grow" | "water" | "yield" | "golden";
export type Decor = Readonly<{ kind: DecorKind; name: string; cost: number; tier?: number; radius: number; boost?: Boost; chance?: number; text: string }>;
export const DECOR: readonly Decor[] = [
  { kind: "flowerbed", name: "Flower Bed", cost: 120, radius: 0, text: "Seasonal flowers. Pure charm." },
  { kind: "lamp", name: "Lamp Post", cost: 220, radius: 0, text: "Glows warmly at night." },
  { kind: "bench", name: "Garden Bench", cost: 180, radius: 0, text: "A place to watch the crops grow." },
  { kind: "birdbath", name: "Birdbath", cost: 260, radius: 0, text: "Little birds visit in the morning." },
  // RF exclusives: every Moonlight Blessing grants one; they boost the crops around them.
  { kind: "scarecrow", name: "Lucky Scarecrow", cost: 0, tier: 0, radius: 2, boost: "grow", chance: 0.12, text: "RF exclusive · crops within 2 tiles get +12% nightly growth chance." },
  { kind: "chime", name: "Wind Chime", cost: 0, tier: 0, radius: 1, boost: "yield", chance: 0.15, text: "RF exclusive · crops within 1 tile: +15% chance of a bonus crop." },
  { kind: "arch", name: "Flower Arch", cost: 0, tier: 0, radius: 2, boost: "grow", chance: 0.08, text: "RF exclusive · crops within 2 tiles get +8% nightly growth chance." },
  { kind: "sprinkler", name: "Crystal Sprinkler", cost: 0, tier: 1, radius: 1, boost: "water", text: "RF exclusive · waters the 8 tiles around it every morning." },
  { kind: "beehive", name: "Silver Beehive", cost: 0, tier: 1, radius: 2, boost: "yield", chance: 0.25, text: "RF exclusive · crops within 2 tiles: +25% chance of a bonus crop." },
  { kind: "lantern", name: "Moon Lantern", cost: 0, tier: 2, radius: 2, boost: "grow", chance: 0.3, text: "RF exclusive · crops within 2 tiles get +30% nightly growth chance. Glows at night." },
  { kind: "windmill", name: "Star Windmill", cost: 0, tier: 2, radius: 3, boost: "grow", chance: 0.15, text: "RF exclusive · crops within 3 tiles get +15% nightly growth chance." },
  { kind: "statue", name: "Golden Friend Statue", cost: 0, tier: 3, radius: 3, boost: "golden", chance: 0.1, text: "RF exclusive · your Friend in gold: crops within 3 tiles have +10% golden chance." },
];
export const decorByKind = (kind: DecorKind) => DECOR.find(item => item.kind === kind)!;
export const EXCLUSIVES = DECOR.filter(item => item.tier !== undefined);
/** Gold for a duplicate exclusive, by blessing tier. */
export const DUPLICATE_GOLD = [150, 300, 600, 1500] as const;

// ---------- Villagers: every NPC is a Rare Friend ----------
export type Place = "store" | "cafe" | "market" | "plaza" | "pond" | "board" | "home" | "farm";
export type Villager = Readonly<{
  id: string; name: string; family: number; role: string; work: Place | null; loves: readonly ItemId[]; likes: readonly ItemId[]; dislikes: readonly ItemId[];
  lines: readonly string[];
}>;
export const VILLAGERS: readonly Villager[] = [
  { id: "mochi", name: "Mochi", family: 1, role: "runs the General Store", work: "store", loves: ["strawberry", "honeycake"], likes: ["turnip", "berry"], dislikes: ["shell"],
    lines: ["Seeds are fresh this morning! Plant them the day you buy them.", "Water every day, or the crops just sit and sulk.", "My mask? It's a family heirloom. Don't ask."] },
  { id: "pip", name: "Pip", family: 5, role: "pours lattes at the café", work: "cafe", loves: ["latte", "melon"], likes: ["tomato", "berry"], dislikes: ["mushroom"],
    lines: ["A latte gets you through a long day of hoeing.", "I float, so I never spill a drop.", "Tired? Come by before you pass out in a field again."] },
  { id: "nori", name: "Nori", family: 7, role: "keeps the Moonlight Market", work: "market", loves: ["crystal", "golden:turnip"], likes: ["pumpkin", "snowcabbage"], dislikes: ["potato"],
    lines: ["Moonlight Blessings sparkle best on a clear night.", "Place a Moon Lantern near your crops and watch them race.", "Everything here is simulated RF. The joy is real, though."] },
  { id: "tofu", name: "Tofu", family: 6, role: "is the valley's mayor", work: "plaza", loves: ["pumpkin", "stew"], likes: ["potato", "corn"], dislikes: ["crystal"],
    lines: ["Welcome to the valley! Every Friend here is glad you came.", "Check the notice board. Folks always need a hand.", "Ship your crops in the bin by your house. I pay out every morning."] },
  { id: "yuzu", name: "Yuzu", family: 3, role: "fishes at the pond", work: "pond", loves: ["shell", "sweetpotato"], likes: ["eggplant", "stew"], dislikes: ["strawberry"],
    lines: ["The pond knows the season before we do.", "Shells wash up in summer. I collect them.", "Refill your can at the water's edge. It's free!"] },
  { id: "kumo", name: "Kumo", family: 0, role: "tells stories on the plaza bench", work: "plaza", loves: ["mushroom", "eggplant"], likes: ["turnip", "latte"], dislikes: ["melon"],
    lines: ["Bones get creaky in winter. Snow Cabbage soup helps.", "I've seen fifty harvests. Well, maybe five.", "Rest when you're tired. The field will wait."] },
  { id: "bun", name: "Bun", family: 2, role: "bakes and minds the little ones", work: "board", loves: ["honeycake", "strawberry"], likes: ["corn", "sweetpotato"], dislikes: ["crystal"],
    lines: ["My little one wants to see your farm someday!", "Corn bread, turnip pie… you grow it, I bake it.", "A gift a day keeps the neighbours smiling."] },
  { id: "miso", name: "Miso", family: 8, role: "wanders and sketches", work: null, loves: ["snowcabbage", "crystal"], likes: ["berry", "mushroom"], dislikes: ["tomato"],
    lines: ["There's a hollow in me the size of a sunrise.", "I sketch every season. Autumn is my favourite colour.", "Have you tried filming your farm? It makes lovely little clips."] },
];
/** Friendship: 0–1000 points, one heart per 100. */
export const HEART = 100, MAX_FRIENDSHIP = 1000;
export const GIFT_POINTS = { love: 80, like: 40, neutral: 15, dislike: -20 } as const;
export const TALK_POINTS = 10;
/** Your own owned Friends can help on the farm once they like you this much. */
export const HELPER_HEARTS = 3;
export const HELPER_WATERS = 6;

export const GUEST_NAMES = ["Hana", "Azuki", "Kiki", "Momo", "Taro", "Ume", "Sora", "Riku", "Nana", "Koko", "Toto", "Mimi", "Dango", "Chai"] as const;
