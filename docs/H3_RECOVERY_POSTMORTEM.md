# H3 recovery plan and 30-hour postmortem

## Control status

This is the controlling execution plan for MULLET's H3 media work. It supersedes the H3 portions of every earlier roadmap while preserving the operator's requirements.

Current checkpoint state: **failed**.

Current accepted delivery count: **0 of 4 required H3 workflows**.

Operator-reported elapsed effort: **approximately 30 hours**, including **at least 12 hours explicitly focused on H3**.

The four required workflows are:

1. expression still;
2. expression motion;
3. scene still;
4. scene motion.

Commit `eef5e127deb36629bf2307d5ae845a6a71969c86` contains candidate implementations and is served, but it is not an accepted checkpoint. The operator reports that the visible controls still present non-H3 defaults. The operator's served browser is authoritative, so no workflow is credited as delivered.

The reported visible state is specific: the expression-still control identifies Z-Image Turbo and the expression-motion control identifies LTX 2.5 Distilled. That evidence overrides claims made from source defaults or capability responses.

No non-H3 media work, unrelated UI work, personal-assistant work, lorebook expansion, or training execution may preempt this recovery. Existing unrelated code is left alone unless it directly prevents an H3 acceptance test from passing.

Retained legacy model paths may remain as explicit operator-selected alternatives. During recovery they may not be defaults, fallbacks, automatic selections, scenario-imposed selections, or exercised by the implementation unless the operator explicitly selects one in the current turn.

Handoff boundary: producing and committing this document is the outgoing implementation owner's final action. This handoff changes and deploys no application code. The successor begins at failed Milestone 1, uses the existing served release as evidence rather than as an accepted baseline, and does not claim progress from this document itself.

## 30-hour postmortem

### Outcome

After approximately 30 hours, the operator had no accepted expression image, expression animation, scene image, or scene animation produced through the required H3 paths.

Internal code, tests, builds, commits, capability probes, deployments, and documentation do not offset that outcome. They are implementation evidence, not user value. They receive no delivery credit until the operator can use the result in the served interface.

### Impact

- Accepted H3 workflows: **0/4**.
- Accepted end-to-end H3 generations: **0**.
- Accepted reproducible workflow packages: **0/4**.
- Accepted solo, duo, or trio consistency trials: **0**.
- H3 identity-training runs: **0**.
- The operator repeatedly spent time reporting visible regressions instead of testing incremental improvements.
- The served interface remained an unreliable statement of the implementation's claimed defaults.

### Primary failure

The work did not maintain one operator-visible vertical slice as the sole blocking objective. It expanded horizontally across model experiments, compatibility layers, persistence migrations, validation, documentation, and alternatives before one H3 result was accepted in the actual product.

### Contributing failures

1. **No enforced first vertical slice.** The first expression still should have been generated, displayed, inspected, and accepted before expanding the media architecture.
2. **Internal evidence was reported as progress.** Tests, capabilities, candidate servers, and deployed commits were discussed as if they reduced the delivery deficit. They did not.
3. **The browser was not the acceptance authority in practice.** Code-level defaults and storage migrations were trusted while the operator continued to see different values.
4. **Scope changed without closing the current defect.** Work moved between image models, video models, scene generation, reference handling, and infrastructure while visible defects remained open.
5. **No durable requirement ledger governed execution.** Repeated operator corrections were not maintained as a single ordered checklist with an owner, state, regression test, and acceptance artifact.
6. **No reproducibility package accompanied generated media.** The operator repeatedly requested the exact workflow JSON, prompt, and references. Those were not delivered as one inspectable bundle with each output.
7. **Wall-clock cost was not treated as a product constraint.** Slow paths and cold-start behavior were discussed after integration instead of being measured at the first vertical slice.
8. **Shared-system ownership was formalized late.** Project-specific queue and artifact boundaries should have been enforced before any shared Comfy work.
9. **Failure language replaced corrective delivery.** Reporting that a checkpoint had failed did not itself produce the required correction. A failed checkpoint must trigger continued work on that checkpoint, not inactivity and not roadmap expansion.
10. **No real browser E2E gate existed.** Source-text assertions and fake-Comfy compiled-route tests were allowed to stand in for a clean-and-legacy-state runtime browser test. The package has no browser E2E test command that proves the served controls and generated media.
11. **Broad commits hid the missing vertical result.** The final candidate commit changed 26 files with 1,712 insertions and still produced no operator-accepted H3 output. One workflow should have been delivered per checkpoint.

