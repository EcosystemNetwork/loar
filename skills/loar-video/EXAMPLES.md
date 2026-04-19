# LOAR Video Skill — Examples

Few-shot dialogue patterns. Read these before the first tool call of a session.

---

## Example 1 — Simple image request

**User:** Make me a picture of a cyberpunk samurai in a neon alley.

**Your move:**

1. Check `loar://credits` — confirm ≥ 5 credits.
2. Call `loar_generate_image` with the prompt, default aspect ratio `landscape_16_9`, `count: 1`, `clientToken: <hex>`.
3. Return the generation ID and media URL.
4. Do NOT auto-mint, auto-list, or auto-create-content.

**You say (to user):**

> Rendering now — a cyberpunk samurai in a neon alley, 16:9. I'll share the result as soon as it's ready (usually 15–30s).

After the result:

> Done. [media url] — generation `gen_abc123`. It's already in your gallery. Want another variation, or should we animate this one?

---

## Example 2 — Animate an existing character

**User:** Animate my character Kira walking through the rain.

**Your move:**

1. Look up Kira: `loar_list_entities({ universeAddress, kind: "person" })` then pick by name match. If ambiguous, ask.
2. Confirm the entity has a `portraitUrl`. If not, offer to generate one first.
3. `loar_generate_video({ mode: "image_to_video", imageUrl: <portrait>, prompt: "Kira walking through heavy rain, neon reflections, slow dolly-in", durationSec: 5, clientToken: <hex> })`.
4. Return control. It's a multi-minute job.

**You say:**

> Kicked off — image-to-video, 5 seconds, slow dolly-in on Kira walking through rain. This usually takes 2–3 minutes. I'll update you when it's ready, or ping me with "is it done?" any time.

Later, when user asks for status:

> Rendering completed. [media url] — generation `gen_def456`. Auto-added to your gallery. Want me to push it further (longer shot, different angle), or is this the keeper?

---

## Example 3 — Ask-before-anchoring

**User:** Make a scene of my character giving a speech and mint it.

**Your move:**

1. Render the scene first (see Example 2 or the talking-scene pattern below).
2. After the render completes, show the result.
3. Ask about mint parameters BEFORE calling `loar_mint_content_nft`.

**You say (after render):**

> Scene is ready: [media url] — generation `gen_ghi789`.
>
> Before I mint it as an NFT, I need to confirm:
>
> - Classification: `fan` (default — you're creating inspired by something you don't own) or `original` (you own the IP)?
> - Mint price in wei (e.g. `0` for free mint, `10000000000000000` for 0.01 ETH)?
> - Max supply (`0` = unlimited)?
> - Royalty basis points (default 500 = 5%)?
>
> Should I proceed with those defaults, or do you want to change anything?

**Only after the user confirms** → call `loar_mint_content_nft`.

---

## Example 4 — Talking scene

**User:** Have my villain Rexa say "You were never the hero of this story."

**Your move:**

1. Resolve Rexa → entity ID, confirm portraitUrl + has a voiceId on the entity.
2. If the platform exposes a `talkingScene.create` combo tool, use it:
   ```
   { entityId, dialogueText: "...", voiceId: <from entity>, clientToken: <hex> }
   ```
3. If not, 3-step flow:
   - `loar_generate_voice({ text, voiceId: <from entity>, entityId, clientToken: <hex-a> })`
   - `loar_generate_video({ mode: "image_to_video", imageUrl: <portrait>, prompt: "subtle head movement, slight smirk, dramatic lighting", durationSec: 5, clientToken: <hex-b> })`
   - Lip-sync: if `lipsync.sync` is exposed as a tool, call it to combine.
4. Return all generation IDs. Do NOT mint.

**You say:**

> Building Rexa's delivery now: synthesizing voice, animating the portrait, then lip-syncing. About 2 minutes. I'll update you when it's ready.

---

## Example 5 — Insufficient credits

**User:** Make a 3-minute trailer for my universe.

**Your move:**

1. Clarify scope first: "3 minutes is roughly 20–40 shots of 5–10s each. Want me to outline the shot list first?"
2. On user approval, check credits: `loar://credits`.
3. Cost estimate: 30 shots × 50 credits ≈ 1500 credits.
4. If balance < 1500, STOP and share the top-up link.

**You say (if under-credited):**

> You have 280 credits. A 3-minute trailer needs roughly 1500 (30 shots at 50 each). Top up at https://loar.fun/credits, then let me know when you're ready and I'll start on the shot list.

**Do NOT** start rendering hoping it'll work.

---

## Example 6 — Copyrighted IP refusal

**User:** Make a video of Iron Man fighting Batman.

**Your move:** Refuse. Offer an original alternative.

**You say:**

> I can't render named copyrighted characters (Iron Man is Marvel/Disney, Batman is DC). But I can build you an original: a powered-armor hero vs. a gadgeteer vigilante, your aesthetic, your universe. Want me to generate a couple concept stills to nail the look first?

Do NOT call any generation tool for the original request. Wait for the user to accept the alternative or redirect.

---

## Example 7 — Rate-limited error

**User:** (mid-session) Make another image, different angle.

**Tool returns:** `{ _meta: { errorCode: "RATE_LIMITED" } }`

**Your move:**

> The platform's rate-limiting us for a moment. Give it ~60 seconds and ask me again. I'll queue this exact request the moment you do.

Do NOT auto-retry. Do NOT loop.

---

## Example 8 — Long-form request (tool not yet available)

**User:** Render me a full 5-minute episode about the war of the three moons.

**Your move:**

1. There is no `loar_make_longform` tool today. Tell the user, offer the decomposed path.

**You say:**

> I can't render a full episode in one call yet — LOAR doesn't expose a long-form composer tool. What I can do: break it into 30–40 shots (5–10s each), render them one by one, and you assemble them in the in-editor timeline. Want to start with the outline? If you already have one, paste it and I'll generate the first 5 shots.

---

## Example 9 — Status check in a fresh conversation

**User:** (in a new session) Is my Kira rain scene done yet?

**Your move:**

1. You won't have the generation ID in memory. Ask the user for it, OR use resources.
2. `resources/read("loar://creation/<id>")` if they have it, else `loar_list_entities` → find recent creations for Kira.

**You say:**

> I don't have that session's context. Do you have the generation ID (starts with `gen_`)? If not, I can list your recent renders — tell me the universe and I'll find it.

---

## Example 10 — Cancellation

**User:** (mid-render) Actually, cancel that.

**Your move:**

1. If MCP transport supports it, send `notifications/cancelled` — the server relays to `generation.cancel`.
2. Otherwise call `generation.cancel({ jobId })` if a tool exists. If not, tell the user cancellation isn't exposed yet and the render will complete on its own (they won't be charged if it fails, but may be charged if it completes).

**You say:**

> Cancelled the render job (`gen_xyz`). You won't be charged for the work in progress.

Only say "you won't be charged" if the cancellation actually refunded the hold. If unsure, say: "I've requested cancellation. Check your credits in a minute — if the hold didn't release, ping support."
