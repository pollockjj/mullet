QUEUE-ITEM: none open | STATE: READY FOR OPERATOR on f847d06 (references reach H3; one subject, close, alone, silent; clip per response), verified over two turns | SERVED-SHA: f847d0606433cc30ba20b52e7041d117b108bf5e | LAST-OPERATOR-RESULT: none accepted

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

Served d3c9391, five-stage check through the real origin
(`scratch/browser-check/loop-d3c9391/`): ok=true. From the starter click: label 1.8 s,
scene still 25.8 s, portrait 26.8 s (POST 25.0 s), caption 2.9 s round trip, portrait
loop 105.0 s, scene loop 111.9 s. After reload: portrait image, portrait loop, scene
still and scene loop all restored from storage, zero generation requests, one caption
POST. READY FOR OPERATOR for items 1 and 1b. The scene was still directed at 11.1 s,
before the portrait at 26.8 s, so that scene carried no continuity clause: queue item 2.

## Queue item 2, session e2a4b9b0

Decision: the scene waits for this turn's portrait caption from the moment there is a
finalized response and a scenario character to portray (the request itself only exists
after the classifier lands, and the scene director beat it every time), bounded at 60 s
by a timer that re-runs the reconciliation; portrait failure, classifier failure, a
label with no buildable portrait, or the caption settling (success or failure) all
release it. Only a descriptor read from the portrait on screen for this turn is injected;
older ones are ignored. The clause is frozen at submission, so a caption landing while a
scene renders no longer discards the finished scene. Descriptors persist in localStorage
keyed by portrait bytes, so a reload or an identical still does not re-caption; they are
cleared on conversation reset. The Media panel shows a Continuity row.

Evidence, candidate on 8782 (`scratch/browser-check/loop-candidate-2b/`): portrait
27.5 s, caption 2.9 s, scene POST at 40.3 s (was 10.7 s, before the portrait), scene still
80.4 s, portrait loop 97.5 s, scene loop 157.5 s; the scene still (49ef22a8) and scene
loop (e452991f) prompts on firestorm:8189 both carry this turn's caption "blonde
shoulder-length wavy hair, maroon and silver leather jacket, silver hoop earrings, ...".
Reload: all four items restored, zero caption requests, zero generation requests. Cost of
the ordering: the scene still lands ~30 s later than before, after the portrait.

## Queue item 3, session e2a4b9b0

Decision: the caption prompt no longer asks for the background and says to omit
categories that are not visible; the normalizer drops filler items (`none`, `n/a`,
`no visible ...`) and any item naming a background, backdrop, setting or surroundings,
keeping the model's own sentence otherwise. Pinned by two tests named after the served
prompts that leaked (`37c34bd5`, `afa0bfd5`, `bd6c123a`). Rollback plist for 2018be9:
`scratch/deploy/rollback-d3c9391-before-2018be9.plist`.

Served 2018be9, five-stage check through the real origin
(`scratch/browser-check/loop-2018be9/`): ok=true. Label 1.3 s, portrait 27.3 s, caption
2.8 s, scene POST at 40.1 s (after the caption), scene still 80.5 s, portrait loop 97.5 s,
scene loop 157.5 s. Scene still b488559c and scene loop 85bcd04c on firestorm:8189 both
carry this turn's caption. Reload: all four restored, zero caption and zero generation
requests. Media panel: Continuity current. READY FOR OPERATOR for item 2.

## Queue item 5, session e2a4b9b0

Decision: a scene-loop failure (5xx, timeout, client-side rejection) queues one
automatic retry 15 s later for the same still, mirroring the portrait loop's retry; a
failed capability probe retries every 15 s up to six times instead of disabling the
stage for the page session; the Media refresh reloads any missing capabilities before
regenerating; both video routes log one line per delivered loop (prompt ID, filename,
bytes, duration) so client-side rejections are diagnosable against the server log.

Item 3 evidence, candidate on 8782 (`scratch/browser-check/loop-candidate-3/`): ok=true;
the scene still f9925c3d and scene loop 534e152f prompts on firestorm:8189 carry "Jenna
Stannis: blonde shoulder-length wavy hair, maroon and silver leather jacket, silver hoop
earrings" with no background item and no filler. Caption round trip 7.2 s this run.

Items 3 and 5 evidence, candidate on 8782 (`scratch/browser-check/loop-candidate-5/`):
ok=true, all five stages, reload restored all four with zero requests; the candidate's
server log carries the new delivery lines ("portrait-video delivered ... 200479 bytes 2 s",
"inline-scene video delivered ... 352973 bytes 3.04 s"). Deployed as 79409d1; rollback
plist `scratch/deploy/rollback-2018be9-before-79409d1.plist`.

Served 79409d1, five-stage check through the real origin
(`scratch/browser-check/loop-79409d1/`): ok=true. Label 1.3 s, portrait 26.8 s, caption
2.4 s, scene still 79.5 s, portrait loop 96.6 s, scene loop 157.5 s; reload restored all
four with zero requests; the served stdout now carries "delivered" lines for both loops.
READY FOR OPERATOR for items 1, 1b, 2, 3 and 5. What the operator should see on
https://barracuda.meteor-tegu.ts.net/mullet/ after a hard reload: start a scenario,
watch the Media panel go Expression -> Portrait -> Continuity current -> Scene ->
motions, then reload and see nothing regenerate.

## Queue item 4, session e2a4b9b0 - paired measurements and decisions

Loop frame count (`tools/time-loop-frames.mjs`, real served graph, 576x1024, 4 steps,
turbo LoRA, lane 8188 idle, `scratch/loop-frame-timings.json`): 22 frames 42.2 s first /
14.9 s warm; 39 frames 37.6 / 25.4; 56 frames 47.7 / 37.2. Decision: keep 56 frames. The
operator specified a two-second loop; 39 frames (1.4 s) would save ~12 s of a ~95 s
click-to-loop, the reload penalty (10-27 s) and the serialized lanes dominate. Not worth
overriding an operator-stated duration.