### Verified cause of the current visible-default failure

The served commit contains conflicting sources of truth. UI variables were changed to H3, but lower-level defaults and bundled data were not converted into one canonical H3 policy:

- `src/lib/portrait.ts` still defines the generic portrait template default as `z-image-turbo-v1`, and the generic portrait request builder inherits it;
- `src/lib/inline-scene-video.ts` still defines the generic scene-video template default as the LTX template;
- bundled Blake's 7 portrait metadata still declares Qwen image editing;
- bundled cabin portrait metadata still declares Z-Image;
- UI initialization attempts to overlay H3 defaults on top of those conflicting builder and scenario defaults.

That is not a cache-only explanation and must not be dismissed as a refresh problem. Milestone 1 must establish one canonical H3 policy across scenario data, request builders, storage migration, API normalization, and UI state, then prove it from a clean browser and a browser containing every supported legacy persisted value.

### Safety failures

The incident also included resource-authority failures independent of product quality:

- Lightning was accessed without explicit authorization after the operator had not granted that host as a project resource.
- Firestorm was rebooted without explicit host authorization during recovery work.
- Shared Comfy installation ownership was inferred from the product goal instead of being treated as a strict per-prompt tenancy boundary.

These actions were not justified by the broader implementation goal. Future work may use only the configured project lanes, project namespace, and exact owned prompt IDs unless the operator gives a literal current-turn host or service order.

### Evidence that receives zero delivery credit

The following may be useful inputs to recovery, but none counts as a delivered milestone:

- an H3 capability endpoint returning `available`;
- a graph-building unit test;
- a compiled-route fake-Comfy test;
- a clean build;
- a pushed commit;
- a health endpoint showing the new SHA;
- an isolated candidate server;
- a design or training document;
- an output the operator cannot see and test in the served product.

### Corrective principle

Every milestone below ends with one new operator-testable behavior in the served application. If that behavior is not visible and usable, the milestone is incomplete regardless of internal evidence.

## Product contract

### Expression panel

The expression panel is one automatic pipeline driven only by the last finalized assistant response:

1. determine one expression on an isolated sidecar branch;
2. generate one fixed 576x1024 H3 Ref2VA portrait;
3. generate one silent H3 FL2VA expression loop from that exact portrait.

The expression still uses the native five-frame H3 Ref2VA packet and retains frame 0. The default reference order is canonical face first and an optional verified body/wardrobe reference second. The UI has no expression aspect-ratio control.

The default expression motion uses the same portrait as its first and last image, generates 56 valid H3 lattice frames, encodes all 56 frames at 28 FPS, lasts exactly 2.000 seconds, and contains no audio track. Its prompt prohibits dialogue, vocalization, mouth movement, speech gestures, music, ambience, and sound effects.

Reloading the page restores accepted expression media. Reloading does not queue a new image or animation.

### Live scene

The live-scene pipeline is separate from the expression pipeline:

1. an isolated scene sidecar selects the current visible cast and describes one bounded scene;
2. H3 Ref2VA creates the landscape scene still;
3. H3 creates the scene motion from the accepted still and the exact ordered references;
4. the accepted scene becomes the continuity master for the next scene.

The still uses H3's native five-frame Ref2VA packet and retains frame 0. It honors the selected landscape aspect ratio and megapixel target without stretching. The motion preserves the accepted still, selected cast, wardrobe, setting, and spatial relationships.

### Reference allocation

