---
name: text-to-documentary
description: Convert long-form text (PDFs, books, papers, pasted documents) into ADHD-optimized documentary-style videos — one ~5-minute video per chapter. Each video has a structured narrative arc (Hook → CoreIdea → Examples → PatternInterrupts → MicroRecaps → Cliffhanger), AI-generated voiceover with karaoke captions, and AI b-roll visuals. Use this when the user asks to "turn a PDF into videos", "make a documentary from a book", "convert a paper into a video series", or similar.
---

# Text-to-Documentary Mode

This skill orchestrates the **videolab-mcp** to convert structured documents into engaging short-form documentaries. It's a separate behavior from the short-form promo flow — different defaults, different structural rules, different output shape.

## When to invoke

Trigger on any of:
- "Convert this PDF into a documentary"
- "Turn this book/paper/chapter into videos"
- "Make a Netflix-style series from this PDF"
- "Generate a documentary from this text"
- User uploads a PDF and asks for video output
- User pastes long text and asks for an "engaging" or "ADHD-friendly" video

Do **not** invoke for short-form promo videos — that's a different workflow.

## Input modes

The skill accepts three input shapes. Detect which one applies before starting.

| Mode | Trigger | Steps |
|---|---|---|
| **Full PDF** | User gives a PDF file path or URL | `extract_pdf` → `split_chapters` → loop chapters |
| **Single chapter** (text) | User pastes one chapter's worth of text, or says "just this chapter" | Skip extraction; treat input as one chapter |
| **Whole book as text** | User pastes a long document (no PDF) | `split_chapters` → loop chapters |

## Defaults

These are the documentary-mode defaults. Override only if the user asks.

| Setting | Default | Notes |
|---|---|---|
| `targetMinutesPerChapter` | 5 | Spec target is "5–10 min"; 5 is the sweet spot for retention |
| `sceneSecondsRange` | [15, 25] | Yields ~12–20 scenes per 5-min chapter |
| `visualMode` | `broll` | All AI b-roll via Veo. Alternatives: `slides` (cheap, fast PNG cards) or `mixed` |
| `aspectRatio` | `16:9` | Documentaries default to landscape (NOT 9:16 mobile) |
| `platform` | `desktop` | Matches 16:9 |
| `voiceId` | (use `list_voices` to pick a documentary-suited voice — calm authoritative narrator) | Don't use the default short-form promo voice |
| `captionsWordsPerLine` | 4 | Documentaries handle slightly denser caption blocks well |
| `musicId` | None (silence) by default; ask user if they want a bed | If yes, use `list_music` filter for "documentary" / "calm" mood, or `generate_music` |

## Cost transparency (mandatory)

**Before starting any render loop, show a cost estimate and ask the user to proceed.**

### Why long-form b-roll is more expensive

Each native Veo 3.1 generation is 6–8 seconds. But each scene slot is **15–25 seconds** of narration, so a single Veo clip would have to loop 3–4× to fill the slot — visibly jarring on any clip with motion.

The fix is **chained extensions**: generate an 8s seed, then call `extend_video extensions=3` to get ~24s of continuous, seamless footage. That's 4 Veo generations per scene (1 seed + 3 extensions), not 1.

### Estimate formula

| Mode | Per scene | × ~12 b-roll scenes | + slides + VO + music | **Per chapter** |
|---|---|---|---|---|
| `slides` | ~$0.005 (Nano Banana only) | ~$0.10 | + $1 | **~$1** |
| `broll` (loop, no extend) | ~$2 (8s seed only) | ~$24 | + $1 | **~$25** — ⚠ visible looping |
| `broll` (extended, recommended) | **~$8** (1 seed + 3 extensions × $2) | **~$96** | + $1 | **~$97** |
| `mixed` (extended) | broll for ~9 of 15, slides for ~6 | ~$72 | + $1 | **~$73** |

For a 10-chapter book in extended `broll` mode, that's **~$970**. Always show the user the total before kicking off.

Format the prompt like:
> "Estimated cost for 8 chapters in extended `broll` mode: **~$776** (15 scenes × ~$8 × ~8 chapters). Proceed? (y/n / change mode)"

## Workflow

### Phase 1: Ingest

1. **If PDF:** call `extract_pdf path="..."`. Read `candidateChapters[]`.
2. **If raw text or chapter:** skip to phase 2.

### Phase 2: Chapter structure

1. Call `split_chapters text=<full text> strategy="auto"`.
2. **Show the chapter list to the user and ask them to confirm** — wrong chapter splits cascade into bad videos. Format:
   > "Detected 8 chapters: 1. The Inciting Incident (4,200 words), 2. ... — Look right? Or should I re-split with `strategy='wordcount'`?"
3. If user says wrong, re-call with overridden strategy.
4. **If user provided a single chapter:** wrap it as `[{ number: 1, title: <user-provided>, text: <input>, wordCount: ... }]`.

### Phase 3: Cost estimate + confirmation

Compute estimated cost as above. Ask user to proceed. If they decline, stop.

### Phase 4: Per-chapter loop

For each chapter:

