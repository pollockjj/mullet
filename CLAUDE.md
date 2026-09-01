# CLAUDE.md

## Controlling MULLET postmortem and recovery order

- `docs/MULLET_30_HOUR_POSTMORTEM.md` is the controlling whole-project incident record, requirement disposition, recovery order, and successor handoff. Read it before changing, testing, reporting, or deploying any MULLET behavior.
- `docs/H3_RECOVERY_POSTMORTEM.md` is an H3 technical appendix only. It does not define the whole incident, product-wide milestone order, performance policy, or acceptance state.
- Do not advance past a failed milestone or substitute internal engineering evidence for an operator-testable result. The full postmortem's current state and authority supersede earlier roadmaps and technical appendices where they conflict.

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

- Route by media type: every still-image workflow runs through `IMAGE_COMFY_BASE_URL` on Firestorm CUDA0, and every video workflow runs through `VIDEO_COMFY_BASE_URL` on Firestorm CUDA1. A generated video end frame is an image and therefore runs on the image lane before its bytes are handed to the video lane.
- MiniMax H3 is the current candidate image/video priority inside the product-wide media milestones. Do not start unrelated model work unless the operator names it in the current turn. The candidate contains native five-frame H3 Ref2VA keeper stills, an unaccelerated 20-step H3 Ref2VA scene path, and a silent four-step H3 FL2VA two-second expression loop. None is an accepted production default. The unaccelerated paths may not remain defaults without the full postmortem's paired Turbo/full-path comparison, explicit cold/warm click-to-visible SLO, and operator acceptance. Retained alternative workflows remain explicit selections and are never silently substituted.
- Mage-Flow and FLUX.2 are explicitly excluded from MULLET. Do not restore them as selectable options or hidden workflow dependencies without a new current-turn operator order.
- ComfyUI diffusion-model weights for this project use the native INT8 ConvRot artifact when one exists. Do not substitute an official FP8 diffusion weight merely because the original publisher's repository is gated.
- Search the public ComfyUI-native INT8 ConvRot conversions on Hugging Face before declaring a required model unavailable or gated.
