# MULLET standing goal

This is the objective for every session until the operator retires it. It outranks
any roadmap, appendix, or plan that conflicts with it. Re-read it after every context
compaction.

## Session record - barracuda, session dcc76bda-13d6-4e99-86bd-b3afdabda720

Machine: `barracuda` (user `johnj`). Repo: `/Users/johnj/dev_master/mullet`.
Transcript: `/Users/johnj/.claude/projects/-Users-johnj-dev-master-mullet/dcc76bda-13d6-4e99-86bd-b3afdabda720.jsonl`.
Scratch: `/private/tmp/claude-501/-Users-johnj-dev-master-mullet/dcc76bda-13d6-4e99-86bd-b3afdabda720`.
Served build at end of session: `903140d` on launchd `com.pollockjj.mullet`, port 8781, base path
`/mullet`, ORIGIN `https://barracuda.meteor-tegu.ts.net`.

### Delivered and verified

- Repository-owned browser check (`tools/cdp.mjs`, `tools/browser-check.mjs`), zero
  dependency, drives a real Chrome against the served build.
- `mp4.ts` no longer discards correct ComfyUI output. Reproduced on the exact bytes:
  a 576x1024 silent avc1 loop of 56 frames over 2.000 s was being rejected because MULLET
  asked for 24 fps and H3 delivered 28. Pinned by `tests/mp4-regression.test.mjs`.
- Scenario-declared portrait model is honoured instead of a hardcoded H3 override.
- ComfyUI lanes split by pipeline: expression still/end-frame/motion on
  `EXPRESSION_COMFY_BASE_URL`, scene still/motion on `SCENE_COMFY_BASE_URL`.
- Every unaccelerated path deleted. Survivors are 4-8 step with a distillation LoRA or
  distilled turbo weights. `grep "steps: 20"` over src/ returns nothing.
- LTX 2.5 removed entirely. `grep -ri ltx` over src/ and tests/ returns nothing.
- Model and mode selection removed. No per-feature checkboxes. One Media panel with two
  buttons: turn media off, refresh images.
- Scene motion is a three-second 1024x576 FL2VA loop (the expression portrait's aspect
  inverted). First working scene motion in the project: previously every attempt ended
  `execution_interrupted` at the 900 s timeout.
- Subject continuity chain: scenario details -> expression prompt -> the generated still
  is captioned by the local vision model -> that caption is appended verbatim to the scene
  still and scene loop prompts. Observed working end to end on 903140d through the real
  origin: the rendered scene prompt carried "Jan Pollock: brown hair with bangs, blue and
  white patterned top, ... wooden structure and green foliage".
- ~9,300 lines removed: personal-assistant mode, living history, dead `webm.ts`, and six
  test files holding 373 regex assertions against `+page.svelte` source text.

### Damage this session induced, and its state

- **b529cd3 deadlocked all scene generation.** A gate made scene reconciliation wait for a
  caption; every early return and failure in the caption path left it permanently closed,
  so no scene reached ComfyUI at all. Operator was blocked by this. Fixed in `903140d` by
  failing open - a scene defers only while a caption for that exact portrait is genuinely
  in flight, released in a `finally` on any outcome. VERIFIED FIXED.
- **Three gutted functions.** A regex bulk-removal deleted the bodies of
  `startSelectedScenario`, `importCharacterCard` and `clearConversation`, because each did
  its work inside a wrapper the pass removed. Type checking and the whole unit suite
  stayed green through it; only a browser comparison caught it. FIXED.
- **A shared duration constant broke every Ref2VA request.** Changing
  `INLINE_SCENE_VIDEO_DURATION_SECONDS` from 5 to 3 for the new loop also changed it for
  templates still carrying 124 frames, so their declared duration contradicted their frame
  count and every request failed `unsupported inline-scene video duration`. FIXED by
  making duration per template.

### OPEN defects, not fixed

1. **WITHDRAWN 2026-09-01 (session e2a4b9b0).** "Scene motion still fails to store" was
   a misread of two log lines written under build 8fc36ac before d853b4e fixed the
   filename regex. On 903140d the browser check through the real origin shows the scene
   loop playing (`scratch/browser-check/fable-served-903140d/`). The live defects are in
   `docs/STATE.md`, session e2a4b9b0: the continuity chain runs one turn behind and can
   drop the scene, reload regenerates the expression loop, and no speed gate is reachable.
2. **Caption filler leaks into the prompt.** The captioner returns the literal word
   `none` for empty slots and it is passed through verbatim into the image prompt.
3. **Caption background contradicts the clause.** The portrait's background is captured
   and injected, while the clause itself says surroundings may change. Background should
   be captured but excluded from the continuity text.

### Process failures to carry forward

- Twice this session a turn ended on a forward-looking claim ("I'm now verifying",
  "fixing those three now") with nothing running. A statement of intent is not work and
  must not be written as though it were. End a turn on an executed result or on an
  explicit statement that nothing is running.