1. **Plan scenes** — `plan_documentary_scenes chapterText=<chapter.text> chapterTitle=<chapter.title> targetMinutes=5 includeVisualPrompts=true`
2. **Validate** — `validate_attention scenes=<scenes>`. If `!ok`, re-plan once. If still `!ok`, surface issues to user and ask whether to proceed anyway, hand-edit, or skip the chapter.
3. **Generate one chapter voiceover** — concatenate all scene narrations (joined with `\n\n` for natural pauses) into one string and call `generate_voiceover text=<concatenated> withTimestamps=true`. The single VO with one alignment makes captions trivial. Save the returned `voiceoverId`.
4. **Generate visuals per scene** — depending on `visualMode`:
   - `broll` (long-form, the default for documentaries):
     1. **Source frame**: `generate_image prompt=<scene.visualPrompt> aspectRatio="16:9" imageSize="2K"` → `imageId`.
     2. **Seed motion**: `animate_image_to_video imageSource={kind:"image",id:<imageId>} prompt=<scene.visualPrompt> platform="desktop" durationSeconds=8` → `seedBrollId` (with captured `veoRef`).
     3. **Extend to scene length**: `extend_video brollId=<seedBrollId> extensions=3 prompt=<scene.visualPrompt>` → `extendedBrollId`. This produces ~24s of seamless continuous motion. Use the *extended* clip as the slot source, NOT the seed.
     4. **Why 3 extensions?** Each Veo generation = 6-8s. A 22s scene slot needs ~24s of footage to avoid jarring loops. 1 seed + 3 extensions ≈ 32s, comfortably covers any scene in the 15-25s range with headroom.
     5. **Tuning**: For shorter scenes (15-18s), `extensions=2` is enough (~24s). For longer (22-25s), use `extensions=3`. Validate scene's `durationSeconds` and pick accordingly.
   - `slides`: For each scene, `generate_image prompt="Documentary title card. Pure black background. Large bold elegant white serif text reading: '<scene.visualText>'. Subtle warm amber color grading. Minimal, cinematic, like a Ken Burns documentary chapter card. No other text or imagery." aspectRatio="16:9"` → use the image id as the slot source via `{kind:"url", url:"<local file path from generate_image>"}` (the `image` source kind isn't yet wired into `assemble_promo`).
   - `mixed`: Use **extended b-roll** for `Hook`/`CoreIdea`/`Example`/`WhyItMatters`/`Cliffhanger` (the storytelling beats); use **slides** for `Transition`/`MicroRecap`/`PatternInterrupt` (the structural beats — they read as section dividers/title cards punctuating the b-roll).
5. **Build the timeline** — one slot per scene, `durationMs = scene.durationSeconds * 1000`, sources from step 4.
6. **Assemble** — `assemble_promo timeline={platform:"desktop", slots:[...]} voiceoverId=<from step 3> musicId=<optional> captions=true captionsWordsPerLine=4 autoPlay=false`. Returns `renderId`.
7. **Save the render** — note the local file path (in the response) and append to a chapter results list. Do NOT use `save_render_to_treefrog` — that's for the game pipeline only.

### Phase 5: Summary

Output a summary table:

```
Documentary: <book or doc title>
Chapters rendered: 8/8
Total render time: ~2h
Total cost: ~$245

Files:
  Chapter 1: media/renders/render_xxx/output.mp4
  Chapter 2: media/renders/render_yyy/output.mp4
  ...
```

## Failure handling

- **PDF unreadable** → report and stop.
- **`plan_documentary_scenes` returns invalid JSON** → re-call once. If it fails again, surface the raw output and ask the user to inspect.
- **`validate_attention` fails** → re-plan once. If still failing, ask user to override or skip.
- **Veo rate-limit / extension errors** → retry is built in. If exhausted, fall back to slides for that scene.
- **One chapter fails** → log the error, continue with the next chapter. Don't abort the whole book.

## What NOT to do

- ❌ Don't call `save_render_to_treefrog` — that's game-only and writes to a Mongo schema unrelated to documentaries.
- ❌ Don't generate at 9:16 mobile — documentaries are landscape.
- ❌ Don't skip the chapter-confirmation step (phase 2 step 2). Bad splits ruin everything downstream.
- ❌ Don't skip the cost estimate. Users will be furious if a $300 render starts without warning.
- ❌ Don't try to upload to YouTube. Out of MVP scope.

## Quick reference — tools used

| Tool | Phase | Purpose |
|---|---|---|
| `extract_pdf` | 1 | PDF → text + candidate chapters |
| `split_chapters` | 2 | Text → chapters[] |
| `plan_documentary_scenes` | 4.1 | Chapter → scenes[] (LLM, ADHD-aware) |
| `validate_attention` | 4.2 | Scenes → ok/issues (deterministic) |
| `generate_voiceover` | 4.3 | One VO per chapter |
| `generate_image` | 4.4 | Slide cards or b-roll source frames (Nano Banana, 16:9, 2K) |
| `animate_image_to_video` | 4.4 (broll/mixed) | Image → 8s Veo seed clip (with veoRef captured) |
| `extend_video` | 4.4 (broll/mixed) | **Required for long-form.** Chains 1-10 Veo continuations on a seed clip → 16-80s of seamless footage. Without this, b-roll loops visibly. |
| `list_voices`, `list_music` | (setup) | Pick narrator voice, optional music bed |
| `generate_music` | (optional) | Custom music bed (180s default loops to fill chapter) |
| `assemble_promo` | 4.6 | Stitch timeline + VO + music + captions |
