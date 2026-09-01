# MULLET recovery plan

Owner: implementer. Operator's only job is to look at a served build and say right or wrong.

## The defect

`minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` is installed on both
`firestorm:8188` and `firestorm:8189`. Verified live via `/object_info/LoraLoaderModelOnly`.
`minimax_h3_fl2v_turbo_4step` and `minimax_h3_fl2v_turbo_8step` are installed too.

Three of the four media defaults run the unaccelerated 20-step path anyway.

| Loop stage | Default template | Steps | Turbo LoRA | Verdict |
| --- | --- | ---: | --- | --- |
| Expression still | H3 Ref2VA `MINIMAX_H3_PORTRAIT_STILL_TEMPLATE` | 20 | **none** | broken |
| Expression motion | H3 FL2VA `MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE` | 4 | `fl2v_turbo_4step` | correct |
| Scene still | H3 Ref2VA `MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE` | 20 | **none** | broken |
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

Consistency is a reference chain, not a per-stage prompt. Each accepted output becomes an
input reference downstream and is frozen on acceptance:

- identity: the per-character reference image is immutable and always Picture 1 of the still.
- expression: the accepted still is the sole source frame for the loop (already how FL2VA works).
- cast: the accepted still enters the scene still's reference list, ordered, stable across turns.
- setting: the first accepted scene still for a location is retained and re-fed as a reference
  for every later scene in that location. Ref2VA takes up to 9 references; ordering is fixed.

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
| 1 | Expression still fast | Paired Qwen-4step vs H3-ref2v-4step timings shown; winner is default; portrait is recognizable and correctly framed |
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
