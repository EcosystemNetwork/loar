# Greenwood Outlaws — Universe Bible

A medieval outlaw universe in the Robin Hood tradition, built as a 3D character NFT
collection (Robinhood Chain) that later becomes a playable game. Every character
mints **bare**: base body, linen smallclothes, no gear. Equipment is earned in game.

> Name, places and characters are original. The Robin Hood legend itself is public-domain
> folklore; we borrow its shape (outlaws, the forest, robbing the rich) and not any specific
> film, show or game adaptation.

---

## 1. The pitch

The kingdom of **Aldmere** is ruled in the king's absence by **Sheriff Morcant Vell**, who
has invented the **Stripping Tithe**: whoever cannot pay is taxed down to their
smallclothes. Coin, boots, tools, even the shirt off your back all go to the Sheriff's
counting-house in **Thornbury Keep**.

The stripped don't starve quietly. They walk barefoot into the **Greenwood**, an ancient
forest the Sheriff's men fear to enter, and become outlaws. They take back what was taken:
they ambush tax convoys, raid armouries, and give the coin to the villages.

**Why every NFT starts in underwear:** each outlaw arrived in the Greenwood with nothing
but their linen. Everything they wear afterwards (bow, hood, mail, boots) was _taken back_
from the Sheriff. In game, equipment drops from raids on his convoys and keeps.

Tone: stylized, warm and slightly comic medieval, not grimdark. Readable silhouettes,
hand-painted textures, a game-ready look.

## 2. Places (wiki)

| Place              | Role                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| **The Greenwood**  | Vast old forest; the outlaws' home and the game's hub region         |
| **The Hollow Oak** | Giant hollow tree, the outlaw camp and gear stash (player home base) |
| **Thornbury Keep** | Sheriff's castle and counting-house (end-game raid)                  |
| **Kingsroad**      | Tax convoy route through the forest (ambush missions)                |
| **Millbrook**      | Village the outlaws protect; quest hub and market                    |
| **The Weir**       | River crossing with a toll bridge; a classic one-on-one duel spot    |

## 3. Factions (wiki)

- **The Greenwood Outlaws**: the holders. Everyone in the collection.
- **The Sheriff's Tithe-Men**: tax collectors and soldiers in red and iron (enemies).
- **The Abbey of St. Wendel**: corrupt rich monastery that hoards the tithe (raid target).
- **The Villagers of Millbrook**: the poor the outlaws protect (quest givers).

## 4. Named characters (lore, not part of the random mint)

| Name                     | Role                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| **Wren Ashby**           | Outlaw captain, the best archer in Aldmere; stripped first, for speaking back |
| **Big Tobin**            | Huge, gentle quarterstaff fighter; Wren's right hand                          |
| **Brother Aldo**         | Runaway friar who stole the Abbey's ledgers; the camp's cook and medic        |
| **Mira Fenn**            | Tracker and lockpick; grew up poaching the king's deer                        |
| **Sheriff Morcant Vell** | Villain; inventor of the Stripping Tithe                                      |
| **Sir Garrick Thorne**   | The Sheriff's champion knight; hunts outlaws for sport                        |

---

## 5. Collection rules (art direction for every NFT)

### 5.1 Base layer: "smallclothes"

Every character wears exactly this and nothing else:

- **Braies**: undyed linen drawers, fitted, cut mid-thigh, drawstring waist.
- **Undershirt**: fitted sleeveless linen undershirt (tank cut), tucked in. The same for
  every body type and sex, so torso armour sits on a known silhouette.
- **Barefoot.** No belt, jewellery, hood, cape, weapon, bag or accessories.

Why fitted and minimal: equipment is layered _over_ the body. Loose or bulky base
clothing clips through armour. It also keeps every NFT marketplace-safe.

### 5.2 Pose

Neutral **A-pose**, arms about 45° from the body, feet shoulder-width apart, facing the
camera, with a neutral expression and plain light-grey background. The LOAR puppet pipeline
re-poses into a T-pose before rigging, and an A-pose keeps the source art clean for that.

### 5.3 Body types (the "base bodies")

Five body types share **one biped skeleton** (Tripo biped rig). Each comes in a male and a
female form, so there are **10 base bodies**.

| Body type   | Build                     | Height        | Game role (later) |
| ----------- | ------------------------- | ------------- | ----------------- |
| **Archer**  | Lean, athletic            | Average       | Ranged            |
| **Brawler** | Broad, heavy, muscular    | Tall          | Melee / tank      |
| **Rogue**   | Slight, wiry              | Short         | Stealth / speed   |
| **Friar**   | Stout, round, strong arms | Short-average | Support / healer  |
| **Ranger**  | Long-limbed, rangy        | Tall          | Scout / tracker   |

### 5.4 Traits (what varies on top of a base body)

Traits must **never** add geometry that collides with gear slots.

| Trait            | Values (rarity is set later)                                                             | Gear-safe rule                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Skin tone        | 8 tones, from pale to deep brown                                                         | texture only                                                    |
| Face             | 6 faces per body type                                                                    | —                                                               |
| Hair             | cropped, shaved, short curls, tied-back tail, braided crown, bald                        | **close to the skull**; no big volume, so helmets and hoods fit |
| Facial hair      | none, stubble, short beard, moustache                                                    | short only, so it doesn't clip through a hood                   |
| Eye colour       | brown, hazel, green, blue, grey, odd-eyed (rare)                                         | texture only                                                    |
| Marks            | none, freckles, scar, woad tattoo, **Tithe brand** (rare)                                | texture/decal only                                              |
| Smallclothes dye | undyed (common), faded green, madder red, woad blue, black (rare), gold-trim (legendary) | recolour of the same mesh                                       |

### 5.5 Equipment slots (planned for the game, not minted now)

`head` · `torso` · `arms` · `hands` · `legs` · `feet` · `back` (cloak) · `quiver` ·
`main_hand` · `off_hand`

Gear is authored once **per body type** and skinned to the shared skeleton, so any
Brawler can wear any Brawler armour.

---

## 6. Production pipeline (important)

**Prototype (now).** The LOAR Character Studio turns each 2D concept into a rigged,
animated 3D model with Tripo (concept → T-pose → turnaround → mesh → biped rig → clips).
This proves the look and the skeleton.

**Limitation.** Tripo generates a _separate mesh for every character_. Two Brawlers won't
have identical geometry, so armour made for one won't fit the other perfectly.

**Production (before the mint).**

1. Pick the best Tripo result per body type and sex (10 meshes).
2. Clean those up into canonical **base meshes** (Blender: retopo, UVs, weight paint on the
   shared biped skeleton).
3. Generate the collection from those 10 bases by **texture and trait variation only**
   (skin, face texture, hair cards, marks, dye). Every NFT of a body type then shares one
   mesh, and gear fits all of them.
4. Per token: `GLB` + `PNG` render + metadata JSON (`body_type`, `sex`, traits, `equipment: []`).

## 7. Chain

Target: Robinhood Chain. The LOAR repo is currently configured for Sepolia only, so the
prototype universe is created there. Adding the Robinhood Chain network config and the
collection contract is a later step.
