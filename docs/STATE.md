MILESTONE: 4 | STATE: in-progress | SERVED-SHA: 407a119e2acad64cf778ec77c72df3c77d292bfd | LAST-OPERATOR-RESULT: scene motion reported broken on eef5e127/ed15c4b

Rewrite the line above on every commit. One line. Milestones are defined in docs/PLAN.md.

## Decision log

- Browser check driver: zero-dependency Chrome DevTools Protocol over node's native
  WebSocket (`tools/cdp.mjs`), not Playwright. Beat: Playwright/Puppeteer. Evidence:
  Chrome 152 and node 26 are present; the repo has no test framework and no runtime
  deps beyond Svelte/Vite, and a ~300MB browser download is not worth re-adding.
- Browser check drives the UI by the `aria-label`s already in the markup, not new
  `data-*` hooks. Evidence: `+page.svelte` is slated for splitting; instrumenting
  6,456 lines now would be redone. aria-labels are a stable contract.
- Readiness gate is the presence of the portrait model selectors plus the absence of
  "Connecting…", not the `<h1>`. Evidence: the shell is server-rendered, so `<h1>`
  exists before hydration; driving in that window silently no-ops (observed:
  `selectByText` and `clickText` both returned false against a live build).
- Replaced `src/lib/mp4.ts` (656 lines) with a 220-line inspector rather than deleting
  it outright as `docs/PLAN.md` said. Kept: H.264 codec, requested dimensions, requested
  frame count, and audio-track presence (the silence requirement is real product policy).
  Dropped: exact-equality assertions between container duration, sample tables, and the
  requested frame rate, plus box budgets and lacing checks. Evidence: those assertions
  were discarding correct H3 output on the served build.
- Deleted `src/lib/webm.ts` (372 lines) outright. Evidence: zero production callers;
  its only consumer was its own test file and fixture.
- Deleted `tests/mp4.test.mjs` and `tests/webm.test.mjs` (byte-layout tests of removed
  strictness). Kept `tests/mp4-fixture.mjs`: six route and storage tests legitimately
  need valid MP4 bytes.
- Served build base path is `/mullet`, baked in at build time and absent from the
  launchd plist. Evidence: `GET /` 404s, `GET /mullet/` 200s on 127.0.0.1:8781.

## Open defects found by the browser check, not yet worked

- M3 (scene still): UI renders "MiniMax H3 keeper still is unavailable. Refresh models"
  while `GET /mullet/api/portrait` reports `minimax-h3-ref2va-portrait-still-v1`
  `available=true missing=[]` and every required node exists on firestorm:8188.
  `inlineSceneSelectedModelAvailable` is a false negative at `+page.svelte:5833`.
- M1 (expression still): with a scenario loaded, `Portrait image model` reads
  "Z-Image Turbo", not the intended H3 default.
- M2/M4 (video): FIXED in milestone 0. `src/lib/mp4.ts` rejected correct ComfyUI H3
  output in production. Reproduced on the exact bytes: ComfyUI
  `portrait-motion-loop-flf_00116_.mp4` (576x1024, 56 frames, 2.000s, silent, avc1) is
  a correct two-second loop; the old validator threw "MP4 video frame rate does not
  match the request" because MULLET asked for 24 fps and H3 delivered 56 frames over
  2.000s = 28 fps. Old validator FAIL, new validator PASS, both verified against the
  same bytes. Pinned by `tests/mp4-regression.test.mjs`.
- H3 is removed as a candidate for stages [1] and [3] (the two images). Evidence: H3 is a
  33.1B omni-modal *video* model (Qwen3-VL-32B text encoder, 15s 768p video with stereo
  audio); the still path runs it to make a five-frame video and keep frame zero. Pruned
  INT8 measures ~2.17 s/iteration, so 20 steps is ~43 s and even 4 steps with the
  ref2v turbo LoRA is ~8.7 s of sampling alone against an 8 s warm gate. Qwen Image
  Edit 2511 + Lightning-4step is operator-reported ~5 s end to end and produced the
  known-good Jenna. Every accepted image in this project came from a purpose-built image
  model; accepted H3 stills: zero. The turbo-LoRA defect remains real for stages [2] and
  [4], the two videos.
- Timing harness is `tools/comfy-timing.mjs` (paired cold/warm against a ComfyUI lane)
  plus `--generate portrait` in the browser check for true click-to-visible. Shared-service
  rule honoured: it submits jobs like any MULLET request and cancels only its own exact
  prompt ID. No /interrupt, no queue clear, no model unload anywhere in the harness.
