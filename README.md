# MULLET

**Multimodal Universe, Lore, LoRAs, Expressions & Timeline**

MULLET is a local-first scenario workbench for persistent character conversations and interactive media.

The current WIP checkpoint provides a real streaming chat through an OpenAI-compatible local model endpoint with a server-enforced, user-selectable response token limit. Character-card, lorebook, scenario, and media-sidecar support are developed as continuously playable increments.

## Development

```sh
npm install --no-bin-links
npm run check
npm run build
npm run start
```

Copy `.env.example` values into the service environment. Model credentials and private network addresses belong in the runtime environment, never in the repository.

Image jobs are routed through the shared Firestorm CUDA0 ComfyUI service at `IMAGE_COMFY_BASE_URL`; video jobs are routed through the shared CUDA1 service at `VIDEO_COMFY_BASE_URL`. MULLET owns only its submitted prompt IDs and its namespaced job artifacts, not either ComfyUI installation, queue, GPU, model inventory, or global input/output roots. Automatic still mode remains the default: an initial solo scene with a linked identity LoRA uses Z-Image Turbo plus that exact LoRA, while reference-only solos, multi-subject scenes, continuity edits, reference portraits, and generated motion end frames use Qwen Image Edit 2511 with its fixed four-step Lightning LoRA. MiniMax publishes no official H3 still workflow or still-specific LoRA; MULLET's experimental base/no-LoRA 20-step T=1 path is additive and explicitly selectable, and it never silently replaces Automatic mode. Landscape scene motion includes two implemented additive MiniMax H3 Ref2VA choices: a 20-step quality path without an acceleration LoRA and the publisher-matched `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` four-step 544p preview path. The documented FL2VA recommendations are the 768p eight-step adapter with shifts `6/3` and the non-768 eight-step adapter with shifts `12/3`; they are not substitutions for the implemented landscape Ref2VA choices. Mage-Flow and FLUX.2 are not part of the supported model inventory.

## MiniMax H3 experimental still path

The selectable H3 still path uses the base Ref2VA model with no LoRA, `res_multistep`, the `beta` scheduler, and 20 steps. `beta` is intentional: the official Ref2VA template notes that `beta` or `normal` can outperform `simple` on reference-heavy prompts, and the successful owned probe was measured with `beta`.

References are ordered as the verified prior strict-ancestor scene master when one exists, then each selected subject's canonical identity image in cast order, then each available body/wardrobe image in cast order. A trio therefore uses at most seven inputs: one prior master, three canonical references, and three body references.

The experimental one-frame graph sends only conditioning output `0` from `MiniMaxH3ReferenceToVideo` into `BasicGuider`; its AV latent output `1` is not sampled. Sampling starts from `EmptyLatentImage`, which current ComfyUI converts to the H3 one-frame video latent plus its empty audio latent. Output dimensions are divisible by 32; the 0.5 MP 16:9 setting is exactly `960×544`. This behavior depends on [ComfyUI PR #15677](https://github.com/Comfy-Org/ComfyUI/pull/15677).

`MINIMAX_H3_T1_STILL_VALIDATED=true` may be enabled only after an owned prompt has successfully completed through the configured image ComfyUI service and its returned PNG has passed hash and exact-dimension validation. Node inventory alone does not prove the experimental T=1 core path.

## MiniMax H3 model provenance

Recorded 2026-08-31 for the local 768p scene-motion path.

| Field | Recorded value |
| --- | --- |
| Original developer / origin flag | MiniMax; China (`CN`). MiniMax lists Beijing, Shanghai, and Shenzhen investor-relations addresses. |
| Original checkpoint | [`MiniMaxAI/MiniMax-H3@42ed227ee7df40d41602854ae760620d6eb651fe`](https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/42ed227ee7df40d41602854ae760620d6eb651fe) |
| Serving distribution | [`Comfy-Org/MiniMax-H3@4cc1d817b6184899b41293954329f576cb5ae86b`](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/4cc1d817b6184899b41293954329f576cb5ae86b) |
| Architecture family | H3-Base-Ref2VA: CFG-distilled 33B dense single-stream H3-Omni-Transformer; Qwen3-VL-32B H3 encoder; separate visual and stereo-audio VAEs. |
| Base-checkpoint availability | Available. The original repository publishes the Ref2VA transformer alongside the processor/tokenizer, text encoder, visual VAE, and audio VAE. |
| Air-gap deployability | Yes for local H3-Base 768p after artifacts are acquired. H3-Context-IR and H3-Regenerate-2K are hosted and are not used by MULLET. |
| License class | Custom MiniMax H3 Community License; not Apache, MIT, or another permissive open-source license. |
| Territory status | The public license excludes the United States, EU, UK, and Republic of Korea. Separate local-weight authorization for this US deployment is not evidenced in this repository. MiniMax and Comfy each publish a separate-license route. |
| Quantization provenance | The Comfy distribution identifies the files as repackaged MiniMax H3 artifacts. Converter version and conversion host are not published, so these upstream INT8 ConvRot files are `UNVERIFIED` conversion provenance and are not canonical in-house conversions. |

Pinned base serving artifacts:

| Component | Bytes | SHA-256 |
| --- | ---: | --- |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | 20,970,379,616 | `9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779` |
| `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` | 27,141,342,152 | `bc2ced0fbea64757fa9acddccfc0b3f4819d1dcf1da6c124d690d368be283923` |
| `minimax_h3_video_vae_fp16.safetensors` | 5,207,808,496 | `7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522` |
| `minimax_h3_audio_vae_fp32.safetensors` | 605,254,808 | `8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48` |

[MiniMax architecture and checkpoint documentation](https://github.com/MiniMax-AI/MiniMax-H3/blob/d21241f0a4b3acbb34c97dae47fa417b7065e438/README.md), [MiniMax license Q&A](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/fa9c8ab1eaa21c8ae25e7e40b83b2e6002f340af/docs/QA-about-License.md), [MiniMax license application](https://platform.minimax.io/h3-license), [Comfy commercial-license route](https://comfy.org/minimax/license/), [MiniMax IR contacts](https://ir.minimax.io/investor-resources/ir-contacts).

Local-first multimodal scenario platform.
