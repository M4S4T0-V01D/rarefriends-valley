# RareFriends Valley — rules and reference

A greyscale 2.5D farming life sim for the Rare Friends Vibeathon, built on FriendSDK v0.1.2. Your verified Rare Friend
is the farmer. The SDK runtime supplies wallet connection, the ownership check and the simulated RF client. This
game module never connects wallets or discovers NFTs itself.

## Controls

| Action | Pointer / touch | Keyboard |
| --- | --- | --- |
| Walk | Tap a tile | WASD (screen-relative at any camera angle) |
| Use the current tool | Tap a tile (your Friend walks next to it first) | E / Space / Enter acts on the tile in front |
| Pick a tool | Hotbar | 1 Hands · 2 Hoe · 3 Can · 4 Seeds (again: next packet) · 5 Fertilizer |
| Talk, shop, ship, sleep | Tap a villager, a door, the bin or your house | Face it and press E |
| Rotate the camera | ↺ ↻ | ← / → (or Q / R) |
| Zoom | Mouse wheel | ↑ / ↓ (or + / −) |
| Bag (eat, pick seeds) | Bag | B or I |
| Record a clip | ● Clip (tap ■ to stop early) | C |

**Hands** is the smart tool: it clears debris, tills, plants your selected seeds, waters, and harvests, whatever the
tile needs. Ripe crops can be harvested with any tool.

## The day

- The clock runs from **6:00 am to 2:00 am** (about five real minutes). The valley pauses while a menu is open.
- Dusk starts at 5 pm. From about 7 pm lamps, windows and lanterns glow, and the night lullaby plays.
- After **midnight** you get drowsy. At **2 am you pass out**: you wake at home with half energy and lose 10% of your Gold (at most 200).
- **Sleep** (tap your house) any time. Overnight:
  - The shipping bin pays out.
  - Watered crops grow.
  - Tomorrow's weather arrives.
  - Villagers reset their daily talk and gift.
  - New forage and a new request appear.
- Tools cost in-game time: tilling 10 min, clearing 15, watering, planting and harvesting 5. Travelling between the farm and town takes 10.

## Energy

- Maximum energy is 100 (130 with the Colossus perk).
- Costs: till 4, clear 6, water 2, plant 1, harvest 1, fertilize 1. The Skeleton perk takes 20% off.
- Upgraded tools cost about 0.7× per tile.
- At 25 or less you're **tired**: you walk 30% slower and a sweat drop appears. At 0 you can't use tools.
- Eat crops, forage or café food from your bag, or buy food at the café.
  - Friend Latte: +30 energy, 60 G.
  - Harvest Stew: +45, 90 G.
  - Honey Cake: +70, 140 G.

## Seasons, weather and crops

- Four seasons of **7 days**: spring, summer, autumn, winter.
- When the season turns, crops of the old season **wither**.
- Weather: rain on 28% of days (20% in summer); snow on 40% of winter days. **Rain and snow water every tilled tile.**
- A crop grows one day per night **if watered**. Bonus growth has an extra chance each night:
  - Fertilizer: +30%.
  - Sprout Fertilizer: +50%.
  - RF décor in range, and the Sparkling perk: +10%.
  - Maximum 90%.

| Crop | Season | Days | Regrows | Seed (G) | Sells (G) | Energy |
| --- | --- | --- | --- | --- | --- | --- |
| Turnip | Spring | 4 | – | 20 | 60 | 6 |
| Potato | Spring | 6 | – | 30 | 90 | 8 |
| Strawberry | Spring | 7 | every 3 | 60 | 45 | 5 |
| Tomato | Summer | 7 | every 3 | 50 | 40 | 5 |
| Corn | Summer | 9 | every 4 | 70 | 55 | 7 |
| Melon | Summer | 10 | – | 90 | 260 | 14 |
| Pumpkin | Autumn | 9 | – | 80 | 240 | 12 |
| Eggplant | Autumn | 6 | every 3 | 40 | 35 | 5 |
| Sweet Potato | Autumn | 5 | – | 30 | 80 | 8 |
| Snow Cabbage | Winter | 6 | – | 50 | 150 | 10 |

