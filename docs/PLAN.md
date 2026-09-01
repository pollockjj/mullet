# MULLET recovery plan

Owner: implementer. Operator's only job is to look at a served build and say right or wrong.

## H3 is the wrong model for the two stills

MiniMax H3 is a **video** model: a 33.1B dense omni-modal transformer with a Qwen3-VL-32B
text encoder, built to emit up to 15s of 768p video with native stereo audio in one pass.
Ref2VA is its multi-reference *video* mode. MULLET's "expression still" path runs that
model to produce a five-frame video packet and keeps frame zero.

Measured on firestorm:8188, 576x1024, one identity reference, fixed base seed, warm runs
using a fresh seed so ComfyUI's execution cache cannot be mistaken for inference
(`npm run time-stills`, raw data in `scratch/still-candidate-timings.json`):

| Candidate | cold | warm | reference-conditioned | warm gate 8s |
| --- | ---: | ---: | --- | --- |
| Qwen Image Edit 2511 + Lightning 4-step | 30.0 s | **5.8 s** | yes | PASS |
| Z-Image Turbo, 8 step | 13.4 s | **2.2 s** | no, LoRA identity only | PASS |
| H3 Ref2VA still, 4 step + ref2v turbo | 42.5 s | **6.9 s** | yes | PASS |
| H3 Ref2VA still, 20 step (shipped default) | 20.2 s | **14.1 s** | yes | **FAIL** |

Qwen's 5.8 s warm matches the operator's independent ~5 s report, which is the harness
validating itself. The shipped 20-step default misses the gate by ~1.8x.

H3 with the 4-step turbo LoRA does clear the gate at 6.9 s - an earlier estimate of
~8.7 s from published per-iteration figures was too pessimistic and is corrected here.
It is still 19% slower than Qwen, crops tighter than the requested head-and-chest
framing, and is a 33.1B video model doing an image job. The missing turbo LoRA remains a
real defect for the two **videos**; it is not the fix for the two **images**.

End to end in a real browser against the candidate build (`npm run browser-check --
--generate portrait`), Blake's 7 / Jenna, Qwen selected from the scenario data:

| Stage | Measured |
| --- | ---: |
| Hydration and ComfyUI capabilities | 0.10 s |
| Scenario active after starter click | 0.25 s |
| Expression classifier (gemma-4-ortenzya) | 1.0-1.5 s |
| Portrait generation, first time for that expression | 5.4-5.8 s (graph-level, cache defeated) |
| Portrait generation, repeat of the same expression | 0.3-0.8 s (ComfyUI execution cache) |

Scenario characters carry a `promptOverride`, so attire and setting do not perturb the
prompt and MULLET submits a fixed seed. A repeat of an already-generated expression is
therefore served from ComfyUI's cache in well under a second - real and desirable, but
not the number the gate is about. Composed first-generation click-to-visible is
approximately **6.5-7.5 s, inside the 8 s gate**.

Cold times are 13-42 s across every candidate. That is weight residency on a shared box,
not model choice, and it is the same problem for whichever default wins.

Identity, same reference and prompt, images in `scratch/still-candidates/`: Qwen
preserves face, hair, the exact costume, the necklace and the background with a clear
fear expression. H3 4-step holds identity but crops tighter and under-expresses.
Z-Image without a LoRA produces a different person entirely - it has no reference
conditioning, so it is only valid for subjects that have a trained subject LoRA, which
is exactly how the scenario data already uses it.

Corroborating evidence from this repository: every image result ever accepted came from
a purpose-built image model. The known-good Jenna is Qwen Image Edit 2511 + 4-step
Lightning. The build the operator currently calls fine is running Z-Image Turbo. Accepted
H3 stills: zero.

Stages [1] and [3] therefore drop H3. The still shortlist is drawn from what is installed
on the image lane, excluding Mage-Flow and FLUX.2 by standing operator order:

- **Qwen Image Edit 2511** + `Qwen-Image-Edit-2511-Lightning-4steps` - known good, reference-conditioned edit
- **Z-Image Turbo** - currently live, fast, no reference conditioning
- **boogu_image_edit_turbo** - installed, untested, an edit model like Qwen
- **krea2_turbo**, **ideogram4** - installed, untested, generation rather than edit

Expression work is an *edit* on a fixed identity reference, so the edit models are the
primary candidates and the generators are fallbacks.

## The defect

`minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` is installed on both
`firestorm:8188` and `firestorm:8189`. Verified live via `/object_info/LoraLoaderModelOnly`.
`minimax_h3_fl2v_turbo_4step` and `minimax_h3_fl2v_turbo_8step` are installed too.

Three of the four media defaults run the unaccelerated 20-step path anyway.

| Loop stage | Default template | Steps | Turbo LoRA | Verdict |
| --- | --- | ---: | --- | --- |
| Expression still | H3 Ref2VA `MINIMAX_H3_PORTRAIT_STILL_TEMPLATE` | 20 | **none** | wrong model, see above |
| Expression motion | H3 FL2VA `MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE` | 4 | `fl2v_turbo_4step` | correct |
| Scene still | H3 Ref2VA `MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE` | 20 | **none** | wrong model, see above |
| Scene motion | H3 Ref2VA `MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE` | 20 | **none** | broken |

`MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE` already carries
`ref2v_turbo_4step` at 4 steps. It was built, labelled "Fast preview", and left
non-default while the 20-step path was labelled "Default quality". The two still
paths never got the LoRA at all: `grep turboLora src/` returns three hits, all in
`portrait-video.ts`. This was a default-selection failure, not a missing capability.

