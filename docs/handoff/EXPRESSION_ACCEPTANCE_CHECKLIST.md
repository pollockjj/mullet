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
- [x] Default every bundled scenario to the native five-frame MiniMax H3 Ref2VA keeper, using frame zero as the only saved PNG.
- [x] Require the exact H3 Ref2VA INT8 ConvRot model, 20 steps, `res_multistep`/`simple`, shifts `12/3`, and `match` reference sizing.
- [x] Bind the canonical face reference first and the optional verified body/wardrobe reference second, without reference-role aliasing.
- [x] Keep Qwen Image Edit and Z-Image only as explicit alternatives; never silently substitute them for an unavailable selected H3 path. Mage-Flow and FLUX.2 remain excluded.
- [ ] Generate a recognizable Jenna with H3 at exactly 576×1024 without stretching, identity loss, or reference distortion.

## Expression animation

- [x] Use MiniMax H3 FL2VA as the default expression-animation model.
- [x] Default to an exact 2-second loop by generating all 56 valid H3 lattice frames, supplying the same image as first and last frame, and encoding at 28 FPS without trimming or dropping the endpoint.
- [x] Prohibit talking, lip movement, speech gestures, dialogue, narration, music, room tone, and sound effects in the motion prompt.
- [x] Reject any expression-video output containing audio or another non-video media track.
- [x] Keep retained alternatives explicit and selectable without allowing an old persisted choice to defeat the new H3 default.
- [x] Keep I2V, identical-frame FLF, and generated-second-frame FLF modes visible and selectable.
- [x] Preserve the fixed 9:16 portrait canvas and head/chest framing through animation.

## Separate main-scene contract

- [x] Keep the main-scene video path separate from expression animation.
- [x] Keep MiniMax H3 as the untouched main-scene default.

## UI and deployment gate

- [x] Keep the unrequested permanent Workspace Mode fixture out of the UI.
- [x] Pass the full automated test, type-check, and production-build gates.
- [ ] Pass a real H3 Jenna keeper-still probe and a real H3 silent two-second loop probe.
- [ ] Push the passing commit to the authoritative origin.
- [ ] Serve that exact commit and browser-verify the model selectors, mode selectors, defaults, dimensions, and generated media.