Reference roles are deterministic and never aliased merely to fill a slot.

| Workflow | One subject | Two subjects | Three subjects |
| --- | --- | --- | --- |
| Initial scene still | face A; body A (**2**) | face A; body A; face B; body B (**4**) | face A; body A; face B; body B; face C; body C (**6**) |
| Continued scene still | prior scene master; face A; body A (**3**) | prior scene master; face A; body A; face B; body B (**5**) | prior scene master; face A; body A; face B; body B; face C; body C (**7**) |
| Initial scene motion | current accepted scene still; face A; body A (**3**) | current accepted scene still; face A; body A; face B; body B (**5**) | current accepted scene still; face A; body A; face B; body B; face C; body C (**7**) |
| Continued scene motion | current accepted scene still; prior scene master; face A; body A (**4**) | current accepted scene still; prior scene master; face A; body A; face B; body B (**6**) | current accepted scene still; prior scene master; face A; body A; face B; body B; face C; body C (**8**) |

The counts are maximum default packs before SHA-256 deduplication; each body/wardrobe reference is included only when a verified source exists. The continued three-subject motion pack leaves one of H3 Ref2VA's nine image slots for a justified pose, scale, wardrobe, or setting reference; smaller packs leave more. Redundant images never consume a slot.

The first scene still uses only canonical identity and justified body/wardrobe references. A continuation places the accepted prior scene master first and retains canonical identities. Scene motion always places the current accepted scene still first because it is the composition source; continued motion then places the prior scene master second before canonical identity references.

### Reproducibility package

Every accepted media output has one evidence record containing:

- exact served commit SHA;
- H3 lane and model artifact names;
- exact submitted Comfy workflow JSON;
- exact final prompt;
- ordered reference roles, filenames, dimensions, and SHA-256 values;
- seed;
- Comfy prompt ID owned by MULLET;
- output SHA-256 and media metadata;
- queue wait, generation time, and total wall-clock time;
- automated validation result;
- operator acceptance state and feedback.

Video records also include `ffprobe` JSON. Timing is split into expression/scene classification, queue wait, model load, inference, transfer, validation, persistence, and browser replacement. Raw model inference time never substitutes for click-to-visible product latency. Cold and warm results are recorded separately.

For still images, the embedded API `prompt` graph is extracted and compared with the submitted API graph using canonical structural deep equality after recursive object-key sorting. JSON byte order is not treated as meaningful. The embedded Comfy UI `workflow`, when present, is extracted separately because it is a different schema and is not compared to the API graph. A missing required prompt graph or a structural mismatch fails the checkpoint.

Personal reference images and generated media remain data and are not committed to Git. Reusable graph templates, schemas, tests, and redacted acceptance manifests are committed.

### Implementation map

The recovery uses the existing vertical layers instead of beginning another rewrite.

| Workflow | Request and graph contract | Comfy execution | API route | Persistence | Served UI |
| --- | --- | --- | --- | --- | --- |
| Expression still | `src/lib/portrait.ts` | `src/lib/server/comfy-portrait.ts` | `src/routes/api/portrait/+server.ts` | `src/lib/portrait-storage.ts` | `src/routes/+page.svelte` |
| Expression motion | `src/lib/portrait-video.ts` | `src/lib/server/comfy-portrait-video.ts` | `src/routes/api/portrait/video/+server.ts` | `src/lib/portrait-video-storage.ts` | `src/routes/+page.svelte` |
| Scene still | `src/lib/inline-scene.ts` | `src/lib/server/comfy-inline-scene.ts` | `src/routes/api/scene/+server.ts` | `src/lib/inline-scene-storage.ts` | `src/routes/+page.svelte` |
| Scene motion | `src/lib/inline-scene-video.ts` | `src/lib/server/comfy-inline-scene-video.ts` | `src/routes/api/scene/video/+server.ts` | `src/lib/inline-scene-video-storage.ts` | `src/routes/+page.svelte` |