- `boogu_image_edit_turbo` is NOT a usable candidate despite the unet being installed:
  firestorm:8188 has no `boogu` text encoder and no boogu VAE. Availability means the
  whole artifact set, not just the diffusion weight. Same check retired krea2/ideogram4
  as immediate candidates. Real shortlist: Qwen Image Edit 2511 + Lightning-4step
  (reference-conditioned edit) and Z-Image Turbo (LoRA identity, no reference).

## Regression I introduced and fixed inside milestone 0

The bulk statement-removal pass that stripped personal-assistant code deleted the bodies
of three core fiction functions, because each did its real work inside an
`await runPersonalAssistantTurnExclusive(async () => { ... })` wrapper and the pass
removed whole `await ...` statements:

- `startSelectedScenario` - scenario starters silently did nothing
- `importCharacterCard` - card import silently did nothing
- `clearConversation` - reset silently did nothing

Caught by comparing per-function line counts before and after the discard, then confirmed
in a browser against the operator's served build: baseline activated the Jenna starter,
the candidate did not. All three restored with the wrapper removed and the mode branches
dropped. Verified in a browser: starter activates and selects its declared model.

Lesson recorded: a regex-driven bulk removal over a 6,456-line component needs a
per-function size diff afterwards. Type checking and the unit suite both stayed green
through this breakage - only the browser caught it.

## Milestone 1 evidence, deployed as ed15c4b

Served: `scratch/releases/ed15c4b0d76b2ec0458a2622821e470f5b8c74d8-mullet`, launchd
`com.pollockjj.mullet`, healthz reports revision ed15c4b. Rollback to the previous
release recorded at `scratch/deploy/rollback-eef5e127-before-ed15c4b.plist`.

Browser check against the served build (`scratch/browser-check/served-ed15c4b/`):
scenario active 253 ms, classifier 1006 ms, portrait visible, model reads
"Qwen Image Edit 2511 · identity reference", zero alerts, zero page errors.

Default decision: Qwen Image Edit 2511 + Lightning-4step for reference-identity
subjects, chosen on measured warm inference (5.4-5.8 s over three runs, versus H3
Ref2VA 4-step at 5.7-6.9 s and H3 20-step at 14.1 s) and on identity, framing and
expression fidelity in `scratch/still-candidates/`. Z-Image Turbo stays the default only
where the scenario declares a trained subject LoRA, which is how the data already had it.
H3 remains selectable and is never silently substituted.

NOT yet done in milestone 1: a click-to-visible number for a genuinely novel expression
measured through the app. Scenario subjects carry a promptOverride and MULLET submits a
fixed seed, so repeating an already-generated expression is a ComfyUI cache hit at
0.3-0.8 s. The 5.4-5.8 s figure is graph-level with the cache defeated by seed variation.
Composed first-generation click-to-visible is ~6.5-7.5 s against the 8 s gate, but that
composition has not been observed in one continuous browser run.

## Milestone 4 - scene motion was never working

Operator report: "Inline scene motion timed out", and scene motion has never once worked.

Verified on the video lane: every scene-motion attempt is MiniMax H3 Ref2VA at 20 steps,
1344x768, 124 frames, with no acceleration LoRA, and every one ends
`execution_interrupted` at `SamplerCustomAdvanced` - MULLET cancelling its own prompt at
the 900 s timeout. Portrait motion on the same lane succeeds consistently at 4 steps,
576x1024, 56 frames with `minimax_h3_fl2v_turbo_4step`.

Root cause is the same defect recorded earlier and not acted on quickly enough: the
accelerated path existed in the codebase (`MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE`,
`minimax_h3_ref2v_turbo_4step`, 4 steps) and was left non-default while the path that
cannot finish was labelled "Default quality".

Shipped in 407a119 and verified in a browser against the served build:
- scene video default -> LightX 4-step
- scene still default -> automatic (Z-Image solo / Qwen references, image lane)
- storage keys bumped so persisted 20-step selections are discarded; without that the
  new default is invisible to any browser that already stored the old one

Process failure to record: f973971 contained the fix and sat committed but undeployed
while a verification run finished. The operator saw an unchanged served build and had to
ask why. Commit-then-verify-then-deploy is the wrong order when the served build is
actively broken; deploy the fix, then verify the deployed build.

Also cleared two orphaned 20-step scene prompts from the video-lane queue by exact prompt
ID (`14569ec6...`, `71a1ca3f...`). They could not complete and were blocking the lane. No
queue-wide interrupt or clear was used; the already-running one was left alone because
reaching it would require a forbidden queue-wide interrupt.

OPEN: whether LightX 4-step actually completes, and at what wall clock. Being measured
now. Tradeoff the operator must decide: LightX renders 960x544 at 16:9 versus the
20-step path's 1344x768. LTX 2.5 is implemented at full 1344x768 and is a candidate for
a better default; not yet measured.
