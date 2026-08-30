# CLAUDE.md

## Definition of done

- If a change is not deployed on the operator's served build, visible in the operator's browser, and available for the operator to playtest, it is not done.
- Local edits, automated tests, builds, commits, pushes, isolated candidate servers, and agent-only probes are candidate evidence only. Never describe them as done, fixed, restored, delivered, playable, or a completed checkpoint.
- A checkpoint completes only after the exact passing commit is deployed to the served URL and the operator can test it. Until then, report it explicitly as not deployed and not done.

## Operator communication and recovery

- Never hand the operator a problem created by an agent and stop. Diagnose it, execute every safe in-scope corrective action, and carry the recovery through to a verified working state.
- Progress reports must state the solution underway or the verified resolution. Do not merely disgorge a failure and declare that work has stopped.
- Escalate only when recovery requires new authority or an external action after all safe in-scope remedies are exhausted; include the completed diagnosis and the exact remaining blocker.

## Model artifact rules

- Route by media type: every still-image workflow runs through `IMAGE_COMFY_BASE_URL` on Firestorm CUDA0, and every video workflow runs through `VIDEO_COMFY_BASE_URL` on Firestorm CUDA1. A generated video end frame is an image and therefore runs on the image lane before its bytes are handed to the video lane.
- Qwen Image Edit 2511 with `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` is the required reference editor for expression portraits, landscape scenes, and generated portrait end frames.
- Mage-Flow and FLUX.2 are explicitly excluded from MULLET. Do not restore them as selectable options or hidden workflow dependencies without a new current-turn operator order.
- ComfyUI diffusion-model weights for this project use the native INT8 ConvRot artifact when one exists. Do not substitute an official FP8 diffusion weight merely because the original publisher's repository is gated.
- Search the public ComfyUI-native INT8 ConvRot conversions on Hugging Face before declaring a required model unavailable or gated.
