QUEUE-ITEM: 1b (expression loop restored on reload, loop keyed on still bytes) | STATE: candidate-verified, deploying | SERVED-SHA: 903140d772cfabbd0ef63aef520fa7e49f6f022a | LAST-OPERATOR-RESULT: none accepted

Rewrite the line above on every commit. One line. Queue items are defined in docs/GOAL.md.

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
- LTX 2.5 is rejected by the operator on output quality. Not a candidate for any default.
  Scene-motion quality must be recovered inside the H3 family.

## Handoff, session dcc76bda on barracuda

Served: `903140d` (launchd com.pollockjj.mullet, :8781, base /mullet, ORIGIN
https://barracuda.meteor-tegu.ts.net). Rollbacks for every deploy this session are in
`scratch/deploy/rollback-*.plist`. 211 tests pass, 0 type errors, worktree clean.
`github` remote is current; `origin` (Gitea over HTTP) fails on a macOS keychain error
(-61) in a non-interactive session and needs the operator.

Verified working on the served build, in a browser, through the real origin: expression
label -> portrait 576x1024 -> caption -> scene still 1328x752 carrying the caption
verbatim -> scene motion starts. Both ComfyUI lanes busy, no deadlock.

NEXT AGENT (superseded 2026-09-01 by session e2a4b9b0 below): the "OPEN defect 1" this
paragraph pointed at was withdrawn with evidence; start from the session e2a4b9b0 record
and the goal in force. The warning stands: a probe against 127.0.0.1 gets 403 on every
multipart POST because of the ORIGIN mismatch, which looks like a product bug and is not.

## Session e2a4b9b0 (Claude Fable 5.1), 2026-09-01 16:40 CDT onward - state re-verified

Ran the repository browser check against the served build through the real origin before
touching anything:

    node tools/browser-check.mjs --url https://barracuda.meteor-tegu.ts.net/mullet/ \
      --scenario Blake --starter Jenna --generate scene \
      --out scratch/browser-check/fable-served-903140d

Result (`scratch/browser-check/fable-served-903140d/check.json`, `app.png`): ok=true, zero
alerts, zero page errors. Expression `fear`; portrait 576x1024; scene still 1328x752 at
66.2 s after the starter click; scene motion 1024x576, 3.042 s, silent, `readyState 4`,
playing, 82.1 s after the still. Portrait motion still "Animating…" when the check ended
at 151 s (stage [2] is not yet covered by the check).

**OPEN defect 1 from the previous handoff is withdrawn.** The two "unexpected inline-scene
video filename" lines are the last lines of `scratch/mullet.stderr.log`, whose mtime is
10:41:50 CDT; build 8fc36ac was served 10:05-11:18 and its regex only accepted
`scene-motion-loop-flf_` or `scene-motion_`; d853b4e (served 11:18) changed it to
`scene-motion-loop_`. Scene loops 00003-00011 completed on firestorm:8189 between 14:44
and 16:44 and no server-side rejection has been logged since 10:41. The previous agent
reversed its own correct 20:07Z reading of those lines on a `tail -4` with no timestamps.

Observed in the same run, still open:

- The scene still for the check's turn (scene_00067, 16:43:46) was submitted before the
  portrait (16:44:14) and carried no continuity clause. A caption that lands afterwards
  never reaches it: the page-level attempt key (`inlineSceneAttemptKey`, +page.svelte:2072)
  and `inlineSceneMatchesSettings` (+page.svelte:1377) ignore continuity, and
  `subjectDescriptors` is neither a reactive input of the scene reconciliation nor
  persisted. Worse, `castContinuityClause` has no staleness check
  (`subjectDescriptorPortraitKeys` is written at +page.svelte:2613 and never read), so the
  clause that does get injected is the previous portrait's caption for that character,
  and when a fresh caption lands while a scene is generating, the finished scene is
  discarded at commit by the request-key currency check and never retried: no scene and
  no loop for that turn (audit: 6 of 6 such turns on firestorm:8189). The operator's "no
  relation between the images" complaint is therefore still live on the common path.
- Operator's concurrent cabin run (scene_00068, 16:46:54) carried
  "window frame, outdoor background" inside the continuity clause: defect 3 confirmed.
- In-pipeline timings (ComfyUI history, MULLET jobs only, medians): expression still
  Z-Image 4.2 s warm / 13.0 s cold, Qwen 8.4 s warm / 25.6 s cold; expression loop
  48.8 s warm / 66.8 s cold (56 frames); scene still Z-Image 17.5 s cold, Qwen 39-45 s
  cold; scene loop 81.2 s cold and never once warm. Stills wait 39-70 s in the lane FIFO
  when the previous turn's loop is still rendering. Both lanes are single 25 GB cards
  (3090 Ti on 8188, 3090 on 8189) per `/system_stats`; the H3 model plus video VAE alone
  are 26 GB, so every alternation reloads (~18 s H3, ~17 s Qwen, ~9 s Z-Image). No gate in
  docs/GOAL.md is reachable as written; the 5.8 s Qwen figure in docs/PLAN.md is an
  isolation number that never occurs in pipeline order. Measured lever: H3 4-step at
  0.59 MP costs ~5.7 s for the first latent frame and ~14 s per further 17 frames, so
  22 frames is predicted ~20 s warm, 39 frames ~34 s.
- Every page reload regenerates the expression loop: `restoreGeneratedPortraitVideo`
  (+page.svelte:2646) runs once, before portrait capabilities and the scenario catalog
  resolve, so `portraitRequest` is still null, the stored loop is never accepted, and the
  reconciliation submits a fresh 45-90 s H3 loop (seven loop-only jobs with no preceding
  still on firestorm:8188, two of them minutes after the previous agent's "Reload"
  instructions). The still, scene still and scene loop restore from stored bytes. The
  loop key (portrait-video.ts:340-361) also includes prompt ID and timestamps, so a
  byte-identical still (fixed seed per character) costs a new loop every turn.
- The operator was playtesting the cabin scenario on the served build during the check;
  their jobs interleaved with the check's on both lanes.
- The previous session left a candidate server (port 8782, pointed at the shared lanes)
  and three headless Chrome instances from its browser checks running after it ended,
  two started 08:20-08:30 CDT against the candidate and one started 15:09 CDT against
  the served build itself. Their
  pages kept reconciling media against the candidate build, so they submitted loops to
  firestorm:8188/8189 alongside the operator's jobs for about eleven hours; several of the
  39-70 s queue waits and some "loop without a preceding still" history entries come
  from them. Killed at 19:32 CDT this session (agent-created processes only; the served
  launchd service was not touched).

- Foreign traffic on both shared lanes is heavy and unaccounted for in every timing so
  far: at least 277 Qwen-edit jobs from a ComfyUI frontend client on 8189 (18:39-19:16Z
  and 22:00-00:02Z), and a ComfyUI web session on 8188 that re-queued MULLET's own
  portrait-loop graph at 1024x1024 and 73 frames at 18:50-19:02 CDT. The operator appears
  to be probing larger and longer loops directly in ComfyUI. Paired timing runs are valid
  only when `/queue` on the target lane is empty and the predecessor job is recorded.
- Every deploy so far is `launchctl unload`/`load` with no drain: the server has no
  SIGTERM handler, so in-flight portrait, scene and video requests die mid-turn and their
  ComfyUI prompts run on as orphans. This reproduces the operator's "no scene, no
  movement" symptom. Deploy only when no `mullet-*` client is running or pending on
  either lane, or add a drain that cancels MULLET's own prompt IDs first.
- The browser check's `ok` ignores stage failures (still/motion errors and 5xx console
  entries never enter `blocking`) and never waits for the expression loop, so
  `ok=true` is not evidence for stage [2] and only weak evidence for the rest. Both
  checks on 903140d recorded one console 502 of unattributed origin; the caption route
  logs nothing server-side on failure.