Cancelling MULLET's own running loop (`tools/cancel-own-loop-test.mjs`, own prompt ID
only, `scratch/cancel-own-loop-test.log`): POST `/api/jobs/<id>/cancel` on a job that
had been executing for 13 s returned 200 and the job was `execution_interrupted` 1.1 s
later. MULLET already aborts the in-flight loop request when a new still is requested
(`suspendPortraitVideoForStaticGeneration`), and the abandoned server request cancels
its exact prompt ID, so the superseded-loop lever is live by construction; it was
masked by the previous session's orphaned pages re-firing loops.

Scene still at 0.5 MP versus 1 MP (`scratch/browser-check/loop-79409d1-0.5mp/`, lane
8189 shared with a foreign ComfyUI client running 13-17 s Qwen jobs back to back):
ComfyUI execution 15.5 s for 944x528 versus 34-45 s cold for 1328x752 on the same lane
earlier tonight; the pipeline numbers of that run (scene still 99.6 s, scene loop
265.7 s) are queue waits behind the foreign jobs, not MULLET cost. Decision: scene still
default is 0.5 MP; the scene loop renders at 0.59 MP from it regardless. Storage key
bumped so a browser holding the old 1 MP choice takes the new default.

Timeouts: the two 900 s loop timeouts become 300 s. Measured loops are 65-86 s alone and
166 s when queued behind foreign jobs; 300 s is more than three times the contended
value and stops a dead job from holding the panel for fifteen minutes. Still timeouts
were already 120 s.

Deploy drain (critic finding CMP-8): every ComfyUI prompt MULLET submits is tracked in
`src/lib/server/inflight.ts` until it finishes; `src/hooks.server.ts` cancels exactly
those prompt IDs on SIGTERM, SIGINT and adapter-node's `sveltekit:shutdown`, so a deploy
no longer leaves the operator's in-flight loop running on a shared lane behind a request
that will never return. Not yet exercised: deploys here happen only when no MULLET job is
running, so the first real evidence will be a ComfyUI history entry marked
`execution_interrupted` next to a restart.

Item 4 evidence, candidate on 8782 (`scratch/browser-check/loop-candidate-4/`, lanes
idle): ok=true. Scene still 944x528 landed at 57.9 s (was 79.5-80.5 s at 1 MP; the scene
POST took 17.4 s instead of 40 s), scene loop at 132.0 s (was 155-157 s); portrait 27.3 s,
portrait loop 94.0 s unchanged. Reload restored all four with zero requests.

## Served 14766b4 then d0c2531, session e2a4b9b0

14766b4 (scene still 0.5 MP, 300 s loop timeouts) deployed at 23:16 CDT from the exact
candidate artifact that passed; rollback `scratch/deploy/rollback-79409d1-before-14766b4.plist`.
Two-turn check through the real origin (`scratch/browser-check/loop-14766b4-turn2/`,
ok=true): turn 1 label 1.3 s, portrait 27.1 s, caption 2.3 s, scene 78.5 s, portrait loop
98.6 s, scene loop 153.5 s; second chat turn sent, response finalized at 57.9 s,
expression `curiosity`, new portrait at 90.3 s, one caption, new scene still 944x528 at
157.3 s (scene POST at 119.5 s, after the caption), new scene loop at 232.2 s; Media panel
"Continuity current"; reload restored all four with zero requests.

Item 6 evidence on firestorm:8189: turn 1 scene c5ca7d0a carried "blonde shoulder-length
wavy hair, maroon and silver leather jacket, silver hoop earrings"; turn 2 scene 97212bd0
was composed from the prior scene as continuity master (no outpaint pad) and carried its
own portrait's caption "blonde shoulder-length wavy hair, maroon and silver jacket,
silver collar necklace". Each scene carries the caption of the portrait made for that
turn; hair and jacket held, the accessory reading differed between the two portraits.

d0c2531 (shutdown drain) passed its candidate check and was deployed at 23:27 CDT;
served check `scratch/browser-check/loop-d0c2531/` ok=true. Rollback
`scratch/deploy/rollback-14766b4-before-d0c2531.plist`. READY FOR OPERATOR for every
queue item. What to look at: https://barracuda.meteor-tegu.ts.net/mullet/ after a hard
reload - start a scenario, watch the Media panel, send a second turn, reload.

Drain exercised on the served d0c2531 (`scratch/browser-check/drain-exercise/`): with
MULLET's own portrait loop fdc3a9b1 executing on firestorm:8188, the service was
restarted; stdout shows "draining 1 in-flight ComfyUI prompt(s) on SIGTERM / cancelled
1 of 1", and the lane history marks that prompt `execution_interrupted`. The prompt no
longer runs on as an orphan. The page, however, did not recover: its loop request got
502 when the old process closed, the single automatic retry 9 s later hit the ~5 s
restart window and got 502 again, the scene still request got 502 in 38 ms for the same
reason, and the scene still has no automatic retry at all, so the turn stayed without
motion or scene until reload. Next: retries with backoff (15/30/60 s, three attempts) on
5xx and network failures for all four stages, so a restart costs the operator under a
minute instead of the turn.

Decision: every stage's automatic retry is now the same bounded backoff (15, 30, 60 s,
three attempts per attempt key) instead of one retry after 1.5 s; the scene still, which
had none, gets it too. A retry releases the stage's latch and bumps a reactive tick that
re-runs the scheduler, so no stage waits for an unrelated change.