## Discard

Deleted outright. Recoverable from git if ever wanted.

| Path | Lines |
| --- | ---: |
| `living-history*.ts`, `assistant-memory*.ts`, `personal-assistant.ts`, `workspace-state.ts` + routes + tests | 3,756 |
| `mp4.ts`, `webm.ts` byte-level validators | 1,028 |
| Versioned storage envelopes and migrations outside the four media paths | ~2,000 |
| Dead template branches after defaults collapse | ~1,500 |

Kept: `workflows/expression-reproduction/` (exact replayable graphs, inputs, outputs,
hashes), the SillyTavern core (`character-card`, `png-character-card`, `png-lorebook`,
`lorebook`, `token-limit`, `chat-stream`, `sidecar`, `scenario`, `model-tokenizer`,
`regex-sandbox`, `api/chat`), model template constants, `comfy-managed-reference.ts`.

`+page.svelte` (6,456 lines) is split only as each milestone touches it. No standalone
refactor milestone.

## The loop

One classifier, two images, two videos. Nothing else is built until all five are accepted.

```
finalized response
  └─> [0] expression label            sidecar classifier, no canonical-chat write
        └─> [1] EXPRESSION STILL      refs: identity portrait
              └─> [2] EXPRESSION LOOP FL2VA, first frame = last frame = still, silent, 2s
              └─> [3] SCENE STILL     refs: identity portrait + accepted still + setting still
                    └─> [4] SCENE MOTION  Ref2VA, accepted scene still = Picture 1, + cast refs
```

Consistency is a **sequential caption chain**, not a shared reference photo. The failure
it replaces: expression and scene were independent edits of the same canonical photo,
with their own seeds and prompts, and the generated portrait never reached the scene.

1. **Scenario declares** `subject`, `attire`, `setting` per character (already in the
   lorebook, e.g. Jenna's burgundy/silver leather tunic, the Liberator flight deck).
2. **Expression prompt uses those details.** Where the scenario supplies a hand-written
   `expression_prompts[label]` that override wins; otherwise the generic path composes
   subject + expression + attire + setting.
3. **The produced still is captioned** by the local model - concrete visible facts only:
   hair, garments, accessories, background. Read off the pixels, not restated from the
   scenario, because what matters downstream is what the model actually made.
4. **That caption is the subject's live descriptor** and is appended verbatim to the
   scene still prompt and to the scene loop prompt, named per subject so a multi-person
   scene binds each description to the right person.

The descriptor is bound to the exact portrait SHA it was read from, so a stale caption
can never be applied to a portrait it does not describe. It is part of the inline-scene
request key, so a changed appearance forces a new scene instead of reusing a stale one.

Caption text is untrusted model output concatenated into a ComfyUI prompt: collapsed to
one bounded line, and refused outright if it contains `<Picture>`/`<Subject>` reference
tokens that could hijack the graph.

Motion inherits by construction: both loops take their own accepted still as the
identical first and last frame, and the scene loop prompt carries the same caption.

## Speed

Every default is the fastest path that passes identity. Not the reverse.

Budget, click to visible, warm: still ≤ 8s, video ≤ 25s. Cold ≤ 3× warm.
Any candidate that misses is not eligible to be a default regardless of quality.

Measurement is a real generation through the candidate app, broken into classifier /
queue / load / inference / transfer / persist / paint. Paired cold+warm, identical
references, dimensions, seed, prompt. No default changes without the pair recorded.

Known baseline: Qwen Image Edit 2511 + `Lightning-4steps` at 576×1024, 4 steps, cfg 1,
euler/simple — operator-reported ~5s warm. This is the bar H3 Ref2VA + `ref2v_turbo_4step`
has to beat or match. Whichever wins becomes the default; the loser stays selectable.

## Milestones

Each ends with a served build and a screenshot. None starts before the previous is
accepted. Each is one sitting or it is reported as a miss and retried on the same target.

| # | Deliverable | Accepted when |
| --- | --- | --- |
| 0 | Browser check in-repo; discard list executed; timing harness | Suite boots the built app, drives it, writes screenshot + timing JSON |
| 1 | Expression still fast | Paired timings across Qwen Image Edit 2511 + Lightning-4step, Z-Image Turbo and boogu edit turbo; H3 is not a candidate; winner is default; portrait is recognizable and correctly framed |
| 2 | Expression motion | 2s silent loop from exactly the accepted still; no reload regeneration |
| 3 | Scene still | Landscape uses identity refs + accepted portrait; selected model provably in the submitted graph |
| 4 | Scene motion | Accepted scene still is Picture 1; plays; no reload regeneration |
| 5 | Continuity | Two consecutive scenes in one location hold identity, wardrobe, setting |

Nothing past 5 — no living lore, assistant mode, training, quote banks — until 5 is accepted.

## Rules I hold

1. Nothing is reported without me having opened the served build and looked at it.
2. Every accepted result is frozen immediately: graph, prompt, seed, ordered references,
   output bytes, hashes, timing, served SHA — into `workflows/`.
3. No new persistence layer until a stage is accepted. Stale stored state is what made
   corrections fail to appear.
4. Options are additive. A default change never removes the previous option.
5. Blocked on operator judgment means I stop and say so. It does not mean I start
   something I can grade myself.