- The chain the code implements for stages [3] and [4] is the caption chain the operator
  ordered at 19:57Z (scenario details -> expression prompt -> caption the still -> scene
  prompts) with an FL2VA loop of the scene still; the previous goal text still describes
  the accepted expression still as an image reference and a Ref2VA scene loop with cast
  references. Neither was recorded as a decision. Decision under the goal policy: the
  caption chain is the contract; adding the accepted still as an extra Qwen reference
  slot is a candidate to pair-test, not an assumption.

## Queue items 1 and 1b, session e2a4b9b0

Decision: the browser check is the five-stage loop plus a reload in the same Chrome
profile (`--generate loop`); `ok` is false on any stage error, any 5xx from the app, or any
generation request after reload. The favicon 502 (Tailscale serve on a missing
`/favicon.ico`) is recorded but not blocking; it is the "502 of unknown origin" both
earlier checks showed.

Evidence on the served build 903140d (`scratch/browser-check/loop-903140d/`): all five
stages landed in one run - label 0.3 s, portrait 37.4 s (POST 28.4 s), caption 8.0 s
round trip, portrait loop 114.7 s, scene motion 128.7 s. After reload the portrait image,
scene still and scene loop came back from storage; the portrait loop did not, and a POST
`/api/portrait/video` went out 121 ms after reload. That is the reload-regeneration defect,
now pinned by the check.

Decision: `restoreGeneratedPortraitVideo` no longer counts as an attempt while the loop
request is not derivable; a `portraitVideoRestoreNeeded` flag blocks the reconciliation
until a real restore attempt has run, and a reactive late restore runs once the request
exists. `portraitVideoRequestKey` is keyed on the still's bytes and loop parameters
instead of prompt ID, seed, timestamp and transcript position, so a byte-identical still
(fixed seed per character) reuses its stored loop. Previously stored loops mismatch the
new key once and regenerate.

Evidence on the candidate (`scratch/browser-check/loop-candidate-1b/`, port 8782, same
lanes): after reload the portrait image and loop were restored and zero generation
requests were submitted. The scene still was generated (POST `/api/scene` 200 in 40.4 s,
10.6-51.0 s after the click) but never installed: the caption landed at 34.7 s, inside
that window, so the commit-time currency check discarded the finished scene and nothing
retried. That is queue item 2's defect (stale/racing caption), reproduced by the check
on unchanged scene code; on 903140d the caption happened to land after the scene.