- Golden crops sell for ×3.
- Forage appears each morning on the farm and in town:
  - Spring: Wild Berry, 25 G.
  - Summer: Pond Shell, 40 G.
  - Autumn: Forest Mushroom, 45 G.
  - Winter: Snow Crystal, 70 G.

## The farm

- A 24 × 20 map with your house, the shipping bin, a well, a pond and a **12 × 10 field**.
- The field starts wild with weeds, rocks and stumps; a small patch by the path is ready to till.
- The road east leads to town.
- You start with 500 G, 12 Turnip and 6 Potato seeds, 4 Fertilizer and a Friend Latte.

## Town and villagers

The 26 × 18 town has three shops around a plaza with a fountain and a notice board:

- **General Store** (7 am–6 pm):
  - The season's seeds and Fertilizer (25 G).
  - Upgrades:
    - Watering can: 40 water for 600 G, then 70 for 1,600 G. From level 2 it waters a line of three.
    - Hoe: tills a line of three, 800 G.
    - Backpack: 12 slots for 400 G, then 16 for 1,200 G.
  - Décor: Flower Bed 120, Garden Bench 180, Lamp Post 220 (glows at night), Birdbath 260.
- **RareFriends Cafe** (7 am–9 pm): food that restores energy at once.
- **Moonlight Market** (7 am–midnight): Moonlight Blessings (below).
- **Notice board:** a villager asks for a few of an in-season crop or forage. Delivering pays Gold (about 1.6× the value, plus 50) and 60 friendship.

Every NPC is a Rare Friend. They keep a schedule:

- Indoors until 8 am.
- At work until 5 pm.
- Socialising at the bench, fountain, plaza or café until 8 pm, then home.
- On rainy or snowy days they shelter in the café.

