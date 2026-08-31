# H3 scene-reference contract

This contract optimizes MULLET's common one-, two-, and three-subject fiction scenes. The expected distribution is approximately 66% solo, 22% duo, and 12% trio. Those proportions prioritize fast paths; they never permit dropping a visibly present subject.

## Reference roles

Each visible subject is represented by three complementary identity signals when they exist:

1. **Canonical identity** — a hash- and dimension-verified, front-biased face/head-and-shoulders image from the scenario profile. This is required. The recommended capture is one subject at 576×1024 (9:16), with neutral lighting, an unobstructed face, and no other person; existing exact-dimension references are not resampled merely to meet that recommendation.
2. **Body and wardrobe** — a hash- and dimension-verified three-quarter or full-body image showing normal proportions, hair, recurring attire, and distinguishing accessories. This is optional until supplied, then becomes durable scenario data. The recommended capture is one subject at 576×1024 (9:16), with the entire outfit and body visible under neutral perspective and no other person.
3. **Scene master** — the current generated landscape still showing the selected cast in the exact composition and attire. The immediately preceding accepted scene master is an additional continuity reference only when it contains at least one exact current profile ID and fingerprint.

Every scenario reference records its real pixel dimensions, the exact GCD-reduced aspect ratio implied by those dimensions, and its SHA-256. A mismatched declaration is invalid; MULLET does not stretch a reference to make the metadata true.

One scene master can represent every visible subject, so it counts as a reference for each represented subject without being duplicated in the H3 input list. Every file is deduplicated by SHA-256 before submission.

## Stage 1: static scene master

An initial solo scene with a linked, verified identity LoRA uses Z-Image Turbo plus that exact LoRA. A reference-only solo, every duo or trio, and every continuity edit use Qwen Image Edit. There is no silent model substitution when the selected path is unavailable.

Qwen supports three ordered picture inputs. MULLET allocates them deterministically:

- With no prior master, use one canonical identity image per selected subject: one for solo, two for duo, and three for trio.
- With a prior master, place that master first. Every newly introduced subject then receives a canonical slot. Remaining slots are filled by canonical references for retained subjects in stable scenario order.
- Never omit a newly introduced subject in favor of a retained subject already represented by the prior master.
- The prompt names every slot as `Picture N`, binds each identity to exactly one display name, and states which picture is the prior composition master.
- The output is a new immutable, provenance-bound landscape master. Its request key includes the prior master's hash and metadata, and its stored record retains the verified prior bytes needed by the next stage.

This creates a two-stage state transition rather than regenerating every frame from unrelated headshots:

`verified prior master + selected identity references -> Qwen edit -> verified current master`

## Stage 2: MiniMax H3 Ref2VA

The H3 alternate uses `minimax_h3_ref2va_pruned_int8_convrot.safetensors` and the native `MiniMaxH3ReferenceToVideo` node. It uses neither the retired scene checkpoint nor an acceleration LoRA.

Reference order is stable and prompt-visible:

1. current generated scene master;
2. prior scene master when it contributes continuity;
3. each selected subject's canonical identity image in cast order;
4. each available body/wardrobe image in cast order.

This implemented pack uses at most eight images: current + prior + three canonical + three body/wardrobe. Capability discovery still proves the native node's full nine-image ceiling; the ninth socket is reserved rather than populated with an undefined reference role.

The local wall-clock default is `ref_image_size=match`; `max` is not silently selected because the official node warns that its reference tokens can make every sampling step several times slower. The maximum-consistency alternate uses the official reference-heavy `beta` scheduler guidance at 20 steps and no acceleration LoRA. The prompt uses the official Ref2VA sections—`subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape`, and `non_diegetic_music`—and exact one-based `<Picture N>` labels. Retention analysis uses only MiniMax's fixed visual markers (`fully_preserved`, `partially_preserved`, `attribute_transfer`, and `weak_reference`). It tracks each defined `<Subject N>` plus the current and eligible prior composition anchors; canonical and body pictures used only as a subject's source remain cited inside that subject instead of being redefined as independent retained content.

The generated scene remains one continuous five-second shot. It preserves identities, attire, objects, composition, and spatial relationships; motion is restrained; dialogue, narration, and non-diegetic music are forbidden. H3 may generate synchronized diegetic room tone and physical ambience for landscape scenes. LTX 2.5 remains the default video model and its output remains silent.

## One-, two-, and three-subject fast paths

| Cast | First static master | Continued Qwen master | Initial H3 references | Continued H3 references |
| --- | --- | --- | --- | --- |
| Solo | linked LoRA through Z-Image when present; otherwise canonical through Qwen | prior master + canonical | current + canonical | current + prior when overlapping + canonical |
| Duo | canonical A + B | prior master + A + B | current + A + B | current + prior + A + B |
| Trio | canonical A + B + C | prior master + newly introduced subjects first, then retained canonical slots | current + A + B + C | current + prior + A + B + C |

Available body/wardrobe references are appended to H3 after every canonical reference, with global SHA-256 deduplication. For Qwen, they fill only a free slot after the prior-master, newly introduced canonical, and retained canonical rules.

## Required validation

- Sidecar subject IDs must belong to the exact active candidate set and remain in scenario order.
- Every canonical or body reference is normalized to an aspect ratio derived from its dimensions, then fetched from the selected ComfyUI service and checked against its declared SHA-256, byte type, width, and height before queue submission.
- The browser-persisted prior-master record binds request fingerprint, prompt ID, seed, timestamp, dimensions, cast fingerprints, and SHA-256. At the server boundary, its supplied PNG is independently checked against the declared SHA-256, PNG dimensions, and exact upload response. The client metadata is provenance, not a server-signed attestation.
- Capability discovery must prove Qwen exposes `image1`, `image2`, and `image3`; H3 must expose an exact `ref_image_` IMAGE autogrow definition with `min=0`, `max=9`, the `match` sizing option, and the exact Ref2VA checkpoint.
- Failures cancel only MULLET's returned prompt ID. No shared ComfyUI queue, model residency, service lifecycle, or global input/output path is mutated.

Primary implementation references: [MiniMax H3 model and prompt guidance](https://github.com/MiniMax-AI/MiniMax-H3), [native ComfyUI Ref2VA node](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py), and [official ComfyUI R2V workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_r2v.json).
