# H3 scene-reference contract

> **Technical appendix only.** `docs/MULLET_30_HOUR_POSTMORTEM.md` controls whole-project recovery order, performance policy, and acceptance state.

This contract optimizes MULLET's common one-, two-, and three-subject fiction scenes. The expected distribution is approximately 66% solo, 22% duo, and 12% trio. Those proportions prioritize fast paths; they never permit dropping a visibly present subject.

## Reference roles

Each visible subject is represented by three complementary identity signals when they exist:

1. **Canonical identity** — a hash- and dimension-verified, front-biased face/head-and-shoulders image from the scenario profile. This is required. The recommended capture is one subject at 576×1024 (9:16), with neutral lighting, an unobstructed face, and no other person; existing exact-dimension references are not resampled merely to meet that recommendation.
2. **Body and wardrobe** — a hash- and dimension-verified three-quarter or full-body image showing normal proportions, hair silhouette, recurring attire, and distinguishing accessories. This is optional until supplied, then becomes durable scenario data. It supplies body proportions and invariant appearance cues to H3; the current scene master remains authoritative for scene-specific attire, pose, and placement. Browser-managed anchors are accepted only as exact 576×1024 (9:16) PNGs, with the entire outfit and body visible under neutral perspective and no other person.
3. **Scene master** — the current generated landscape still showing the selected cast in the exact composition and attire. The immediately preceding accepted scene master is an additional continuity reference only when it contains at least one exact current profile ID and fingerprint.

Every scenario reference records its real pixel dimensions, the exact GCD-reduced aspect ratio implied by those dimensions, and its SHA-256. A mismatched declaration is invalid; MULLET does not stretch a reference to make the metadata true.

One scene master can represent every visible subject, so it counts as a reference for each represented subject without being duplicated in the H3 input list. Every file is deduplicated by SHA-256 before submission.

## Stage 1: static scene master

The failed candidate intended MiniMax H3 Ref2VA as its still mode. The retained Automatic alternative used Z-Image Turbo plus an exact linked identity LoRA for an initial solo, and Qwen Image Edit for a reference-only solo, every duo or trio, and every continuity edit. Neither candidate path is operator-accepted, and no silent substitution is authorized.

Qwen supports three ordered picture inputs. MULLET allocates them deterministically:

- With no prior master, use one canonical identity image per selected subject: one for solo, two for duo, and three for trio.
- With a prior master, place that master first. Every newly introduced subject then receives a canonical slot. Remaining slots are filled by canonical references for retained subjects in stable scenario order.
- Never omit a newly introduced subject in favor of a retained subject already represented by the prior master.
- The prompt names every slot as `Picture N`, binds each identity to exactly one display name, and states which picture is the prior composition master.
- The output is a new immutable, provenance-bound landscape master. Its request key includes the prior master's hash and metadata, and its stored record retains the verified prior bytes needed by the next stage.

This creates a two-stage state transition rather than regenerating every frame from unrelated headshots:

`verified prior master + selected identity references -> Qwen edit -> verified current master`

### Candidate MiniMax H3 five-frame keeper still

The MiniMax H3 Ref2VA static-scene choice uses the versioned `minimax-h3-ref2va-still-v2` contract, the native five-frame model path, and extracts frame zero as the keeper still. The v1 T=1 contract is rejected during restore. The keeper uses the base Ref2VA checkpoint with no LoRA, `res_multistep`, the `simple` scheduler, 20 steps, denoise `1.0`, and `MiniMaxH3SigmaShift` video/audio shifts `12/3`.

Static-reference order is deterministic:

1. the verified strict-ancestor scene master, when one is available;
2. each selected subject's canonical identity image in cast order;
3. each available body/wardrobe image in cast order.

This still pack contains at most seven images: one prior master, three canonical references, and three body/wardrobe references. Initial scenes omit the prior-master slot. All supplied reference files retain their declared role and provenance and are verified before the prompt is queued.

`MiniMaxH3ReferenceToVideo` output `0` (`CONDITIONING`) feeds `BasicGuider`; output `1` (`LATENT`) supplies the native five-frame AV latent to `SamplerCustomAdvanced`. The sampled video latent is decoded with the stock H3 video VAE. `ImageFromBatch` selects batch index `0` with length `1`, and `SaveImage` saves that keeper as exactly one PNG. No audio decode or video output node is present.

Every static output dimension is divisible by 32. The 0.5 MP 16:9 selection resolves to exactly `960×544`.

## Stage 2: MiniMax H3 Ref2VA

The H3 model/adapter selection matrix is explicit:

| Output path | Candidate or evaluated model and adapter | Sampling profile |
| --- | --- | --- |
| Final identity-consistent Ref2VA scene video | Base `minimax_h3_ref2va_pruned_int8_convrot.safetensors`; no acceleration LoRA | `res_multistep` / `beta`, 20 steps |
| Fast Ref2VA scene preview at the 544-pixel envelope | `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`, strength `1.0` | Euler / Simple, 4 steps, video/audio shifts `12/3`, `ref_image_size=match` |
| FL2VA at 768p | `minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors`, strength `1.0` | 8 steps, video/audio shifts `6/3` |
| FL2VA near the 544-pixel envelope | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`, strength `1.0` | 8 steps, video/audio shifts `12/3` |
| H3 keeper still | Base Ref2VA checkpoint; no LoRA; native five-frame packet with frame-zero extraction | `res_multistep` / `simple`, 20 steps, video/audio shifts `12/3` |
| Automatic still alternative | Existing Z-Image/Qwen scene drivers; no H3 adapter | Existing model-specific path |

The two currently implemented H3 Ref2VA scene choices use `minimax_h3_ref2va_pruned_int8_convrot.safetensors` and the native `MiniMaxH3ReferenceToVideo` node. The quality choice uses no acceleration LoRA. The separately identified preview choice applies `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`; it never replaces or silently changes the quality path. The FL2VA rows record the exact recommended adapter split; they do not claim those adapters are selected by the landscape Ref2VA workflow.

Reference order is stable and prompt-visible:

1. current generated scene master;
2. prior scene master when it contributes continuity;
3. each selected subject's canonical identity image in cast order;
4. each available body/wardrobe image in cast order.

This implemented pack uses at most eight images: current + prior + three canonical + three body/wardrobe. Capability discovery still proves the native node's full nine-image ceiling; the ninth socket is reserved rather than populated with an undefined reference role.

Both paths use `ref_image_size=match`; `max` is not silently selected because reference tokens persist through every sampling step. The quality choice uses `res_multistep`, `beta`, 20 steps, and no acceleration LoRA. The fast preview reproduces LightX's published Ref2VA v0.1 recipe: LoRA strength `1.0`, Euler sampler, Simple scheduler, four NFEs, video/audio sigma shifts `12/3`, denoise `1.0`, and a 544-pixel short-edge mixed-aspect envelope (`960×544` at 16:9). `BasicScheduler` consumes the unpatched base model while `BasicGuider` consumes the LoRA- and sigma-shift-patched model, matching the publisher's graph exactly. No CFG scalar is invented.

The prompt uses the official Ref2VA sections—`subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape`, and `non_diegetic_music`—and exact one-based `<Picture N>` labels. Retention analysis uses only MiniMax's fixed visual markers (`fully_preserved`, `partially_preserved`, `attribute_transfer`, and `weak_reference`). It tracks each defined `<Subject N>` plus the current and eligible prior composition anchors; canonical and body pictures used only as a subject's source remain cited inside that subject instead of being redefined as independent retained content.

The candidate graph describes one continuous five-second shot. It attempts to preserve identities, attire, objects, composition, and spatial relationships; motion is restrained; dialogue, narration, and non-diegetic music are forbidden. H3 may generate synchronized diegetic room tone and physical ambience for landscape scenes. The failed candidate intended the 20-step H3 Ref2VA quality path as its scene-video default; that decision is not accepted and is subject to the full postmortem's performance gate.

## One-, two-, and three-subject fast paths

| Cast | Automatic-alternative first static master | Automatic-alternative continued Qwen master | Initial H3 video references | Continued H3 video references |
| --- | --- | --- | --- | --- |
| Solo | linked LoRA through Z-Image when present; otherwise canonical through Qwen | prior master + canonical | current + canonical | current + prior when overlapping + canonical |
| Duo | canonical A + B | prior master + A + B | current + A + B | current + prior + A + B |
| Trio | canonical A + B + C | prior master + newly introduced subjects first, then retained canonical slots | current + A + B + C | current + prior + A + B + C |

Available body/wardrobe references are appended to H3 after every canonical reference, with global SHA-256 deduplication. For Qwen, they fill only a free slot after the prior-master, newly introduced canonical, and retained canonical rules.

The selectable H3 keeper-still path uses canonical references for an initial scene and `strict ancestor + canonical references` for a continued scene; body/wardrobe references are then appended in cast order. Its one-, two-, and three-subject maxima are three, five, and seven references respectively when every body reference and a prior master are present.

## Required validation

- Sidecar subject IDs must belong to the exact active candidate set and remain in scenario order.
- Every canonical or body reference is normalized to an aspect ratio derived from its dimensions, then fetched from the selected ComfyUI service and checked against its declared SHA-256, byte type, width, and height before queue submission.
- Browser-managed body references are content-addressed and persisted against the exact base profile fingerprint. Only body files selected by the active Qwen/H3 reference planner are attached; Z-Image and LTX accept none. A missing managed input is uploaded to `mullet/identity` without overwrite and fetched back for exact verification before generation.
- The browser-persisted prior-master record binds request fingerprint, prompt ID, seed, timestamp, dimensions, cast fingerprints, and SHA-256. At the server boundary, its supplied PNG is independently checked against the declared SHA-256, PNG dimensions, and exact upload response. The client metadata is provenance, not a server-signed attestation.
- Both H3 video choices must expose an exact `ref_image_` IMAGE autogrow definition with `min=0`, `max=9`, the `match` sizing option, and the exact Ref2VA checkpoint. Preview availability additionally requires the exact preview LoRA, `LoraLoaderModelOnly`, `MiniMaxH3SigmaShift`, Euler, and Simple; preview-only failures cannot disable H3 quality.
- Capability discovery must prove the H3 keeper-still choice exposes that same exact reference contract, Ref2VA outputs `CONDITIONING` and `LATENT`, `MiniMaxH3SigmaShift` accepts shifts `12/3`, `res_multistep` and `simple` exist, and `ImageFromBatch` accepts index `0` and length `1`.
- Failures cancel only MULLET's returned prompt ID. No shared ComfyUI queue, model residency, service lifecycle, or global input/output path is mutated.

Primary implementation references: [MiniMax H3 model and prompt guidance](https://github.com/MiniMax-AI/MiniMax-H3), [native ComfyUI Ref2VA node](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py), [ComfyUI `ImageFromBatch` node](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_images.py), [official ComfyUI R2V workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_r2v.json), [LightX model table](https://github.com/ModelTC/Minimax-H3-Turbo#1-model-specs), and [LightX's exact Ref2VA Comfy graph](https://github.com/ModelTC/Minimax-H3-Turbo/blob/main/example_workflows/video_minimax_h3_ref2v_lightx2v_turbo.json).