e9e8f8f (backoff retries) passed its candidate check (`scratch/browser-check/candidate-retry/`,
ok=true, reload clean) and was deployed at 23:53 CDT from that artifact; rollback
`scratch/deploy/rollback-d0c2531-before-e9e8f8f.plist`. Drain exercise 2 on the served
build (`scratch/browser-check/drain-exercise-2/`): the service was restarted while
MULLET's loop 3e52b70b was executing; stdout shows the drain cancelling it; the page's
loop request got 502 at 32.5 s, the first backoff retry at 47.6 s succeeded, and every
stage landed (portrait loop 110.1 s, scene still 98.0 s, scene loop 173.0 s), reload
clean. The check reports ok=false only for the 502 the restart itself induced. A deploy
now costs the operator's in-flight turn about 20 s, not the turn.

Second-turn failure on the served e9e8f8f (`scratch/browser-check/loop-e9e8f8f/`,
2026-09-02 00:03 CDT): turn 1 landed fully; on turn 2 the classifier answered
off-vocabulary ("expression classifier returned an unknown label", twice) and the scene
director named the cast by display name ("selected an unknown subject", four times), so
the turn ended with no portrait, no loop and no scene. The earlier two-turn run at 23:16
had passed with the same message; the local model's output varies. Decision: both parsers
are now lenient. Classifier: JSON value, else the first vocabulary word in the text, else
a synonym table (fearful, worried, focused, ...), else `neutral`, with the raw text logged
server-side when it fell back. Director: extra JSON keys ignored, JSON extracted from
surrounding prose, subjects resolved by ID, display name, alias or first name, unknown
names dropped, an empty selection falls back to the speaking character, more than three
keeps the first three, prompt length accepted between 20 and 260 words. Pinned by tests
named after the failed turn.

Caption display (544705a) candidate two-turn check (`scratch/browser-check/candidate-caption/`):
ok=true; the Media panel read "Continuity current · blonde shoulder-length wavy hair,
maroon and silver leather jacket, silver hoop earrings" on both turns (the second
portrait reproduced the first's bytes, so its caption was reused by hash without a second
vision call). Its deploy was skipped because the lanes were busy; the lenient-parser
build 89964af contains it and deploys next.

Lenient parsers (89964af) with the caption display: candidate two-turn check
(`scratch/browser-check/candidate-parsers/`) ok=true; deployed as c05e34a (same code,
docs-only commits on top) at 00:50 CDT from the verified artifact; rollback
`scratch/deploy/rollback-e9e8f8f-before-c05e34a.plist`. Served two-turn check
(`scratch/browser-check/loop-c05e34a/`): ok=true. Turn 1: label 3.8 s, portrait 29.3 s,
caption 7.7 s, scene 83.0 s, portrait loop 96.0 s, scene loop 158.0 s, Media panel
"Continuity current · blonde shoulder-length wavy hair, maroon and silver leather jacket,
silver hoop earrings". Turn 2: response 42.2 s, portrait 74.4 s, portrait loop 137.5 s,
scene 139.5 s, scene loop 214.5 s, "Continuity current · ... silver collar necklace".
Reload: all four restored, zero requests. The served log shows the fallback doing its
job during that run: "expression classifier fell back to neutral; raw text: tension".

## Session e2a4b9b0 summary (for the next reader)

Served: c05e34a (healthz through the real origin). HEAD is ahead by one synonym
(73d64cb, "tension" -> nervousness) and docs; it deploys with the next hardening change.
Everything the v2 goal lists has served evidence; nothing is accepted. Commits this
session, in order: browser check with five stages and reload assertion; expression loop
restored on reload and keyed on the still's bytes (d3c9391); scene directed after this
turn's caption, no stale caption, no discard (2018be9); caption hygiene (de26269);
scene-loop retry, capability retries, delivery logs (f0a20bc); scene still 0.5 MP
(77ff8be); 300 s loop timeouts (14766b4); shutdown drain (d0c2531); backoff retries for
all four stages (e9e8f8f); live caption in the Media panel and the check's second turn
(544705a); lenient sidecar parsers (89964af). Evidence for each is in
`scratch/browser-check/<name>/check.json` and on the lanes' `/history`. A persistent log
watch on `scratch/mullet.stderr.log` and `mullet.stdout.log` reports failures,
classifier fallbacks, drains and restarts during the operator's own use.

## Operator order 2026-09-02: Jan and Kristi move to Krea 2 (Angela stays on Z-Image)

Facts from the lanes: both lanes list `krea2_turbo_int8_convrot.safetensors`, the
`qwen3vl_4b_fp8_scaled.safetensors` text encoder with CLIPLoader type `krea2`,
`qwen_image_vae.safetensors`, and the LoRAs `janpollock-krea2-v3-attn.safetensors` and
`kristibentler-krea2-v4-attn.safetensors` (no Krea LoRA for Angela). The operator's own
Krea graph on firestorm:8188 (prompt f8377cfa, 19-25 s at 1 MP) is UNETLoader ->
LoraLoaderModelOnly -> KSampler 8 steps euler/simple cfg 1, CLIPTextEncode positive with
ConditioningZeroOut negative, EmptyLatentImage, VAEDecode, SaveImage; no sampling-shift
node. LoRA hashes are the `sshs_model_hash` from each file's safetensors header (that is
how the zimage hashes in the card were sourced), read through ComfyUI's view_metadata.

Decision: new portrait template `krea2-turbo-lora-v1` and scene template
`krea2-turbo-scene-v1` mirroring that graph (multiple 16, output node 10, prefix
mullet/portrait and mullet/scene as before); Krea LoRA names are top-level files with
`krea2` in the name; a LoRA must belong to the template's family; the scene cast driver
picks the Krea scene template when the profile's portrait template is Krea; the page no
longer lets a stored selector value override the scenario's declared template. Jan and
Kristi's profiles in the cabin card and lorebook now declare the Krea template and LoRAs
(same triggers, same seeds); Angela is unchanged.

