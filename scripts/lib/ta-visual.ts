// Techno Antichrist — shared visual key + per-entity/episode art direction.
// Consumed by gen-techno-antichrist-art.ts and gen-techno-antichrist-video.ts.

// ── Visual key (verbatim from scripts/populate-techno-antichrist-wiki.ts) ────
export const STYLE =
  'TECHNO ANTICHRIST visual key: present-day San Francisco Bay Area and New York, shot like a prestige limited series — ' +
  'The Social Network grain, The Curse dread, The Master sacred-industrial stillness. Photoreal cinematic frame, ' +
  'anamorphic 35mm, fine film grain, practical light only. Palette: cold near-black, fluorescent teal-white, ' +
  'ecclesiastical amber-gold intruding where it should not be, oxblood stamp-red, parchment bone. ' +
  'Recurring motifs: corporate-AV stagecraft as liturgy (follow-spot, atmospheric haze, black pipe-and-drape, lower-third bars), ' +
  'gilt Bitcoin-rune inscriptions lit like an illuminated manuscript, an ever-branching node-graph diagram, ' +
  'aluminium foil taped over windows, black redaction bars and red rubber stamps. Real clothes, real rooms, no costumes. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

export const KIND_FRAMING: Record<string, string> = {
  person:
    'cinematic environmental portrait on 35mm, chest-up to three-quarter, subject lit like a keynote speaker under a single follow-spot against institutional haze, tired eyes, shallow depth of field',
  place:
    'wide establishing shot, real architecture, natural or practical light, anamorphic, no people or one small distant figure for scale',
  faction:
    'documentary group tableau showing a shared identity and posture, available light, slightly unposed',
  event:
    'wide cinematic tableau of the moment itself — crowd, stagecraft and light doing the work, decisive-moment framing',
  lore: 'a single striking symbolic still-life, grounded and photographable — a gilt rune slab, a printed node-graph, a foil-covered window, an org chart lit like scripture — mysterious but real',
  organization:
    'a command/operations tableau in a real interior, insignia or through-line motif present but understated',
};

