# Expression acceptance checklist

This is the controlling checklist for the current expression-only checkpoint. A checkpoint is complete only when the exact passing commit is pushed, deployed, and verified in the served browser. Candidate-only work is not a completed checkpoint.

## Expression determination

- [x] Classify only the last completed assistant response on an isolated sidecar channel.
- [x] Never append classifier prompts, OOC text, or classifier results to the canonical conversation.
- [x] Bind the result to the exact conversation, message index, message count, and response fingerprint.

## Static expression portrait

- [x] Use a fixed 9:16 expression canvas with no aspect-ratio selector.
- [x] Use 576×1024 (approximately 0.5 MP) as the expression output dimensions.
- [x] Validate Jenna's exact 400×600, 2:3 reference bytes and SHA before queueing generation.
- [x] Keep Qwen Image Edit 2511, FLUX.2 Klein 9B KV-INT8 ConvRot, Mage-Flow, and Z-Image visible and selectable; unavailable execution reports exact missing dependencies.
- [ ] Generate a recognizable Jenna with Qwen Image Edit at 576×1024 without stretching, identity loss, or reference distortion.

## Expression animation

- [x] Use LTX 2.5 Distilled as the default expression-animation model.
- [x] Default to an exact 2-second, 49-frame, 24 FPS first-frame-equals-last-frame loop.
- [x] Prohibit talking, lip movement, speech gestures, dialogue, narration, music, room tone, and sound effects in the motion prompt.
- [x] Reject any expression-video output containing audio or another non-video media track.
- [x] Keep LTX and MiniMax expression-model options additive and selectable without changing their model-specific timing contracts.
- [x] Keep I2V, identical-frame FLF, and generated-second-frame FLF modes visible and selectable.
- [ ] Preserve the fixed 9:16 portrait canvas and head/chest framing through animation.

## Separate main-scene contract

- [x] Keep the main-scene video path separate from expression animation.
- [x] Keep MiniMax H3 as the untouched main-scene default.

## UI and deployment gate

- [x] Keep the unrequested permanent Workspace Mode fixture out of the UI.
- [x] Pass the full automated test, type-check, and production-build gates.
- [ ] Pass a real Qwen Jenna portrait probe and a real LTX silent-loop probe.
- [ ] Push the passing commit to the authoritative origin.
- [ ] Serve that exact commit and browser-verify the model selectors, mode selectors, defaults, dimensions, and generated media.
