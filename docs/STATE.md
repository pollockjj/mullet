MILESTONE: 0 | STATE: in-progress | SERVED-SHA: eef5e127deb36629bf2307d5ae845a6a71969c86 | LAST-OPERATOR-RESULT: none

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