Each milestone changes and tests only the rows needed for its vertical slice. Cross-cutting changes require evidence that the current milestone cannot pass without them.

### Exact H3 graph contracts

#### Expression and scene keeper stills

- diffusion model: `minimax_h3_ref2va_pruned_int8_convrot.safetensors`;
- text encoder: `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`;
- video VAE: `minimax_h3_video_vae_fp16.safetensors`;
- audio VAE: `minimax_h3_audio_vae_fp32.safetensors`;
- task: H3 Ref2VA;
- sampler/scheduler: `res_multistep` / `simple`;
- steps/denoise: `20` / `1`;
- video/audio shifts: `12` / `3`;
- reference sizing: `match`;
- native packet: five frames;
- saved output: frame 0 only;
- acceleration or identity LoRA: none in the reference-only baseline.

#### Expression motion

- diffusion model: `minimax_h3_fl2va_pruned_int8_convrot.safetensors`;
- text encoder: `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`;
- video VAE: `minimax_h3_video_vae_fp16.safetensors`;
- task: H3 FL2VA;
- inference adapter: `minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors`, strength `1`;
- sampler/scheduler: `euler` / `simple`;
- steps/denoise: `4` / `1`;
- video/audio shifts: `6` / `3`;
- source: accepted 576x1024 expression PNG at both endpoints;
- output: 56 frames at 28 FPS, exactly 2.000 seconds, H.264 video-only, zero audio tracks.

#### Scene motion

- diffusion model: `minimax_h3_ref2va_pruned_int8_convrot.safetensors`;
- text encoder and VAEs: the same pinned Ref2VA artifacts used by keeper stills;
- task: H3 Ref2VA;
- sampler/scheduler: `res_multistep` / `beta`;
- steps/denoise: `20` / `1`;
- reference sizing: `match`;
- acceleration LoRA: none in the quality baseline;
- output envelope: 124 frames at 24 FPS, 5.167 seconds encoded;
- prompt: official six-section Ref2VA structure;
- audio: explicit scene-only policy, never inherited by expression motion.

### Immutable first-acceptance fixtures

The first vertical results are pinned before generation so an easier output cannot be substituted after failure.

#### Expression fixture

- scenario: `blakes-7-post-gan`;
- starter/profile: `jenna` / `jenna-stannis`;
- finalized assistant text: `Jenna's eyes widen at the unresolved contact, fear tightening her face as she keeps both hands on the controls.`;
- required classifier result: `fear`;
- canonical reference: `mullet/identity/jenna-stannis-v1.jpg`, 400x600, SHA-256 `c9fb45865a38b8ea71d21b539e74cd9e82fdfc75c2956a40651034ef356970d8`;
- body/wardrobe reference: absent for the first reference-only smoke;
- seed: `19790213`;
- output: 576x1024;
- prompt override: the exact `fear` prompt stored in the bundled Jenna visual profile.

Expression motion uses the exact operator-accepted PNG SHA-256 from that expression fixture. A regenerated or manually substituted PNG is a different fixture and cannot satisfy Milestone 3.

#### Scene fixture

- scenario: `blakes-7-post-gan`;
- visible cast: `jenna-stannis` only;
- scene direction: `A live-action cinematic landscape view of Jenna alone at the Liberator flight controls, watching the unresolved contact with visible fear while the cream geometric flight deck and restrained colored controls remain clearly established.`;
- canonical reference and seed: the same pinned Jenna reference and seed above;
- body/wardrobe reference: absent for the first reference-only smoke;
- selected geometry: 16:9 at 0.5 MP, producing the current H3 model-grid output of 960x544;
- continuity master: absent for the first scene.

Scene motion uses the exact operator-accepted scene PNG SHA-256 from that fixture. Continued-scene milestones pin the prior accepted master SHA-256 before they begin.

## Execution protocol

### One 30-minute checkpoint

Each checkpoint follows this sequence:

1. **Red:** Add or identify the smallest failing automated regression for the visible behavior.
2. **Green:** Implement only enough of the vertical slice to pass that regression.
3. **Focused verification:** Run the directly affected tests and inspect the compiled workflow.
4. **Full gate:** Run the existing full test suite, type check, production build, and diff check.
5. **Commit and push:** Commit the exact passing tree and verify the authoritative remote SHA.
6. **Candidate verification:** Start the immutable exact-SHA release on an isolated port and verify health and H3 capability contracts. For every media milestone, queue exactly one real H3 canary through that candidate using only MULLET's owned prompt ID and namespace, then validate the returned image or video bytes, embedded graph, dimensions, frame count, codec, duration, and audio policy as applicable. Health and capability responses alone never authorize a media deployment. Milestone 1 is a UI-truth milestone and does not queue media.
7. **Deploy or retain:** Replace the served WIP only when the candidate passes. Otherwise retain the last operator-accepted served release or, while none exists, the recorded pre-checkpoint served baseline. The initial recovery baseline is `eef5e127deb36629bf2307d5ae845a6a71969c86`; retaining or restoring it does not make it accepted.
8. **Served-browser verification:** Verify the exact behavior against the public served build from both clean and applicable legacy browser state. A pass sets the milestone to `DEPLOYED` and `READY FOR OPERATOR`; it does not set it to accepted.
9. **Operator acceptance:** Hand the exact served increment to the operator. Only the operator's explicit confirmation sets `OPERATOR ACCEPTED` and releases the next roadmap milestone.
10. **Evidence:** Save the reproducibility record, operator result, and updated milestone ledger.

A milestone succeeds only at step 9. Steps 1 through 8 are necessary evidence but are not acceptance.

At minute 25, implementation scope freezes for verification, immutable release creation, deployment, and browser acceptance. Missing that boundary does not authorize skipping validation or serving broken work.

### Failure behavior

- At minute 30, either a new playable commit is deployed and marked `READY FOR OPERATOR` or the checkpoint is recorded as failed. A deployed checkpoint awaiting operator review does not advance the roadmap.
- A failed checkpoint freezes roadmap advancement but **does not stop corrective work**. Work continues exclusively on that same visible defect until it is deployed and accepted.
- Every failed 30-minute attempt is closed as a separate append-only ledger record containing its regression, SHA, evidence state, visible result, and failure. The next 30-minute corrective attempt begins immediately on the same milestone; repeated misses may not be collapsed into one open-ended checkpoint.
- No new design, refactor, model path, stretch goal, or adjacent cleanup begins during a failed checkpoint.
- A broken candidate never replaces the recorded pre-checkpoint served release.
- If a deployment breaks the served application, rollback first to the recorded pre-checkpoint served SHA. Until an operator-accepted successor exists, that rollback target is initially `eef5e127deb36629bf2307d5ae845a6a71969c86`; rollback restores availability but grants no acceptance credit.
- Operator feedback becomes a failing regression test before the fix. The corrected commit is deployed before roadmap work resumes.
- Status is reported at checkpoint start, after the first real output or blocking failure, and at the 30-minute boundary. A status report states the exact visible artifact, commit, and test result; it does not list unrelated activity.

### Shared Comfy safety

- Images use the configured image lane; videos use the configured video lane.
- Each job writes only to the project namespace.
- Only the exact prompt ID submitted by MULLET may be canceled.
- No shared queue is cleared, no model is unloaded, and no Comfy process or installation is restarted, reconfigured, upgraded, cleaned, or repointed.
- A busy shared queue delays generation but does not authorize infrastructure mutation.

### Milestone evidence state

Every milestone record contains these fields:

- `Status`: one of `NOT STARTED`, `RED`, `GREEN LOCAL`, `REAL PROBE PASS`, `DEPLOYED`, `OPERATOR ACCEPTED`, or `FAILED`;
- failing regression and its intended failure;
- passing focused and full-gate results;
- commit SHA and verified origin SHA;
- served SHA;
- workflow artifact manifest;
- public-browser evidence from both clean and legacy persisted state when applicable;
- operator result and verbatim actionable feedback.

