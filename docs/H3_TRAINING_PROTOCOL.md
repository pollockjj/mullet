# MiniMax H3 identity-training protocol

> **Technical appendix only.** `docs/MULLET_30_HOUR_POSTMORTEM.md` controls whole-project recovery order, authority gates, and acceptance state.

Status: design baseline, checked against upstream sources on 2026-08-31. Every numeric value identified as a **MULLET starter** is an initial experiment, not a published optimum or a quality guarantee.

## Decision boundary

The production identity-training unit is a **MiniMax H3 Ref2VA video LoRA**. Ref2VA is the H3 partition that accepts ordered image, video, and audio references; FL2VA is a different partition with different DiT and text-encoder weights. Adapters, caches, processors, and validation results are partition-specific and are never carried between them.

H3 does not publish a dedicated still-image checkpoint or an official identity-image LoRA recipe. MULLET's H3 still path generates a native five-frame Ref2VA packet and keeps frame zero. A production Ref2VA video LoRA may be evaluated on that path, but transfer from video training to keeper-still quality is not assumed.

Musubi Tuner's one-frame mode is a separate experimental research lane. It can train a plain T2VA image LoRA or an FL2VA editing/inbetween LoRA on the FL2VA base. Musubi explicitly says that **Ref2VA one-frame training is not implemented**. It therefore cannot replace the production Ref2VA identity/video adapter.

Turbo/acceleration LoRAs are inference adapters, not subject-training adapters. In particular, the Ref2VA four-step and FL2VA four/eight-step LoRAs are not identity corpora, are not training bases, and are never described as trained character LoRAs. Production training and acceptance use the unaccelerated Ref2VA base; any later stacking with an acceleration adapter requires a separate paired validation.

## Production dataset contract

Each record contains a target video, an optional synchronized target-audio file, an official-format Ref2VA caption, and an ordered `references` array. The caption preserves MiniMax's six Ref2VA sections: `subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape`, and `non_diegetic_music`. DiffSynth preprocessing and training must both receive:

```text
data_file_keys = video,input_audio,references
extra_inputs   = input_audio,references
```

The geometry is fixed before caching:

- 24 fps targets;
- width and height divisible by 32;
- frame count `17n+5`; use 124 frames (about 5.17 seconds) for the first production experiment;
- **MULLET starter:** 480x832 for the first training proof, matching DiffSynth's published Ref2VA recipe, followed by a measured 768-short-edge run only after the proof is clean;
- one continuous shot per item, without cuts, overlays, watermarks, or identity-changing edits.

Targets should contain ordinary motion, turns, occlusion, varied expression, changed lighting, and multiple camera distances. Identity-invariant details belong in the subject definition; scene-specific wardrobe, pose, and setting belong in the per-record description. A target frame, near-duplicate frame, or crop from the same source clip must never be used as that record's identity reference.

### Ordered reference packs

References use stable one-based picture positions in both the metadata and caption. One picture has one role. The default packs deliberately stay below Ref2VA's nine-image limit.

| Visible subjects | Ordered image references | Maximum default images |
| --- | --- | ---: |
| One | P1 face/head-and-shoulders A; P2 three-quarter/full-body A; optional P3 pose or scene relationship | 3 |
| Two | P1 face A; P2 body A; P3 face B; P4 body B; optional P5 shared pose/relationship | 5 |
| Three | P1 face A; P2 body A; P3 face B; P4 body B; P5 face C; P6 body C; optional P7 shared pose/relationship | 7 |

The caption binds every subject token to its exact pictures and preserves the same order at inference. P8 and P9 remain available for a justified wardrobe, scale, or pose reference; they are not filled with redundant portraits. Reference videos are omitted from the identity baseline. A later motion-reference experiment may append one video from a different capture session, with audio explicitly disabled when only its movement is intended.

### One-, two-, and three-person corpus mix

For a single recurring person, use one subject-scoped adapter. For a stable recurring cast of two or three people, use one cast-scoped adapter with a distinct token for each person and retain solo targets; group-only training invites identity entanglement. Dynamic or rarely recurring casts stay reference-only and do not justify an adapter.

These are **MULLET starter corpus sizes and sampling weights**, not upstream recommendations:

| Stable cast | Starter accepted targets | Train mix | Held-out validation targets |
| --- | ---: | --- | ---: |
| One person | 48 | 100% solo | 12 |
| Two people | 64 | 75% solo, balanced by identity; 25% duo | 16 |
| Three people | 100 | 66% solo, balanced by identity; 22% duo, balanced by pair; 12% trio | 24 |

The mix mirrors MULLET's expected solo/duo/trio workload. Counts are accepted clips after duplicate, blur, face-visibility, and duration checks—not extracted frames. More repeats of one recording session do not substitute for new sessions, lighting, wardrobe, camera distance, and motion.

## Leakage-proof split and caches

Split raw capture groups before trimming, frame extraction, captioning, or caching. A capture group means one original recording session or source episode; every derivative clip, crop, extracted frame, and reference derived from it stays in the same partition.

1. Build immutable train and validation manifests with SHA-256 for every target and reference.
2. Reject exact target overlap, shared source-group IDs, and near-duplicate target frames across partitions.
3. Keep independent metadata files and independent latent/text cache roots, for example `cache/train/ref2va/...` and `cache/validation/ref2va/...`. Never point validation at the training cache and never promote a cache merely by renaming it.
4. Use two validation slices:
   - **operational**: unseen target sessions with the same canonical reference pack MULLET will use in production;
   - **reference-generalization**: unseen target sessions and held-out identity/reference photographs.
5. Never choose checkpoints from training renders. Checkpoint selection uses the fixed validation manifest, fixed seeds, and the same exact Ref2VA prompt/reference order as the base comparison.

DiffSynth's two-stage cache/train workflow is mandatory for its full/pruned H3 recipes because the DiT and Qwen3-VL encoder cannot share the training GPU simultaneously. Run `sft:data_process` separately for train and validation, then train only from the train cache. Record the trainer revision, model/processor/VAE hashes, dataset-manifest hash, cache-format version, seed, and adapter hash.

## Audio policy