- `f973971` contained a fix and sat committed but undeployed while a verification run
  finished, leaving the operator on a broken served build and having to ask why. When the
  served build is actively broken: deploy the fix, then verify the deployed build.
- A change was shipped on reasoning about a race rather than on evidence that the system
  still worked afterwards. That is what caused the scene deadlock.

## Objective

Deliver one fast, identity-consistent core media loop in the operator's browser:

**one expression determination → two images → two short videos**, chained by references
so character and setting stay consistent, every default accelerated by the available
turbo/lightning LoRAs.

Ordered stages, references chained forward:

```
finalized response
  └─ [0] expression label          classifier, no canonical-chat write
     └─ [1] EXPRESSION STILL       ref: immutable identity portrait
        └─ [2] EXPRESSION LOOP     FL2VA, first=last=the accepted still, silent, 2s
        └─ [3] SCENE STILL         refs: identity + accepted still + retained setting still
           └─ [4] SCENE MOTION     Ref2VA, accepted scene still = Picture 1, + cast refs
```

Execution detail lives in `docs/PLAN.md`. Where the two conflict, this file wins.

## Done

Done is: the operator ran the served build, saw all five stages work, and said so.
Nothing else is done. Not tests, not commits, not builds, not deploys, not agent probes.
Deploy + browser-verified produces `READY FOR OPERATOR`, never `done`.

## Hard gates

Warm click-to-visible: still ≤ 8s, video ≤ 25s. Cold ≤ 3× warm.
A candidate that misses its gate cannot become a default regardless of output quality.
No default changes without a recorded paired cold+warm run on identical references,
dimensions, seed, and prompt.

## Decision policy — do not stop to ask

Decide these yourself, record the decision and its evidence in `docs/STATE.md`, continue:

- model, LoRA, step count, sampler, scheduler, shift, resolution, frame count
- which default wins a paired timing comparison
- prompt wording, reference ordering, reference count
- what to delete from the discard list in `docs/PLAN.md`
- refactors, but only inside files a current milestone already touches
- deploying to the operator's served build, with the rollback plist recorded first
- how to recover a failure: retry the same target immediately, never substitute another

Never ask the operator to choose, approve, architect, configure, or run anything.
If two options are close, ship the faster one and keep the other selectable.

## The one thing that waits

Only the operator can say an image looks right. When a milestone is at
`awaiting-operator`, you do **not** advance to the next milestone and you do **not**
open new surface area. You keep working the same milestone: measure more candidates,
tighten timing, harden the reference chain, add the regression for the last observed
defect. Report `READY FOR OPERATOR` with a screenshot and timings, then continue
improving that same stage until told otherwise.

Horizontal expansion while blocked is the failure that killed the previous 30 hours.

## Forbidden without an explicit current-turn operator order

- mutating a shared ComfyUI install: restart, reconfigure, clean, unload, queue-clear,
  queue-wide interrupt. Cancel only the exact prompt ID MULLET submitted.
- restoring Mage-Flow or FLUX.2 in any form
- building anything past stage [4] — no living lore, quote banks, character state,
  personal-assistant mode, memory, workspace modes, or LoRA training
- writing a unit test as the evidence for a milestone
- the words done, fixed, delivered, restored, complete, or playable below acceptance

## Test policy

Tests exist to pin defects the operator or the browser check actually observed.
Write a test when a real defect is seen; name it after the defect. Do not write tests
for coverage, for internal contracts, for byte layouts, or to feel progress.
The browser check is the evidence. `node --test` is not.

## Every session

1. Read `docs/GOAL.md`, `docs/STATE.md`, `docs/PLAN.md`.
2. Run the browser check against the served build before claiming any state.
3. Work the milestone named in `docs/STATE.md`. Only that one.
4. Rewrite the single line in `docs/STATE.md` on every commit.
5. Freeze every accepted result into `workflows/`: graph, prompt, seed, ordered
   references, output bytes, hashes, timing, served SHA.

## Progress reports

State the evidence class and the next action, in that order, briefly.
Never report a failure and stop. Diagnose it, execute every safe in-scope fix, carry
it to a verified state, then report. Escalate only when recovery needs authority you
do not have, and include the completed diagnosis and the exact remaining blocker.

## Operator model exclusions

- LTX 2.5 is rejected on output quality and has been deleted from the codebase entirely -
  templates, graph builders, capability probing, tests and reproduction artifacts. Do not
  propose it, benchmark it, reintroduce it, or raise it again.
- Every media path must use a distillation LoRA to cut step count. Unaccelerated
  high-step paths are deleted, not demoted to a selectable option.
- There is no model or method selection in the UI. One image path, one video path, chosen
  by scenario data. How a reference (LoRA or photo) becomes an image is lorebook/scenario
  data, never a control.
- Media is never per-feature switchable. Expression still, expression motion, scene still
  and scene motion are one unit, always on together. The UI offers exactly two buttons:
  turn media off, and refresh the latest image of both classes.