export const VISUAL: Record<string, string> = {
  'Rex Duce':
    'Rex Duce: a South Asian American man, 33, lean and sleep-starved, three-day stubble, expensive-plain tech-founder clothes (dark merino, one good watch), a hairline nosebleed he is ignoring. Standing at a lectern in a rented Masonic hall, one follow-spot, haze, a gilt rune slab on the podium.',
  'Hana Duce':
    'Hana Duce: a Korean American woman, early 30s, precise and exhausted, holding a sleeping infant on her hip in a half-packed condo, aluminium foil taped over the window behind her, moving boxes, a rent notice on the counter.',
  'Mercy "Merx" Osei':
    'Mercy "Merx" Osei: a Black woman, late 30s, headset around her neck, a clipboard and a laptop with a giant spreadsheet, standing at a front-of-house production desk in the dark at the back of a full room, calm and watchful.',
  'Dov Reisner':
    'Dov Reisner: a white man, ~50, ex-trader gone true-believer, fleece vest over a rune T-shirt, laptop open to a countdown and a token chart, leaning too far forward across a folding table, eyes bright.',
  'The Cartographer':
    'The Cartographer: a 19-year-old Filipina in a small bright bedroom in Manila, three monitors filling the wall with an enormous branching node-graph of gods, one hand pressed to her temple, late-night lamp light.',
  'Aksel Bruun':
    'Aksel Bruun: a tall calm Scandinavian man, 40s, linen and wool, barefoot, healthy, standing in a serene cable-strewn AI hacker house at the foot of Sutro Tower, warm lamps, a wall of quietly humming servers, a cup of tea.',
  'Bobby Tran':
    'Bobby Tran: a Vietnamese American man, 40s, charismatic and volatile, mid-gesture in a cluttered suburban living room full of kids’ shoes and a folded blanket on the floor, one lamp, blinds drawn.',
  'Chairman Seo':
    'Chairman Seo: a Korean man in his 70s, immaculate dark suit, seated alone in a spare high-floor Seoul apartment at night, city lights behind glass, a phone face-down on a lacquer table.',
  'Cal Buhler':
    'Cal Buhler: a white man, mid-30s, startup CTO, hoodie and lanyard, standing in a near-empty office at night beside two dark monitors and a whiteboard covered in architecture diagrams, arms folded.',
  'Agent Lorraine Pryce':
    'Agent Lorraine Pryce: a Black woman, 40s, Treasury / IRS-CI, plain grey blazer, government-issue lanyard, in a fluorescent field office with banker’s boxes labelled by date, a corkboard of printouts behind her.',
  'Imam Yusuf Karim':
    'Imam Yusuf Karim: a warm, weary man in his 50s, simple kufi and cardigan, standing at the back of a small Tenderloin storefront mosque, folding chairs, a donation tablet on a stand he is looking at with dismay.',
  'Rabbi Elke Brandt':
    'Rabbi Elke Brandt: a woman in her 60s, reading glasses on a chain, a book-lined study with a worn couch, two mugs of tea, late afternoon light, direct and kind.',
  'Bibi Harjit':
    'Bibi Harjit: an elderly Sikh woman, dupatta over grey hair, in a warm Fremont kitchen mid-morning, rolling roti, steam, a pot of dal, absolutely unimpressed.',
  'The Congregation':
    'A packed rented ballroom of ordinary Bay Area people — hoodies, work badges still on, some crying, some filming on phones — all turned toward one off-frame follow-spot, haze in the beam.',
  "Dov's Splinter":
    'A tense knot of a dozen believers in a parking garage at night, phone flashlights, a printed map and a Revelation timeline taped to a concrete pillar, Dov at the center.',
  'The Tran Household':
    'A crowded suburban living room: a volatile man, a tired woman, three kids of stepped ages, a grandmother just home, and a grown houseguest’s blanket folded on the floor by the sofa. One lamp, TV glow.',
  'The Rank Doctrine':
    'A large printed org-chart on butcher paper pinned to a wall, every world religion’s figures drawn as nodes and edges in gold marker, lit like an illuminated manuscript, a follow-spot raking across it.',
  'G.O.D. (Galactic Orbital Destroyer)':
    'Double exposure: a fluorescent-lit rented conference room dissolving into an orbital weapons platform hanging over a city at night — same reverent framing, wrong light. Cold near-black and one amber seam.',
  'Angels & Demons as Ranks':
    'A military-style org chart rendered as a stained-glass window: ranked silhouettes with wings above and without wings below, gold leading, each cell holding a small "+" and "−".',
  'The Rune':
    'Macro still-life: a gilt Bitcoin-rune inscription cut into a slab of dark stone on black velvet, one hard raking light, dust motes, shot like a museum reliquary.',
  'The Org Chart':
    'An enormous branching node-graph of every named god, projected floor-to-ceiling in a dark room, one small human silhouette dwarfed before it, amber nodes on near-black.',
  'The Interference':
    'Handheld, grainier frame: a man on a night freeway seen from the passenger seat, dashboard glow, his eyes half-closing, headlights smearing — and in the same shot a perfectly ordinary Wi-Fi router on a shelf.',
  'The Tuning':
    'A crowded hackathon hall under flat white light; in the middle distance one person stares directly at camera holding a laptop like an instrument; foreground man wipes a nosebleed.',
  'Laser Acid':
    'A tiled bathroom, a man sitting in a running shower fully lit by cold light, soap suds on his forearms, visibly relieved; a phone on the sink shows a meme thread; foil-edged window.',
  'Multidimensional Hopping':
    'One man photographed as several overlapping exposures stepping through the same doorway, each version in a slightly different room, cold near-black with amber edges.',
  'Moonbase NASA':
    'A mundane fluorescent-lit records room — endless filing racks of labelled DNA sample boxes — with a single round porthole showing lunar regolith and black sky. Deadpan, real, uncanny.',
  'The Veil':
    'Sutro Tower at dusk shot from directly below, fog pouring through the red-and-white lattice, faint amber node-graph lines overlaid on the descending fog, a house with warm windows at its feet.',
  'The Commission':
    'Close on two hands: an older hand pressing a gilt rune coin into a younger open palm, a follow-spot on the exchange, haze and a blurred watching crowd behind.',
  'The Briefing':
    'A rented hall dressed exactly like a corporate keynote — black pipe-and-drape, follow-spot, haze, a lower-third light bar — but the lectern holds a stone rune slab instead of a laptop.',
  'The Condo':
    'A half-emptied modern SF condo at blue hour: aluminium foil taped neatly over every window, moving boxes, flight-cases of AV gear stacked in a nursery, a rent notice on the counter.',
  'The Lab':
    'A small cash-run sequencing lab after hours: one bench of genomics machines, a centrifuge, a hand-taped "CASH ONLY" sign, cold light, no branding.',
  "Bobby's House (CIA Safehouse)":
    'A beige suburban tract house exterior at night, blinds all drawn, one car in the drive, a doorbell camera — utterly unremarkable, faintly wrong.',
  'AGI House':
    'Interior of a well-funded AI hacker house at the base of Sutro Tower: reclaimed wood, warm lamps, a wall of humming servers, cables run neat along the skirting, a meditation cushion, mugs.',
  'Sutro Tower ("The Antenna")':
    'The real Sutro Tower — red-and-white three-pronged broadcast tower — rising out of thick fog on the hill, shot wide at dusk, tiny houses at its feet, one warm-lit.',
  'The Vault':
    'A Santa Clara data-center cold aisle at night: rows of dark racks, blue status LEDs, a chain-link cage, a fire door — photographed with cathedral gravity.',
  Langar:
    'A Fremont gurdwara langar hall: long rows of people of every kind seated on the floor eating from steel thalis, volunteers ladling dal, warm light, steam, covered heads.',
  'The Pluralist Mile':
    'A single Fifth Avenue block at midday holding a Gothic cathedral, a synagogue facade and an Islamic center within one frame; a small group with a hand-lettered pilgrimage sign on the sidewalk.',
  'Prospect Park — The Nethermead':
    'A wide green meadow ringed by bare trees in Prospect Park, a modest PA stack and a follow-spot tower on a low stage, a large loose crowd gathering, police vehicles just visible at the tree line.',
};

