// Orange Pills — shared visual key + per-entity art direction.
// Consumed by gen-orange-pills-video.ts. Style text mirrors the prompt used
// by scripts/seed-orange-pills-wiki.ts for the entity covers, so clips match
// the wiki's existing art.

export const STYLE =
  'ORANGE PILLS visual key — a quiet crypto-truth-religion prestige drama in failing American cities. ' +
  'Photoreal cinematic frame, 35mm anamorphic, fine grain, mixed practical light (fluorescent office vs. warm candle-and-laptop vigil). ' +
  'Palette: bitcoin orange as a sacred accent against cold institutional grey, warm amber candlelight, cool blue screen-glow. ' +
  'Recurring motifs: open laptops as altars, printed hashes and QR codes treated like scripture, handwritten verification ledgers, ' +
  'a wallet address rendered like a holy sigil. Grounded, real clothes, real rooms — the only "unreal" note is how reverently ordinary ' +
  'objects are lit. No on-image text, no captions, no watermark, no logo, no UI chrome.';

export const KIND_FRAMING: Record<string, string> = {
  person:
    'cinematic environmental portrait, chest-up to three-quarter, shallow depth of field, expressive face, motivated practical light',
  place: 'wide establishing shot, real architecture, atmospheric light, no readable signage',
  faction:
    'documentary group tableau showing a shared identity and posture, available light, slightly unposed',
  lore: 'a single striking symbolic still-life, grounded and photographable, mysterious but real',
  event: 'wide cinematic tableau of the moment itself — light and staging doing the work',
  technology:
    'a detailed device/interface render, clean readable form, motivated glow, no legible UI text',
};

// Per-entity visual anchor, copied verbatim from the SEEDS in
// seed-orange-pills-wiki.ts so --motion clips match each entity's cover.
export const VISUAL: Record<string, string> = {
  'Mara Vance':
    "Mara Vance: late 30s, sharp tired eyes, second-hand blazer over a wrinkled shirt, a coffee-stained reporter's notebook and an old digital recorder. Standing at the back of a candlelit vigil she wasn't invited to, arms crossed, unconvinced.",
  'The Signing Wallet':
    "A single laptop on a bare altar table in a dim room, screen showing a freshly verified signature and a timestamp, candlelight flickering across the keys, nobody's hands anywhere near it.",
  'Deacon Ellis Roth':
    'Deacon Ellis Roth: late 40s, cardigan over a plain t-shirt, wire-rim glasses, standing at a whiteboard covered in a hand-drawn verification flowchart in a repurposed storefront, calm and unhurried.',
  'Undersecretary Diane Kwok':
    'Undersecretary Diane Kwok: 50s, severe grey suit, government ID on a lanyard, in a windowless briefing room lit by fluorescent tubes, a wall of printed transaction graphs behind her.',
  'Bishop Aurelio Vann':
    'Bishop Aurelio Vann: 60s, black clerical suit and collar, seated alone in an ornate but half-empty cathedral nave, afternoon light through stained glass, a single unlit candle in his hand.',
  'The Citrine':
    'A repurposed storefront at night, a loose circle of ordinary people — hoodies, work uniforms still on — gathered around a laptop projecting a scrolling ledger onto a bedsheet screen, candles at their feet.',
  'The Consortium':
    'A glass high-rise boardroom at dusk, a dozen executives around a table lit by a single presentation screen showing a slide titled with a redacted codename, city lights below.',
  'The Ledger House':
    'The interior of a converted storefront church: bare brick, folding chairs in a circle, one laptop glowing on a plain table, a large hand-painted QR code on the back wall lit by a single warm lamp.',
  'Meridian Tower':
    'A cold glass-and-steel tower lobby at night, security turnstiles under sterile white light, a bank of elevators, the city skyline reflected and doubled in the glass.',
  'The Verification Rite':
    'A hand-lettered ledger open on a wooden table, three different handwriting styles cross-checking the same entry in different colored ink, a laptop showing a matching hash beside it, candlelight.',
  'The Long Silence':
    'A dust-covered desk in an abandoned apartment, a monitor left on standby for years, a wall calendar frozen two years in the past, a single new footprint in the dust leading to the keyboard.',
  'The Doctrine Chain':
    'A clean, mostly-empty terminal window on a laptop screen showing a scrolling list of timestamped, signed entries, reflected in a pair of reading glasses resting beside the keyboard, dim room.',
  'The Founding Signature':
    'A small huddle of early congregants crowded around a single laptop in a bare unfinished room, faces lit only by the screen, the exact moment a new signature resolves as verified.',
  'The Vigil Mara Stumbles Into':
    'A journalist standing frozen in a storefront doorway at night, half-lit by streetlight behind her, looking in at a candlelit circle of people bent over papers and a laptop, unnoticed for a beat too long.',
};

// Episode key-frame overrides (kind: 'event', names begin "Ep N — ..."),
// used for the --motion i2v/t2v clause when an episode entity itself gets a
// clip rather than one of its shots.
export const EPISODE_VISUAL: Record<string, string> = {};