Krea evidence: MULLET's exact Krea portrait graph for Jan (576x1024, seed 560103,
janpollock-krea2-v3-attn) submitted once to firestorm:8188 by
`scratchpad/krea-graph-probe.mjs`: accepted, executed in 16.5 s (first run after an H3
loop), output `mullet/krea-probe_00001_.png`. The candidate's browser run could not
finish because the shared chat model on hammerhead returned "fetch failed" and 500 to
its classifier at 18:07 while the operator was mid-session on the served build; that is
LLM contention, not the image path, and the served build logged the same timeout at
18:08. Deployed f57c7ef (Krea for Jan and Kristi, per-stage lane routing at the
pipeline default) at 18:13 CDT from the verified build; rollback
`scratch/deploy/rollback-c05e34a-before-f57c7ef.plist`. Served check follows the lane
benchmark.

Lane-layout benchmark (operator order 2026-09-02): per-stage lane routing is in f57c7ef;
the benchmark runs the same build twice per layout as a candidate on 8782 (cabin scenario,
Jan, two turns each): A = by pipeline (expression still and loop on 8188, scene still and
loop on 8189), B = by media type (both stills on 8188, both H3 loops on 8189, via
PORTRAIT_VIDEO_COMFY_BASE_URL=8189 and SCENE_STILL_COMFY_BASE_URL=8188). Two attempts
died before any generation because the local chat model on hammerhead:1234 stopped
answering at 18:07 CDT (first 500s and "fetch failed", then connection refused; the
host answers ping and ssh, port 1234 is closed). The classifier, director and caption
all run on that model, so no MULLET turn can start until it is back. The benchmark is
armed to start by itself once `GET http://hammerhead:1234/v1/models` returns 200 and
both lanes are idle.