| Villager | Family | Role | Loves |
| --- | --- | --- | --- |
| Mochi | Mask | General Store | Strawberry, Honey Cake |
| Pip (#7730's canonical art) | Hoverer | Café | Friend Latte, Melon |
| Nori | Sparkling | Moonlight Market | Snow Crystal, golden crops |
| Tofu | Colossus | Mayor, plaza | Pumpkin, Harvest Stew |
| Yuzu | Cellular | Fishes at the pond | Pond Shell, Sweet Potato |
| Kumo (#3412's canonical art) | Skeleton | Storyteller, plaza bench | Forest Mushroom, Eggplant |
| Bun | Family | Baker, notice board | Honey Cake, Strawberry |
| Miso | Hollow | Wanders and sketches | Snow Cabbage, Snow Crystal |

**Friendship** runs from 0 to 1000 points; each 100 points is a heart.

- Talking once a day: +10.
- Gifts (one a day): loved +80, liked +40, neutral +15, disliked −20. Any golden crop is loved.
- The Family perk adds 25%.

**Your owned Friends** (from the trusted host's read-only roster, up to 12) move into town with their canonical sprites.
At **3 hearts** each one comes to your farm in the morning and **waters 6 crops**.

## Moonlight Blessings ($RAREFRIENDS, simulated)

A blessing costs **1 RF** through the SDK chance-game client (`buy`, `play`, `settle`, `redeem`), with runtime
confirmations. Its expected value is **0.88 RF**, and each purchased or pending blessing reserves 5 RF of backing.

| Blessing | Chance | RF value | While kept (caps) | RF décor of this tier |
| --- | --- | --- | --- | --- |
| Sprout Charm | 60% | 0.5 RF | +1 Sprout Fertilizer charge each morning per charm (max 5) | Lucky Scarecrow, Wind Chime, Flower Arch |
| Silver Dew | 28% | 1 RF | Morning dew waters 4 crops per dew (max 12) | Crystal Sprinkler, Silver Beehive |
| Moon Bloom | 10% | 2 RF | Shipped goods sell +10% per bloom (max 30%) | Moon Lantern, Star Windmill |
| Golden Harvest | 2% | 5 RF | 8% of harvests turn golden (×3 price) | Golden Friend Statue |

- **Keeping and redeeming:** kept blessings keep their RF value with no expiry. Redeeming returns the RF and removes the bonus. The kept counts come from the SDK ledger (the Friend's inventory) and reset on reload.
- **RF décor:** every opened blessing also grants an RF-exclusive décor piece of its tier that you don't have yet. A duplicate gives Gold instead (150 / 300 / 600 / 1,500). RF décor is placed on the farm (even in the field), saved with your farm and has no RF value. Effects:
  - Lucky Scarecrow: +12% growth within 2 tiles.
  - Wind Chime: +15% bonus-crop chance within 1 tile.
  - Flower Arch: +8% growth within 2 tiles.
  - Crystal Sprinkler: waters the 8 tiles around it every morning.
  - Silver Beehive: +25% bonus-crop chance within 2 tiles.
  - Moon Lantern: +30% growth within 2 tiles, and glows at night.
  - Star Windmill: +15% growth within 3 tiles.
  - Golden Friend Statue: your Friend in gold, +10% golden chance within 3 tiles.
- **Placing:** open Decorate (or place straight from the Market) and tap a tile. The boost radius is highlighted. Décor can't block the road, paths or doorways, and you can pick it up again.

## Family perks

Your Friend's Generations family gives one perk:

| Family | Perk |
| --- | --- |
| Skeleton | Tools cost 20% less energy |
| Mask | +10% sell prices |
| Family | +25% friendship |
| Cellular | 15% of seeds aren't used up |
| Asymmetry | 10% double harvests |
| Hoverer | 30% faster walking |
| Colossus | +30 maximum energy |
| Sparkling | +10% nightly growth |
| Hollow | Double watering can capacity |

## Friend Films and sharing

- **● Clip** records up to 6 seconds of the game canvas, with a small "RareFriends Valley · Season Day · #id" label.
- The camera slowly orbits while recording; turn this off in Settings, and it's off with reduced motion.
- **GIF:** 420 px wide, 12 fps, looping, one adaptive 256-colour palette, from the game's own encoder (`gif.ts`). GIFs are silent.
- **Video:** `MediaRecorder` records the canvas plus the game's music mix, as MP4 (Chrome, Safari) or WebM (Firefox).
- **Posting:** the sandboxed game hands the file to the trusted host page.
  - Phones: the share sheet posts straight to the X app.
  - Desktop: the host saves the file and opens a prefilled X post (links to https://rarefriends.com/, tagged @RareFriendsNFT #RareFriends #RareFriendsValley).
- **Diary card:** after each night, a 1,200 × 675 card with a photo of your farm and the day's numbers can be posted, copied or saved.

## Audio

- All music and sound effects are synthesized with WebAudio; there are no audio files.
- **Tracks:** *Morning Sprouts* (spring kalimba), *Street Bossa* (summer, the café's bossa nova), *Harvest Moon Waltz* (autumn), *Snowglobe* (winter music box) and *Firefly Lullaby* (nights).
- "By season" follows the calendar and the clock, or you can pick a track in Settings.
- **Sound effects:** tilling, splashing water, planting, harvest plinks (with a golden sparkle), rocks cracking, refills, coins, Friend chirps pitched by family, gift reactions, heart chimes, tired sighs, yawns, a morning bird call, season fanfares, café munching, the capsule crank and a camera shutter.

## Saves

- On the custom host, the farm saves for your connected wallet in that browser: day, season and year, clock, Gold, energy, position, every field tile, backpack, tools, bin, décor, RF décor collection, friendships, forage, request, totals and preferences.
- Saves are validated on load; anything invalid is dropped.
- Friendship with owned Friends is restored when the wallet roster arrives.

## Art and credits

- Scenery, buildings, crops, décor, item icons and villager Friends are canvas code in this directory. There are no image files.
- Your Friend and your owned Friends use their **canonical Generations sprites** (the SDK's `createFriendReader`). Pip and Kumo use canonical frames of #7730 and #3412 from FriendSDK v0.1.2 `examples/fishing/sample-sprites.ts`.
- Other villagers are original procedural 16 × 16 one-bit masks, one archetype per family. Rare Friends artwork is used under FriendSDK [NOTICE.md](https://github.com/spokesz/friendsdk/blob/v0.1.2/NOTICE.md).
