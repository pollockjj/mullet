# Expression workflow reproduction bundle

Every JSON file in `api/` was extracted from the `prompt` metadata embedded by ComfyUI in the corresponding generated PNG, WebM, or MP4. These are the exact API-format prompt graphs that ran, not reconstructed templates.

## Image graphs

| Graph | Character | Model | Exact generated output |
| --- | --- | --- | --- |
| `api/jenna-z-image-turbo.json` | Jenna | Z-Image Turbo | `outputs/jenna-z-image-turbo.png` |
| `api/jenna-qwen-image-edit-2511.json` | Jenna | Qwen Image Edit 2511 + 4-step LoRA | `outputs/jenna-qwen-image-edit-2511.png` |
| `api/jenna-flux2-klein-9b.json` | Jenna | FLUX.2 Klein 9B KV INT8 ConvRot | `outputs/jenna-flux2-klein-9b.png` |
| `api/cally-qwen-image-edit-2511.json` | Cally | Qwen Image Edit 2511 + 4-step LoRA | `outputs/cally-qwen-image-edit-2511.png` |
| `api/cally-mage-flow-edit-turbo.json` | Cally | Mage-Flow Edit Turbo | `outputs/cally-mage-flow-edit-turbo.png` |

The identity-reference inputs are the exact bytes used by ComfyUI:

- `inputs/jenna-stannis-v1.jpg`: 400×600, SHA-256 `c9fb45865a38b8ea71d21b539e74cd9e82fdfc75c2956a40651034ef356970d8`
- `inputs/cally-v1.jpg`: 360×254, SHA-256 `8d61eb6b5218cb76c259f41d848cbc0953500bc133de807e9464db013a0fc962`

The Cally Qwen graph proves the distortion source. It samples from a 360×254 landscape reference and its final `ImageScale` forces the result to 768×1152 with `crop: "disabled"`. Jenna's 400×600 reference already has the requested 2:3 geometry, so the same graph does not impose that distortion on Jenna.

## Animation graphs

| Graph | Character | Model / contract | Exact input | Exact generated output |
| --- | --- | --- | --- | --- |
| `api/jenna-ltx-2.5-loop.json` | Jenna | LTX 2.5, identical-frame loop, video-only WebM | `inputs/jenna-qwen-fear.png` | `outputs/jenna-ltx-2.5-loop.webm` |
| `api/jenna-minimax-h3-loop-silent.json` | Jenna | MiniMax H3, identical-frame loop, silent MP4 | `inputs/jenna-qwen-fear-768x1152.png` | `outputs/jenna-minimax-h3-loop-silent.mp4` |
| `api/cally-minimax-h3-loop-historical-audio.json` | Cally | Historical MiniMax H3 graph with audio nodes | `inputs/cally-qwen-grief.png` | `outputs/cally-minimax-h3-loop-historical-audio.mp4` |

The historical Cally MiniMax graph is retained because it is the exact graph that produced the unwanted audio-bearing Cally animation. It contains `VAEDecodeAudio` and passes audio into `CreateVideo`. It is diagnostic evidence, not the current silent expression-animation contract. The silent Jenna MiniMax graph omits those audio nodes and explicitly prompts against speech, mouth motion, music, room tone, and sound effects.

## Exact replay

Each graph is the value for ComfyUI's `prompt` request field. Place the exact input bytes under the `LoadImage.inputs.image` path recorded in the graph, or change only that path to the matching file in `inputs/`. Preserve the embedded seed, dimensions, model names, sampler settings, and `is_changed` SHA-256 value. Submit the graph as:

```json
{
  "prompt": { "...": "the complete object from api/<graph>.json" },
  "client_id": "mullet-manual-reproduction"
}
```

The model and node filenames in each graph are authoritative. A graph is reproducible only on a ComfyUI installation exposing those exact artifacts and node types.