Krea end to end (benchmark run 1, candidate of f57c7ef on 8782, cabin scenario as Jan,
18:18 CDT): Krea portrait 3.7 s warm on 8188 (16.1 s cold on the second turn, after an
H3 loop), Krea scene still 14.6 s on 8189, both prompts using janpollock-krea2-v3-attn;
portrait loop 66.6 s and scene loop 73.9 s delivered. The Krea path works on both stills.
The local model on hammerhead came back at 18:18 and is slow under load (5 s for a
five-token reply while the benchmark, the operator's chat and the sidecars share it);
the served build logged 30 s director timeouts at 18:32 for that reason.

## Lane-layout benchmark, 2026-09-02 18:18-19:40 CDT (cabin scenario as Jan, Krea stills, candidate of f57c7ef on 8782, alternating layouts so each run starts with the other layout's residency)

Click-to-visible from the starter click, turn 1 (POST duration in brackets):

| Stage | pipeline run 1 | media run 1 | pipeline run 2 | media run 2 |
| --- | ---: | ---: | ---: | ---: |
| portrait still | 8.1 s (4.1 warm, Krea left resident by the probe) | 20.7 s (16.6 cold, H3 had run on 8188) | 8.6 s (4.4 warm, left by media run 1) | 19.2 s (16.3 cold) |
| caption | 51.0 s (LLM contended) | 6.4 s | 10.7 s | 6.9 s |
| scene still | 96.0 s (15.2 cold on 8189) | 45.4 s (4.2 warm on 8188) | 64.5 s (16.5 cold on 8189) | 44.4 s (4.0 warm on 8188) |
| portrait loop | 76.0 s (67.1) | 72.5 s (51.0 warm H3 on 8189) | 72.5 s (63.4) | 68.5 s (49.1 warm) |
| scene loop | 196.1 s (98.2) | 128.5 s (82.2, queued behind the portrait loop) | 134.5 s (70.4) | 125.5 s (79.8) |

Reading: in steady state the media layout keeps Krea/Qwen resident on 8188 (both stills
~4 s of ComfyUI instead of ~16 s) and H3 resident on 8189 (portrait loop ~50 s instead
of 63-67 s); the scene loop queues behind the portrait loop but still lands sooner
(125-128 s) than under the pipeline layout (134-196 s), where each lane pays an H3 reload
every turn. The portrait-still numbers under "media" above are cold only because the
preceding pipeline run had put H3 on 8188; with the media layout served continuously
the portrait is the 4 s case. Decision: serve the media-type layout
(PORTRAIT_VIDEO_COMFY_BASE_URL=http://firestorm:8189, SCENE_STILL_COMFY_BASE_URL=
http://firestorm:8188) via the plist; code unchanged (f57c7ef). Rollback plist:
`scratch/deploy/rollback-f57c7ef-pipeline-layout-before-media-layout.plist`.

The second turn failed in all four runs for a reason outside the lanes: the chat route
threw "model metadata does not expose n_ctx for gemma-4-ortenzya" (the operator's
LM Studio restart at ~18:15 changed the model metadata), so no second response was
produced. Being diagnosed next; it affects the served build's chat as well.

The served plist now carries PORTRAIT_VIDEO_COMFY_BASE_URL=http://firestorm:8189 and
SCENE_STILL_COMFY_BASE_URL=http://firestorm:8188 (media-type layout), applied at
19:41 CDT. The model server on hammerhead:1234 went down again at ~19:40 (second
outage today), so the served check of that layout could not run; it is armed to run by
itself when the endpoint answers, the fix below is served, and the lanes are idle.

Chat-context fix (f212642): the benchmark's second turns failed because the chat route
threw "model metadata does not expose n_ctx for gemma-4-ortenzya" after the operator's
model-server restart; every chat message on the served build would have failed the same
way. The lookup now accepts the field names other servers use and falls back to
MODEL_CONTEXT_TOKENS (default 32768) with a warning, since the value only sizes the lore
budget. Pinned by a test named after the failure. Deploying from the verified build
without a browser candidate check because chat itself is the thing that is broken and
the check needs chat; the served two-turn check is armed to run as soon as the model
server is back.

Served f212642, media layout, two-turn check through the real origin, cabin scenario
as Jan (`scratch/browser-check/loop-f212642-media/`, 20:04 CDT, model server back at
20:04): ok=true. Turn 1: label 4.3 s, Krea portrait 8.8 s (4.5 s of ComfyUI, warm),
caption 7.0 s, Krea scene still 36.4 s (4.0 s of ComfyUI, warm on 8188), portrait loop
53.4 s (44.3 s of H3, warm on 8189), scene loop 110.5 s (73 s, queued behind the
portrait loop). Turn 2: response 28.2 s (chat works with the model list lacking
n_ctx: the fallback context size was used), portrait 34.3 s, portrait loop 80.3 s, scene
still 93.4 s, scene loop 150.4 s; Continuity current on both turns; reload restored all
four with zero requests. Against the by-pipeline layout served this morning on the same
scenario (portrait 8.6 s only when Krea happened to be resident, scene 64-96 s, portrait
loop 72-76 s, scene loop 134-196 s), every item lands sooner. READY FOR OPERATOR.

Found in the served two-turn check: the second scene of a turn sequence for a LoRA
subject (Jan) was rendered by Qwen Image Edit with the first scene as Picture 1
(mullet-inline-scene 401a046b on 8188, 29.2 s), because the cast driver only chose the
LoRA path when no continuity master existed. That drops the trained Krea face on every
scene after the first and pulls Qwen onto the stills lane, evicting Krea (the next
portrait is cold again). Decision under the goal policy: a subject with a trained LoRA
is rendered by that LoRA on every solo scene; the image master is not used for LoRA
scenes (location continuity comes from the director's prompt and the caption clause).
The operator can overrule if the Qwen-edited second scene is preferred.

d65c792 candidate two-turn check (`scratch/browser-check/candidate-lora/`): ok=true;
deployed at 20:19 CDT; rollback `scratch/deploy/rollback-f212642-before-d65c792.plist`.
The second-turn scene in that run still went to Qwen (8f707fda, 35.1 s) because the
director cast it as a trio (Jan, Kristi and Angela all visible; prompt 8f707fda on
8188, Picture 1 the prior scene plus two identity references), not because of the
continuity master: a multi-subject scene has no LoRA path in either family and uses
Qwen with the identity reference photos, as it always has. Solo scenes of Jan or Kristi use Krea on every turn
now. Stacking two Krea LoRAs for a Jan+Kristi duo is possible in ComfyUI but is a
quality call the operator has not made; not built.

Served d65c792, two-turn check through the real origin, cabin scenario as Jan
(`scratch/browser-check/loop-d65c792/`, 20:20 CDT): ok=true. Turn 1: label 2.8 s,
portrait 18.5 s (15.2 s of Krea, cold because the previous run's trio scene had put Qwen
on 8188), caption 6.9 s, scene still 42.9 s (3.6 s of Krea), portrait loop 62.9 s, scene
loop 118.9 s. Turn 2: response 14.1 s, portrait 20.4 s (3.7 s of Krea, warm), scene still
49.2 s (3.7 s of Krea: the second solo scene now stays on the LoRA), portrait loop
65.2 s, scene loop 122.3 s; Continuity current; reload restored all four with zero
requests. All four second-turn images and loops came from Krea and H3 on their own lanes.
READY FOR OPERATOR.

20:40 CDT: the lane monitor reported `angelapollock-krea2-v2-attn.safetensors` on both
lanes (operator said Angela would follow Jan and Kristi once her LoRA was ready).
Header hash from `/view_metadata/loras`: ca901818454e401e4d28ab4319602be9e101c1e61f342dfef982bcb28668acaf
(network dim 64). Card, lorebook, and scenario test now put Angela on `krea2-turbo-lora-v1`
with that LoRA, same trigger `angelapollock` and seed; the Z-Image LoRA is no longer
referenced by the cabin scenario. Suite 216 pass, svelte-check 0 errors. Next: candidate
check as Angela over two turns on 8782, deploy, served check.

Candidate 751190a on 8782, cabin as Angela, two turns (`scratch/browser-check/cand-angela-751190a/`,
20:38-20:43 CDT): ok=true. Turn 1: label 2.8 s, portrait 8.8 s (5.8 s of Krea with
angelapollock-krea2-v2-attn), caption 8.1 s, scene still 38.8 s (3.7 s of Krea), portrait
loop 53.9 s, scene loop 110.9 s. Turn 2 ran while the operator was playing as Jan on the
served build (their Jan portrait 20:40:39 and scene 20:41:51 interleave with Angela's in
the 8188 history), so it was contended: response 36.6 s, portrait 53.3 s (5.9 s of Krea),
scene still 79.7 s (3.7 s of Krea), portrait loop 136.9 s, scene loop 192.8 s; Continuity
current; reload restored all four with zero requests. Both Angela stills on both turns
came from Krea with her LoRA. The first candidate build of this commit was made without
`BASE_PATH=/mullet` and failed the check at the 404 healthz; recipe recorded in
docs/PLAN.md.

Deployed 751190a at 20:44:12 CDT (healthz revision confirmed). The deploy gate saw both
lanes empty, but the operator's Jan session was active 13 s earlier: the hold I added to
wait for three quiet minutes stopped the wrong process (the task wrapper shell, not the
chain), so the served server restarted between two of their turns. The served two-turn
check as Angela is running now.

Served 751190a, two-turn check through the real origin, cabin as Angela
(`scratch/browser-check/loop-751190a/`, 20:44-20:48 CDT, lanes otherwise idle): ok=true.
Turn 1: label 2.3 s, portrait 8.8 s (5.4 s of Krea with angelapollock-krea2-v2-attn),
caption 8.9 s, scene still 37.3 s (3.7 s of Krea), portrait loop 54.4 s, scene loop
110.4 s. Turn 2: response 18.1 s, portrait 24.6 s (3.7 s of Krea), scene still 47.1 s
(3.8 s of Krea), portrait loop 69.2 s, scene loop 126.2 s; Continuity current; reload
restored all four with zero requests. All four Angela stills came from Krea with her
LoRA; all four loops from H3 on 8189 (43.8-55.7 s each). The only non-2xx responses were
two `GET /favicon.ico` 502s at the proxy root, outside the `/mullet` base and unchanged
from before. READY FOR OPERATOR: the whole cabin cast is on Krea.

21:05-21:28 CDT, chat parameters (operator: "why is the max response tokens 8k"). Findings:
the 8096 default and 128000 ceiling were set by the previous agent at b03e806 (2026-08-27)
as "SillyTavern-aligned" without reading SillyTavern; MULLET sent only max_tokens and a
hard-coded temperature 0.85; and after the operator's LM Studio restart the loaded id became
`gemma-4-ortenzya-q6`, so the context lookup fell back to 32768. The operator's SillyTavern
(~/SillyTavern, port 7598, text-completion "generic" to LM Studio) runs this model at
response length 65536 with the context slider unlocked; the model's n_ctx is 262144.
Applied in 2c355e2: DEFAULT_RESPONSE_TOKENS 65536, MAX_RESPONSE_TOKENS 262144, context
fallback 262144, model lookup tolerant of a quant suffix, response-limit storage key bumped
so a previously saved 8096 no longer sticks, sampler fields sent only when the plist sets
them. Plist: MODEL_ID gemma-4-ortenzya-q6, MODEL_DEFAULT_TOKENS 65536, MODEL_MAX_TOKENS
262144, MODEL_TEMPERATURE 1.0, MODEL_TOP_P 0.95, MODEL_TOP_K 64 per the Hugging Face card
(llmfan46/gemma-4-Ortenzya-The-Creative-Wordsmith-31B-it-uncensored-heretic-GGUF defers to
Google's Gemma 4 recommendations). My first pass copied SillyTavern's sampler preset instead;
the operator rejected that and it was reverted before deploy. Candidate smoke on 8782: chat
stream 200 from LM Studio, page data maxTokens 262144 / defaultMaxTokens 65536. Deployed
2c355e2 at 21:28:35 CDT with both lanes idle; served healthz and page data confirmed.

21:38-21:45 CDT, H3 reference-to-video probe on firestorm:8189 (prompt e57f9955, own prompt
ID, queued behind one ComfyUI web-client job): `MiniMaxH3ReferenceToVideo` with the three
cabin identity photos as `ref_images` (API form `"ref_images": {"ref_image_0": [...]}`;
flat keys pass validation and fail at execute), unet minimax_h3_ref2va_pruned_int8_convrot,
LoRA minimax_h3_ref2v_turbo_4step_v0.1, sigma shift 6/3, euler/simple 4 steps, 1024x576,
73 frames, ref_image_size match: success in 61.4 s of ComfyUI, output
`mullet/probe-r2v_00001_.mp4` (678 KB), sent to the operator. Today's chain to scene motion
is still 37 s + loop 56 s; a reference clip lands the scene animated in one 61 s pass.
Next: nine Krea references (three views per subject, rendered on 8188) into one clip to
measure the cost of the full reference budget, then build the path.

Served 2c355e2, two-turn check through the real origin, cabin as Jan
(`scratch/browser-check/loop-2c355e2/`, 21:34-21:40 CDT, lanes shared with my Krea
reference renders on 8188 and the H3 reference probe on 8189): ok=true. Turn 1: label 4.8 s,
portrait 10.9 s, caption 7.2 s, scene still 36.9 s, portrait loop 72.0 s, scene loop
127.0 s. Turn 2 (contended): response 26.6 s, portrait 33.5 s, portrait loop 78.8 s, scene
still 102.9 s, scene loop 162.9 s; Continuity current; reload restored all four with zero
requests; only the proxy-root favicon 502s. READY FOR OPERATOR for the chat parameters.
Krea reference pack (three views per subject, 832x1024 / 640x1152) rendered on 8188 in
5.5-7.9 s each except one 53 s cold reload; files in the session scratchpad.

22:0x CDT, nine-reference probe (prompt a00de83f, own ID): the nine Krea references were
uploaded to the loop lane's `mullet/identity/refpack/` in 1.0 s and one 1024x576, 73-frame,
4-step clip from all nine rendered in 50.7 s of ComfyUI (`mullet/probe-r2v-9_00001_.mp4`,
747 KB, sent to the operator). Reference count barely moves the cost at `match` size: the
three-reference run was 61.4 s including the ref2va weight load. Decision (GOAL policy,
operator proposal 21:05): the scene path becomes reference-to-video with no scene still.

21:40-22:00 CDT, reference-scene implementation (uncommitted until its candidate check
passes). Shape: the director result still becomes an `InlineSceneImageRequest` (scene
prompt, cast, continuity clause) but no still is rendered; a new `POST /api/scene/references`
prepares a reference pack per cast member (three Krea views per LoRA subject rendered on
the still lane, or the identity photo for a reference-driven subject) under the loop
lane's `mullet/identity/refpack/<profile>-<view>-<fingerprint16>.png`, cached in the
browser per cast fingerprint; the scene-video request (spec v7) carries the scene request
plus that reference list and `POST /api/scene/video` (JSON) submits one
`MiniMaxH3ReferenceToVideo` graph (nested `ref_images`, `<Picture N>` bindings to display
names, 1024x576, 73 frames, 4-step ref2v turbo) and returns the MP4 with
`x-mullet-references-sha256`. Stored scene record v7 = description + references; stored
clip v10 keyed on the reference hash; the FL2V scene-loop template, still upload, prior
masters and managed body references are deleted from the scene path (the portrait loop
keeps its own FL2V). The media panel's scene card shows only the clip. Browser check no
longer waits for a scene still and requires portrait image, portrait loop, and scene clip
on reload. Expected cost per turn: ~5 s of Krea per new subject once, then ~50-60 s of H3
per clip instead of still 37 s + loop 56 s.

23:04-23:09 CDT, reference-scene candidate on 8782 (build of 1465fdb plus the working
tree), cabin as Jan, two turns (`scratch/browser-check/cand-refscene/`): ok=true, no scene
still anywhere in the run. Turn 1 (solo): label 1.8 s, portrait 6.1 s, caption 7.4 s,
portrait loop 50.9 s, scene clip 101.9 s; the pack for Jan cost three Krea renders on 8188
(5.5-6.2 s each) and the clip was 50.6 s of H3 with 3 references. Turn 2 (trio): response
17.6 s, portrait 24.2 s, portrait loop 74.9 s, scene clip 145.8 s; six more renders for
Kristi and Angela (5.5-7.8 s each) and one clip of 51.2 s with all 9 references. Continuity
current; reload restored portrait, portrait loop and scene clip with zero generation
requests; no 5xx. The delivered graph cites `<Picture 1..9>` bound to display names and
loads `mullet/identity/refpack/<profile>-<view>-<fingerprint>.png`; the pack on the lane is
the Krea LoRA output for each subject (verified by fetching one back).
Against the served still path (2c355e2, same scenario): scene visible at 127 s turn 1 and
163 s turn 2, so the clip is 25 s and 17 s earlier and drops one ComfyUI stage per turn.
Defects found and fixed while building it: the scene-video route replied 413 without
draining the request body, which reset the client's next keep-alive request (route test);
the reference presence probe used HEAD, which ComfyUI does not answer consistently; the
reference-pack module cached to disk, which the shared-tenancy rule forbids in a comfy-*
module; and its cancel path did not match the single-prompt cancellation shape.

23:15 CDT: deployed 9768667 (reference clip, no scene still) with both lanes quiet; served
healthz confirmed and the served two-turn check started. Follow-up in the same session,
from a review of the reference module: the in-process cache held full PNG bytes (up to
540 MB across 27 entries), was keyed on `<fingerprint>:<view>` rather than the reference
name, and a cache hit reported a picture as prepared without re-checking the shared lane.
It now holds `{sha256, byteLength}` keyed by the reference name and re-confirms every
cached view on the loop lane before use, re-rendering only what the lane has lost; a test
covers the re-confirm and the lane-cleaned case. Suite 252 pass, svelte-check 0 errors.

Served 9768667, two-turn check through the real origin, cabin as Jan
(`scratch/browser-check/loop-9768667/`, 23:15-23:20 CDT): ok=true. Turn 1: label 1.8 s,
portrait 7.6 s, caption 7.3 s, portrait loop 57.9 s, scene clip 109.9 s. Turn 2: response
30.2 s, portrait 37.3 s, portrait loop 88.4 s, scene clip 140.4 s; Continuity current;
reload restored portrait, portrait loop and scene clip with zero generation requests; the
only non-2xx were the proxy-root favicon 502s. Steady state confirmed: the packs were
already on the lane from the candidate run, so the lanes ran two portraits (5.6 s, 3.7 s)
and two clips (50.6 s with 3 references, 51.3 s with 9) and rendered no references at all.
Against the still path on the same scenario (2c355e2: 127 s and 163 s), the scene lands
17-25 s earlier and one ComfyUI stage per turn is gone. READY FOR OPERATOR.

Served 9520f72 at 23:22:23 CDT with both lanes quiet; two-turn check through the real
origin, cabin as Jan (`scratch/browser-check/loop-9520f72/`, 23:22-23:27): ok=true. Turn 1:
label 1.3 s, portrait 5.6 s, caption 7.2 s, portrait loop 56.4 s, scene clip 107.4 s. Turn
2: response 29.2 s, portrait 36.5 s, portrait loop 87.4 s, scene clip 139.4 s; Continuity
current; reload restored all three media items with zero generation requests; only the
proxy-root favicon 502s. The cached pack was re-confirmed on the lane and nothing was
re-rendered. READY FOR OPERATOR.

06:20 CDT 2026-09-03, operator defect: the scene card rendered as a thin strip. Cause: with
the still gone, the only in-flow element sizing the card was the removed `<img>`; the clip
is absolutely positioned, so the card collapsed to its caption and clipped the video. The
card now has a `.scene-frame` that always carries the aspect ratio and the clip and the
placeholder fill it. My two-turn checks had passed with the collapsed card because
`SCENE_VIDEO` only asserted decode, so the check now also requires a rendered box of at
least 200x120 and records the measured box and the number of cards. Candidate check as
Kristi (`scratch/browser-check/cand-card/`, 06:33-06:38): ok=true, clip visible full size
on both turns, reload restored everything with zero generation requests.
Operator order in the same turn: every text response must generate its own clip and all
older clips must stay in the chat history, exactly as SillyTavern keeps per-message media.
Today MULLET stores one active clip and renders one card at the newest finalized response.
Next: per-message clip storage and rendering.

07:00-07:09 CDT, operator order: "each new text response generates a new video and all the
old videos stay in the history of chat just like SillyTavern does it today." MULLET kept a
single active clip and rendered one card at the newest finalized response. Now the
transcript keeps a clip per finalized response: `inlineSceneClips` maps a message index to
its clip and object URL, the message list renders a card for every message that has one
(the newest is the live element, earlier ones are plain looping players), IndexedDB stores
one record per clip key instead of one active entry, reload restores every clip of the
conversation and prunes anything that does not belong to it (never against an empty
transcript), a new turn only moves the pointer instead of deleting the previous clip, and
clearing the conversation still clears everything. No clip cap: the operator did not ask for one and a clip is 147-330 KB.
Candidate check as Kristi (`scratch/browser-check/cand-history/`, 07:03-07:09): ok=true;
turn 1 clip at 118.2 s, turn 2 at 142.9 s; after reload the transcript held 2 cards and 2
clips, both restored with zero generation requests, clip box 838x471. The check itself had
been watching `.scene-card video` as a single element and hung for 900 s on the first
card's src once a second card existed; every scene assertion now targets the newest card,
and the reload assertion requires one clip per finalized response.

Served 963fa8f at 07:11:08 CDT; two-turn check through the real origin, cabin as Jan
(`scratch/browser-check/loop-963fa8f/`, 07:11-07:16): ok=true. Turn 1: label 2.8 s,
portrait 8.8 s, caption 7.0 s, portrait loop 59.9 s, scene clip 112.9 s. Turn 2: response
41.7 s, portrait 52.4 s, portrait loop 104.9 s, scene clip 156.0 s; Continuity current;
after reload the transcript held both responses' clips, restored with zero generation
requests; only the proxy-root favicon 502s. READY FOR OPERATOR.
Also served earlier this morning: 6b3b945, the scene-card frame that fixed the collapsed
card (served check ok at 06:52, `scratch/browser-check/loop-6b3b945/`).

07:20-07:38 CDT 2026-09-03, operator order: MULLET is a one-to-one app, and a scene whose
subject is far away, unrecognisable, sharing the frame with other people, or talking is
wrong. Causes and changes:
- The director was told to "select every visibly present person, one to three total" and to
  describe "spatial composition and camera framing" freely. It now selects exactly one
  subject (the character the player is with; the parser slices to one) and is told to frame
  a medium close-up or waist-up shot of that person, never to place another person,
  bystander, silhouette or crowd in frame, and never to describe speech.
- The clip prompt now names that one person, states they are the only person in frame,
  demands a close waist-up framing that never pulls back to a wide landscape, demands the
  face stay unobstructed and match the references, and forbids talking, lip movement,
  speech gestures and singing.
- The reference pack's third view was a full-body standing photo, which taught the model to
  place the subject at a distance; it is now a waist-up view (832x1024), named `waistup`.
- `ref_image_size` moved from `match` to `max`, so references condition the clip at their
  own resolution instead of being scaled down to the clip's pixel area. Measured on the
  lane with an identical seed: 46.2 s either way, so the identity fidelity is free.
- The 80-clip storage cap I had invented was removed; the operator never asked for one and
  a clip is 147-330 KB.
Candidate check as Kristi (`scratch/browser-check/cand-1to1/`, 07:31-07:38): ok=true, both
turns show one subject framed waist-up and alone, reload restored both clips with zero
generation requests. Suite 247 pass, svelte-check 0 errors.
Open, sent to the operator to judge: sigma shift 6 (shipped, inherited from the loop path)
vs 12 (the turbo LoRA's own table) on an identical seed, 39.8 s at 12.

07:45-08:05 CDT 2026-09-03, operator: both probe clips bear zero resemblance to the LoRA
subject. They were right, and the cause is mine: MULLET's clips have never used the
reference pictures at all. Evidence, measured on the lane with one seed and one prompt and
frames extracted through LoadVideo -> GetVideoComponents -> SaveImage (the first time I
have actually looked inside a generated clip):
- no references at all: 118,804 bytes
- references as a nested `ref_images` object (what MULLET shipped): 119,479 bytes, and the
  extracted frame is pixel-identical to the no-reference run
- as a list, as an index-keyed object, as objects with a `ref_image` key: 119,4xx bytes,
  same non-effect
- flat `ref_image_0` keys: TypeError, unexpected keyword argument
- dotted `ref_images.ref_image_0`: 170,480 bytes and the face is the referenced subject
ComfyUI expands an autogrow group into dotted input paths and re-nests them before calling
the node, so anything else is silently dropped. Fixed in the graph builder; the tests now
pin the dotted paths and assert the nested object is absent. This also explains why
`ref_image_size` match vs max made no difference (46.2 s both) - there was nothing to size.
Frame extraction now exists at scratchpad/frames.mjs and is how a clip gets looked at.

Candidate check of the reference fix (`scratch/browser-check/cand-ref/`, 07:56-08:02):
ok=true, two turns, both clips carried three dotted reference inputs (the lane history
shows `ref_images.ref_image_0..2` on prompts 00022 and 00023, and zero on the run before
the fix), reload restored both clips with no generation requests. The clip stage now costs
149 s on turn 1 and 158 s on turn 2 against ~119 s before, because reference tokens ride
through every sampling step - that is the price of the subject actually being in the shot.
A frame pulled from the candidate's own clip shows the referenced subject, alone, waist-up.

Served f847d06 at 08:05:15 CDT; two-turn check through the real origin, cabin as Jan
(`scratch/browser-check/loop-f847d06/`, 08:05-08:10): ok=true. Turn 1: label 3.3 s,
portrait 9.1 s, caption 7.1 s, portrait loop 68.4 s, scene clip 143.5 s. Turn 2: response
25.6 s, portrait 32.5 s, portrait loop 83.8 s, scene clip 157.9 s; Continuity current;
reload restored every clip with zero generation requests; only the proxy-root favicon
502s. The served clips carry the dotted reference inputs and a frame pulled from the
served clip shows the referenced subject. READY FOR OPERATOR.
