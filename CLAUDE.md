# CLAUDE.md

## Standing goal — read first, every session

- `docs/GOAL.md` is the standing objective and the authority on scope, speed gates, the
  decision policy, and what may not be built. Read it before anything else, and again
  after any context compaction.
- `docs/STATE.md` holds the current milestone on one line. Work only that milestone.
  Rewrite the line on every commit and append every autonomous decision to its log.
- `docs/PLAN.md` holds the execution detail: the defect table, the discard list, the
  reference chain, and the milestone acceptance criteria.
- Do not stop to ask the operator to choose, approve, architect, configure, or run
  anything. Decide under the `docs/GOAL.md` decision policy, record it, continue.

## Historical incident record

- `docs/MULLET_30_HOUR_POSTMORTEM.md` and `docs/H3_*.md` are historical evidence and
  technical appendices. They are not the current plan. Where any of them conflicts with
  `docs/GOAL.md` or `docs/PLAN.md`, the goal and plan win.
- Do not advance past an unaccepted milestone, and never substitute internal engineering
  evidence for an operator-visible result.

## Shared ComfyUI boundary

- `IMAGE_COMFY_BASE_URL` and `VIDEO_COMFY_BASE_URL` are shared ComfyUI services. MULLET does not own either installation, GPU, queue, model inventory, input root, output root, or service lifecycle.
- The `mullet/...` values in submitted workflows are per-job artifact namespaces inside the shared ComfyUI roots. They do not authorize changing a ComfyUI process's global directories or touching artifacts outside that namespace.
- Never reconfigure, restart, stop, upgrade, clean, interrupt, unload, or otherwise mutate a shared ComfyUI installation for MULLET without an exact current-turn operator order.
- On failure, cancel only the exact prompt ID submitted by MULLET. Never use queue-wide interruption, queue clearing, model unloading, or output cleanup as recovery.

## Definition of done

- If a change is not deployed on the operator's served build, visible in the operator's browser, and available for the operator to playtest, it is not done.
- Local edits, automated tests, builds, commits, pushes, isolated candidate servers, and agent-only probes are candidate evidence only. Never describe them as done, fixed, restored, delivered, playable, or a completed checkpoint.
- Deployment and browser availability produce `READY FOR OPERATOR`, not completion. A checkpoint completes only after the operator explicitly accepts the exact served commit. Until then, report the precise evidence state and never call it done.

## Operator communication and recovery

- Never hand the operator a problem created by an agent and stop. Diagnose it, execute every safe in-scope corrective action, and carry the recovery through to a verified working state.
- Progress reports must state the solution underway or the verified resolution. Do not merely disgorge a failure and declare that work has stopped.
- Escalate only when recovery requires new authority or an external action after all safe in-scope remedies are exhausted; include the completed diagnosis and the exact remaining blocker.

## Model artifact rules

- Lane routing is measured, not assumed (operator order, 2026-09-02): each of the four
  stages reads its own ComfyUI lane from the runtime (`PORTRAIT_STILL_`,
  `PORTRAIT_VIDEO_`, `SCENE_STILL_`, `SCENE_VIDEO_COMFY_BASE_URL`, defaulting to the
  pipeline lanes `EXPRESSION_`/`SCENE_COMFY_BASE_URL`). The served layout is whichever
  lands all four items fastest in the paired browser-check benchmark recorded in
  `docs/STATE.md`; today's candidates are by pipeline (expression on 8188, scene on
  8189) and by media type (every still on 8188, every H3 loop on 8189).
- One image path and one video path, chosen by scenario data, with no model or method
  selection in the UI and no per-feature media toggles (operator order, 2026-09-01). Every
  media path uses a distillation LoRA or distilled weights at 4-8 steps; unaccelerated
  high-step paths, H3 keeper stills, the 20-step H3 scene path and LTX 2.5 are deleted,
  not retained as selections. Do not reintroduce any of them or start unrelated model
  work unless the operator names it in the current turn.
- Mage-Flow and FLUX.2 are explicitly excluded from MULLET. Do not restore them as selectable options or hidden workflow dependencies without a new current-turn operator order.
- ComfyUI diffusion-model weights for this project use the native INT8 ConvRot artifact when one exists. Do not substitute an official FP8 diffusion weight merely because the original publisher's repository is gated.
- Search the public ComfyUI-native INT8 ConvRot conversions on Hugging Face before declaring a required model unavailable or gated.