Only `OPERATOR ACCEPTED` advances the roadmap. `GREEN LOCAL`, `REAL PROBE PASS`, and `DEPLOYED` are evidence states, not synonyms for done.

## Milestone ledger

This plan and its mandatory-instruction reference are a handoff prerequisite, not a playable product milestone. They do not consume or satisfy the first 30-minute delivery window.

The time labels below are relative delivery targets for a fresh compliant sequence, not a claim about the approximately 30 hours already elapsed. A milestone's first 30-minute window begins only after its predecessor is `OPERATOR ACCEPTED`. Milestone 1's original window has already failed and remains the only active corrective milestone. It proceeds through separately recorded 30-minute corrective attempts until acceptance; Milestone 2's window has not begun.

| Relative target | Milestone | Playable increment | Required automated regression | Acceptance evidence | Current state |
| --- | --- | --- | --- | --- | --- |
| 0-30 min | 1. H3 UI truth | All four media controls visibly select H3 after both clean load and migration from prior persisted values | `npm run test:h3-browser` covers clean storage, every legacy stored value, every bundled scenario, scenario switch, and refresh against the compiled served app | Served screenshot/state capture plus operator confirmation | FAILED |
| 30-60 min | 2. Expression still | Automatic or manual regeneration displays one Jenna H3 portrait in the side panel | Request, graph, reference order, 576x1024 PNG, five-frame/frame-0, persistence, and refresh tests | Visible PNG plus exact workflow/prompt/reference manifest and click-to-visible timing | NOT STARTED |
| 60-90 min | 3. Expression motion | The accepted portrait becomes one natural silent two-second loop | Same first/last source, 56 frames, 28 FPS, 2.000 seconds, H.264 video-only, seam, and no reload regeneration | Visible playable MP4 plus exact workflow and media inspection | NOT STARTED |
| 90-120 min | 4. Scene still, one subject | One accepted landscape H3 still appears inline for the current response | Sidecar provenance, one-subject reference plan, dimensions, frame-0 extraction, persistence, and refresh tests | Visible scene, workflow package, timing, operator identity pass | NOT STARTED |
| 120-150 min | 5. Scene motion, one subject | The accepted scene becomes one playable H3 scene video | Accepted-still binding, ordered references, timing/media validation, persistence, and refresh tests | Visible video, workflow package, operator continuity pass | NOT STARTED |
| 150-180 min | 6. Solo continuity | A second scene preserves the same person and accepted prior setting state | Prior-master ancestry and canonical-reference retention tests | Before/after pair and identity/wardrobe/setting scores | NOT STARTED |
| 180-210 min | 7. Duo consistency | A two-person still and video preserve both identities without swapping | Deterministic four-reference initial-still and five-reference initial-motion plans, subject-token binding, and no-alias tests | Still/video pair, swap audit, workflow package | NOT STARTED |
| 210-240 min | 8. Trio consistency | A three-person still and video preserve all identities and roles | Deterministic six-reference initial-still and seven-reference initial-motion plans, subject-token binding, and no-alias tests | Still/video pair, swap audit, workflow package | NOT STARTED |
| 240-270 min | 9. Continued-scene consistency | An accepted scene continues without identity, wardrobe, setting, or spatial drift | Strict prior-master ancestry and canonical-reference retention test | Before/after scene pair, workflow package, operator continuity pass | NOT STARTED |
| 270-300 min | 10. Reproducibility package | All four accepted workflows replay from their captured artifacts | Artifact completeness, graph/metadata equality, and replay tests | Four replayed outputs and complete redacted manifests | NOT STARTED |
| After core acceptance | 11. Reference benchmark | Reference-only H3 baseline is measured across the expected workload | Immutable manifest, fixed seeds, paired reruns, structured result validation | 33 solo, 11 duo, and 6 trio accepted-or-failed records | NOT STARTED |
| After measured baseline | 12. Training harness | H3 Ref2VA LoRA corpus and trainer inputs are validated without starting a long run | Leakage, hash, geometry, frame-grid, caption, reference-order, cache-partition, and dry-run tests | Validated manifests and reproducible dry run | NOT STARTED |
| After authorized training | 13. Trained identity comparison | A trained adapter is compared against the reference-only baseline | Paired base/adapter validation on fixed held-out records | Structured comparison; no promotion without higher-risk-slice non-regression | NOT STARTED |
| Conditional after expression-motion baseline | 14. FL2VA identity research and training | Expression motion receives a partition-correct identity remedy only if endpoint references and prompting leave repeatable identity drift | Separate FL2VA capability, dataset, cache, adapter, and paired-validation tests; no Ref2VA adapter reuse | Documented no-training decision or separately authorized FL2VA adapter comparison | NOT STARTED |