export const EPISODE_VISUAL: Record<string, string> = {
  'Ep 1 — The Commission':
    'A flawless "Briefing" at full tilt — follow-spot, haze, packed rented hall, a holder counter reading 5,000-something on a screen — intercut feel with a load-out and an unpaid invoice; at the edge of frame a nosebleed.',
  'Ep 2 — Bloodlines':
    'A man at 3 a.m. surrounded by printed declassified documents taped into a family tree that connects to every mythology; redaction bars everywhere; one lamp.',
  'Ep 3 — New Jerusalem':
    'A straggling pilgrimage line walking a Bay Area overpass at golden hour toward Sutro Tower in the distance, hand-lettered signs, phones up.',
  'Ep 4 — Laser Acid':
    'A condo going dark with foil over the windows, a man taping the last corner, a Wi-Fi router unplugged on the floor, a rent notice; grainy handheld.',
  'Ep 5 — Moonbase':
    'A man working calmly at a laptop in a fluorescent records room full of DNA sample boxes, a lunar porthole behind him; everyone else acts normal.',
  'Ep 6 — Isa':
    'Inside a small mosque mid-talk: the speaker lit warm and welcomed, the room leaning in — and one volunteer starting to pass a donation tablet, the first cold face.',
  'Ep 7 — Fifty-Fifty':
    'A stopped hallway fight over a phone between a man and a woman, a fake-packed suitcase open on the bed behind them, an infant’s room door ajar; ugly, plain, no score.',
  'Ep 8 — The Safehouse':
    'A grown man asleep under a thin blanket on a suburban living-room floor at dawn, kids’ shoes by the door, a volatile host awake in the kitchen behind him.',
  'Ep 9 — AGI House':
    'Two men talking low in a warm server-lined room at the foot of Sutro Tower, tea between them, fog against the windows, one relaxed and funded, one wired and broke.',
  'Ep 10 — The Veil':
    'Braided frame: a floodlit Prospect Park crowd with a follow-spot stage on one side, and the base of a fog-drowned Sutro Tower with a single figure walking toward it on the other.',
};