Identity and expression motion are video-only objectives. Their **MULLET starter** uses `audio_loss_weight=0` (or the trainer's explicit video-only option), captions state that the shot is silent with no speech, and the product discards generated audio. The H3 audio VAE and structural audio rows are still required; missing audio is a presence-gated, unsupervised silence placeholder, not a supervised silence target.

If a later scene adapter is intended to preserve voice or ambient sound, it is a separate experiment using real synchronized 32 kHz stereo targets. Missing-audio records remain excluded from audio loss. A visual-only reference video carries no embedded or sidecar audio. Video-only LoRAs can alter H3's shared-stream audio behavior even with zero audio loss, so their audio is considered unconstrained and must not be exposed.

## Starter training recipe

The current DiffSynth pruned INT8 ConvRot Ref2VA LoRA script is the production starting point. The following are **MULLET starter values**, selected from that exact script and subject to paired A/B validation:

| Setting | Starter value |
| --- | --- |
| Task/base family | `Ref2VA` only |
| Training/deployment/acceptance base | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` |
| LoRA rank | 32 |
| Learning rate | `1e-4` |
| Target modules | `attn.qkv_proj`, `attn.out_proj`, `mlp.fc1`, `mlp.fc2` |
| Precision | Floating-point LoRA on the frozen INT8 ConvRot H3 base; BF16 compute |
| Target geometry | 480x832, 124 frames, 24 fps |
| Gradient controls | gradient checkpointing; batch size 1 with accumulation when needed |
| Audio | video-only for identity/expression adapters |

DiffSynth's example uses `dataset_repeat=100` and five epochs as a runnable recipe, not a corpus-independent optimum. MULLET does not copy those exposure counts blindly. Save frequent checkpoints, compare each against the unadapted base on the held-out manifest, and stop when identity improves without higher subject-swap, temporal-drift, or prompt-adherence failure rates.

DiffSynth and Musubi support the H3 ConvRot INT8 family, but support does not imply numerical equivalence with BF16. The pinned DiffSynth starter caches and trains against the exact deployed Ref2VA pruned INT8 ConvRot artifact, then validates the adapter on that same artifact. An adapter trained or cached with an FL2VA processor, FL2VA DiT, differently pruned base, or mismatched H3 tokenizer is invalid. The LoRA remains a floating-point adapter; it is not renamed or packaged as an INT8 model artifact.

## Experimental one-frame still LoRA

The only documented one-frame training route is Musubi's `dev` implementation on the FL2VA family:

- T2VA for plain still-image LoRAs, or FL2VA for one/two-control editing LoRAs;
- batch size 1, 32-pixel buckets, a one-frame target, and video-only loss;
- **Musubi example starter:** rank/alpha 16/16, AdamW8bit, learning rate `1e-4`;
- guidance-loss countermeasure because released H3 is CFG-distilled; Musubi reports `scale=4.0` and `sigma_min=0.15` as its tested starting point;
- completely separate one-frame latent/text caches from all video and Ref2VA caches.

This path is outside the released H3 video-training distribution. It is not the default identity path, it does not produce a Ref2VA one-frame identity adapter, and image-trained LoRA behavior during normal video generation is unvalidated. Promotion would require a separate still benchmark and a separate video-regression benchmark.

## Acceptance gate

Run paired same-unit comparisons of base Ref2VA versus each adapter checkpoint on the fixed validation records. Evaluate solo, duo, and trio slices separately for identity retention, subject swaps, body/wardrobe consistency, prompt adherence, temporal face drift, artifact rate, and forbidden speech/audio. Evaluate the five-frame keeper-still path separately; video acceptance cannot stand in for still acceptance.

No adapter becomes selectable until it wins on the exact deployed Ref2VA ConvRot base without a regression in any higher-risk cast slice. A two- or three-person failure cannot be hidden by the larger solo slice.

## License deployment gate

MiniMax's H3 Community License dated 2026-08-02 defines the United States, European Union, United Kingdom, and Republic of Korea as excluded territories and grants rights only within its defined applicable territory. It directs excluded-territory deployment inquiries to MiniMax for separate authorization. Therefore this protocol is research documentation only: downloading for a new training run, training, distributing an adapter, or deploying H3 from an excluded territory requires confirmed authorization and operator approval first. This is a release gate, not a technical parameter, and does not constitute legal advice.

## Primary sources

Source revisions were recorded on 2026-08-31 because the linked `main` and `dev` branches are mutable.

- [MiniMax H3 official repository, revision `d21241f`](https://github.com/MiniMax-AI/MiniMax-H3/tree/d21241f0a4b3acbb34c97dae47fa417b7065e438)
- [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)
- [DiffSynth H3 model and training documentation, revision `84f93fc`](https://github.com/modelscope/DiffSynth-Studio/blob/84f93fc4907b6c193be5501bab0b5c37f383033c/docs/en/Model_Details/MiniMax-H3.md)
- [DiffSynth exact pruned INT8 ConvRot Ref2VA LoRA recipe, revision `84f93fc`](https://github.com/modelscope/DiffSynth-Studio/blob/84f93fc4907b6c193be5501bab0b5c37f383033c/examples/minimax_h3/model_training/lora/MiniMax-H3-Int8-ConvRot-Pruned-Ref2VA.sh)
- [DiffSynth pruned Ref2VA LoRA recipe, revision `84f93fc`](https://github.com/modelscope/DiffSynth-Studio/blob/84f93fc4907b6c193be5501bab0b5c37f383033c/examples/minimax_h3/model_training/lora/MiniMax-H3-Pruned-Ref2VA.sh)
- [DiffSynth full/pruned Ref2VA cache/train recipe, revision `84f93fc`](https://github.com/modelscope/DiffSynth-Studio/blob/84f93fc4907b6c193be5501bab0b5c37f383033c/examples/minimax_h3/model_training/full/MiniMax-H3-Pruned-Ref2VA.sh)
- [Musubi H3 training documentation, `dev` revision `c9e9b17`](https://github.com/kohya-ss/musubi-tuner/blob/c9e9b17c9653f4231fcdb31e06eb2fce8da59aa7/docs/minimax_h3.md)
- [Musubi experimental one-frame H3 documentation, `dev` revision `c9e9b17`](https://github.com/kohya-ss/musubi-tuner/blob/c9e9b17c9653f4231fcdb31e06eb2fce8da59aa7/docs/minimax_h3_1f.md)