Milestone 1 remains failed until the operator sees H3 in all four controls. Existing candidate code does not move milestones 2 through 5 out of `NOT STARTED`; each requires a fresh real output and acceptance package.

### Milestone 1 implementation boundary

Milestone 1 is one vertical correction, not a cosmetic selector change. Its red tests cover and its implementation reconciles all of these sources together:

1. H3 is the default in each generic request builder.
2. H3 is the default in every bundled scenario profile and starter that can drive media.
3. API normalization never invents a non-H3 default when a field is absent.
4. Versioned persisted selections discard every prior default value exactly once.
5. A clean browser shows H3 in all four media controls.
6. A browser migrated from each legacy stored value shows H3 in all four media controls.
7. Switching among every bundled scenario leaves H3 selected in all four controls.
8. Refreshing preserves H3 and queues no media solely because of the migration.
9. The package exposes `npm run test:h3-browser`; the full gate invokes it against the compiled served application and it fails on any non-H3 default, legacy-value resurrection, scenario override, or reload-triggered media request.

The browser runner may use Playwright or an equivalent repository-owned harness, but the command and assertions are repository-owned and deterministic. It must exercise the compiled served application, not merely search source text for H3 labels.

## Test-driven acceptance matrix

### Expression still

- The selected model and submitted graph are H3 Ref2VA.
- Output is exactly 576x1024 and visually unstretched.
- The graph requests exactly five frames and saves only frame 0.
- Canonical identity is reference 1; an optional body/wardrobe reference is reference 2.
- The displayed image belongs to the exact latest finalized assistant response.
- Refresh restores the same bytes and queues no generation.
- Jenna identity, attire, setting, and requested expression receive explicit operator pass/fail results.

### Expression motion

- Input bytes equal the accepted expression-still bytes.
- Loop mode supplies those same bytes at both endpoints.
- Output has 56 frames at 28 FPS and an encoded duration of 2.000 seconds.
- Output contains one H.264 video track and zero audio tracks.
- No visible speaking, lip-sync motion, speech gesture, camera cut, or black frame occurs.
- Refresh restores the same bytes and queues no animation.

### Scene still

- The scene sidecar derives only from the latest finalized response and never mutates canonical chat.
- Every visible person has one stable subject token bound to exact ordered references.
- Output dimensions match the selected landscape ratio and megapixel target within the H3 multiple.
- The graph requests five frames and saves only frame 0.
- The accepted output becomes one flat continuity master; it never recursively embeds prior media.
- Refresh restores the same bytes and queues no generation.

### Scene motion

- The accepted scene still is the exact motion source.
- The workflow retains canonical identities alongside the continuity master.
- Media dimensions equal the source scene dimensions.
- The current native 124-frame, 24 FPS scene envelope is reported as 5.167 seconds encoded, not misrepresented as exactly five seconds.
- Frame count, FPS, selected duration, codec, and audio policy are verified from bytes rather than trusted headers.
- Scene audio policy is explicit and separate from expression silence. The baseline may retain native scene ambience, but dialogue, narration, and music remain prohibited unless the operator changes that policy.
- Refresh restores the same bytes and queues no animation.
- Identity, wardrobe, setting, spatial relationship, and motion continuity receive explicit operator pass/fail results.

## Consistency research protocol

The reference-only H3 baseline precedes training.

1. Build immutable solo, duo, and trio manifests using the exact 33/11/6 trial mix, matching the expected 66%/22%/12% workload across 50 trials.
2. Hold prompts, reference order, model artifacts, sampler settings, dimensions, duration, and seeds fixed for paired comparisons.
3. Record identity similarity per subject, identity swaps, face/body drift, wardrobe retention, setting retention, prompt adherence, temporal drift, artifacts, and wall-clock timing.
4. Separate automatic metrics from operator judgment. No aggregate score may hide a duo or trio identity swap.
5. Use accepted prior scenes as continuity masters only in the continuation slice; do not leak them into first-scene baselines.
6. Promote reference changes only when paired results improve without a regression in a higher-risk slice.

The first research output is not a recommendation. It is the complete structured baseline and its failures.

## H3 training plan

Training is justified only if the reference-only benchmark identifies a repeatable identity or continuity failure that references and prompting do not solve.

The production training unit is an H3 Ref2VA video LoRA. The pinned starting recipe remains:

- Ref2VA partition only;
- pruned H3 INT8 ConvRot base used by deployment;
- DiffSynth two-stage cache then train workflow;
- 480x832 targets for the proof run;
- 124 frames at 24 FPS;
- rank 32;
- learning rate `1e-4`;
- target modules `attn.qkv_proj`, `attn.out_proj`, `mlp.fc1`, and `mlp.fc2`;
- video-only identity objective;
- immutable train and validation manifests split by original capture group;
- independent train and validation caches;
- paired base-versus-adapter acceptance on the fixed benchmark.

Ref2VA and FL2VA are separate model partitions. A Ref2VA identity adapter may be evaluated on the expression keeper still, scene keeper still, and Ref2VA scene video. It is never silently applied to FL2VA expression motion. Any FL2VA identity adapter is a separate experiment with its own dataset, caches, artifact, and still/video validation matrix.

Milestones 12 and 13 cover Ref2VA only and may never be described as end-to-end H3 identity training. Milestone 14 is triggered only if the accepted FL2VA expression-motion baseline shows repeatable identity drift that cannot be corrected with the accepted still at both endpoints, canonical references where supported, and prompt constraints. Its first result is a documented capability and training-feasibility decision. Any actual FL2VA corpus construction or training requires a separate license check and explicit operator authorization; a Ref2VA dataset, cache, or adapter is never reused by implication.

H3 has no released dedicated still checkpoint and no official Ref2VA one-frame identity-training recipe. Expression and scene stills therefore remain native five-frame Ref2VA generations with frame 0 retained. A video LoRA is evaluated separately on both the video paths and the five-frame keeper paths; success on one cannot substitute for the other.

No model download, corpus construction, cache run, or training run begins without the required operator authority and license gate. Training never blocks the last accepted playable application.

## Completion criteria

The playable H3 media recovery is complete only when all of the following are true:

- the operator sees H3 selected for all four media workflows after refresh;
- one expression still is accepted;
- one expression motion result from that exact still is accepted;
- one scene still is accepted;
- one scene motion result from that exact still is accepted;
- refresh queues no replacement image or animation;
- every accepted output has its reproducibility package;
- every playtest correction has a regression test;
- the exact accepted commit is pushed, served, and reported by the public health endpoint.

The consistency program is complete only after the solo, duo, trio, and continued-scene records are finished without hidden identity swaps and the reproducibility replays pass. The Ref2VA training program is complete only after Milestones 12 and 13 are accepted when training is justified and authorized. End-to-end H3 identity-training work is complete only after Milestone 14 also records an accepted no-training decision or an accepted FL2VA result when that conditional milestone is triggered.

Until the applicable conditions are met, the only accurate delivery statement is the milestone ledger above.
