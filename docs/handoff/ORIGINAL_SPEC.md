# MULLET original product specification and phased plan

> **Historical product record, not the current execution plan.** Preserve the original requirements, but use `docs/H3_RECOVERY_POSTMORTEM.md` for current H3 scope, model contracts, milestone order, and acceptance state whenever the documents conflict.

This document reconstructs the requested product specification from the operator's instructions during the 2026-08-28 implementation session. It incorporates later corrections where they overrode an earlier choice. It is the product target, not a claim that the target was achieved.

## Product intent

Build a new, streamlined local-first interactive-fiction frontend instead of continuing to pay the conceptual and operational cost of SillyTavern features the operator does not use.

Working name:

> **MULLET — Multimodal Universe, Lore, LoRAs, Expressions & Timeline**

The product should retain the parts of SillyTavern that are load-bearing for the operator—character cards and lorebooks—while making local-model chat, isolated sidecars, and interactive image/video generation first-class rather than extensions around a general-purpose frontend.

## Non-negotiable compatibility

### Character cards

Character-card implementation must be equivalent for the operator's use:

- Character Card V2 and current V3 data.
- SillyTavern-compatible PNG card metadata.
- Embedded character book/lorebook data.
- Alternate greetings, system prompts, post-history instructions, character depth prompts, creator metadata, tags, assets, extensions, and unknown fields retained without destructive normalization.
- Import and prompt behavior close enough that an existing SillyTavern character card can move into MULLET without rewriting it.

### Lorebooks

Lorebook implementation must be equivalent for the operator's use:

- SillyTavern World Info and Character Book compatibility.
- Scan depth, recursive activation, minimum activations, budget, probability, selective-key logic, regex keys, constant entries, insertion position/depth/role, inclusion groups, character filters, sticky/cooldown/delay state, and persistence.
- Embedded character lore and separately imported global lore.
- Unknown/raw fields preserved for round-trip safety.

A character card without its lorebook is not a complete unit for this product.

## Scenario cards

The primary fiction unit should be a **Scenario Card**:

- one compatible character/scenario card;
- one bundled lorebook;
- an active episodic setup;
- named characters and settings;
- expressed shared history;
- a sidecar that can incorporate session developments back into living history without polluting the main transcript.

The first self-contained content package is Blake's 7:

- timeline begins after Gan's death;
- timeline precedes the loss of Blake and Jenna;
- the user introduces a new character into the remaining season-two situation;
- the playable main/user character is female;
- the package includes Blake, Jenna, Avon, Cally, Vila, Zen, Orac, antagonists, locations, history, and scenario hooks;
- Cally is the initial expression subject after the operator's correction.

The later content target is the operator's gaming group and its lore.

## Main local-model channel

- Talk to the operator's local models through their normal communication/chat templates.
- Begin with the Gemma 4 variant served from hammerhead.
- Keep one clean canonical conversation channel.
- Sidecars branch from committed/finalized conversation state and never inject OOC control turns into canonical history.
- Response token limits must be explicit, server enforced, user selectable, and use the same values/ranges as the operator's SillyTavern configuration when in doubt.

## Expression classifier and static portrait

When Expressions are enabled:

1. A superseded/sidecar LLM process classifies the latest assistant response using copied or equivalent current SillyTavern expression-determination behavior.
2. It runs on a conversation branch and does not append classifier/OOC text to the main stream.
3. A Comfy harness builds the character image from:
   - model-specific prompt guide;
   - canonical subject/identity reference;
   - compatible LoRA search for the workflow model's LoRA family/folder;
   - optional user-as-LoRA identity;
   - current setting;
   - appropriate attire;
   - fixed portrait/head-and-chest framing;
   - classified SillyTavern expression.
4. The expression portrait is intended to update nearly automatically in wall-clock terms.

Later corrections override earlier generic image controls for the expression surface:

- no selectable expression aspect ratio;
- fixed square output;
- start at 0.5 MP;
- exact current target: 704x704 PNG;
- fixed sidebar square without CSS stretching;
- Cally must remain recognizably Cally;
- Mage-Flow is rejected;
- Qwen Image Edit is rejected for wall-clock latency;
- FLUX.2 Klein 9B is required;
- the required checkpoint is Comfy's INT8 ConvRot artifact, not FP8.

## Portrait expression motion

After the static expression updates, a second process creates portrait motion.

Required modes:

- I2V from the expression image;
- supplied first/last-frame FLF2V;
- generated second-frame FLF2V;
- natural loop with the same image supplied as first and last frame.

Corrected default:

- MiniMax H3, never LTX 2.5;
- 3 seconds;
- identical first and last frame;
- portrait/head-and-chest composition;
- portrait media retains its intrinsic aspect ratio;
- silent video only;
- no audio track;
- no talking;
- no lip or mouth movement;
- no speech gestures.

Selectable portrait-video controls may include duration and motion mode, but the expression image itself has no aspect-ratio selector.

## Inline landscape media

In parallel with the portrait sidecar, a separate inline scene sidecar operates on the latest finalized response:

- landscape-only aspect ratios;
- selectable megapixel target;
- dimensions calculated to the selected model's required multiple;
- selected image model and model-specific prompt guide;
- optional compatible LoRA selection;
- static image shown inline as soon as available;
- subsequent motion replaces/augments the static scene;
- selectable motion mode and seconds;
- this is the second Comfy card/panel, distinct from the expression portrait.

Inline landscape sound is a separate product decision from portrait expression motion. The explicit no-sound/no-speech correction applies to portrait expression animations.

## Living lore/history

- Sidecar runs from finalized conversation boundaries.
- Session events can be incorporated into a supplemental living lorebook.
- Updates are provenance-bound to the exact transcript revision.
- Dynamic character stats and bios update to match history on demand.
- Quote bank retains useful verbatim lines while newer, more relevant quotes displace older, less relevant ones.
- Living-lore processing never mutates canonical chat history or imported raw lorebook/card data.

## Personal-assistant mode

Provide an OpenClaw-like local personal-assistant mode:

- separate from fiction mode;
- neutral assistant system channel;
- durable structured memory;
- facts, preferences, and tasks grounded only in explicit user statements;
- structured lorebook-like memory updates after each completed interaction;
- task lifecycle operations and deadlines;
- no fiction sidecars in assistant mode;
- atomic persistence across transcript and memory state.

## LoRA stretch goals

- One-image LoRA generation for the selected image-model family when a suitable current method exists.
- Full-corpus LoRA training for the selected image-model family.
- Training may use Comfy nodes or the current best external trainer, but it must be selected from current evidence rather than memory.
- Model-family/folder compatibility and trigger-word provenance remain explicit.

## Serving and implementation shape selected during the effort

- New repository, not a SillyTavern fork.
- TypeScript/SvelteKit/Svelte frontend and Node server.
- Serve persistently from barracuda under `/mullet/`.
- Local text model initially on hammerhead through an OpenAI-compatible endpoint.
- Comfy generation on an explicitly authorized GPU host.
- Browser persistence for conversations and media, with server-side validation/provenance for generated artifacts.
- Development branch: `codex/mullet-wip`.

## Continuous-playability delivery contract

The operator's checkpoint contract is part of the product plan, not optional project management:

1. A playable version must exist after the first 30 minutes.
2. A new playable version must be available every 30 minutes thereafter.
3. A checkpoint fails if no new playable commit is deployed.
4. Broken or incomplete work remains on the development branch and cannot replace the served version.
5. The served version is always the most recent checkpoint that passed.
6. Playtesting feedback preempts the next roadmap increment.
7. Every playtesting correction receives a regression test before roadmap work resumes.
8. If a working checkpoint is not delivered, no unrelated roadmap work proceeds until the operator sees working progress.
9. The long-lived goal does not need rewriting for interactive feedback; feedback is part of the acceptance loop.

## Intended milestone order

Each milestone was supposed to end in a separately playable, deployable checkpoint.

1. **Skeleton and local chat** — new repo, persistent served shell, streaming Gemma channel.
2. **Token-control correction** — server enforcement and SillyTavern-matched values/ranges.
3. **Character-card compatibility** — import, preservation, prompt compilation.
4. **Lorebook compatibility** — activation semantics and persistence.
5. **Scenario package** — Blake's 7 card+lore bundle and female protagonist.
6. **Expression classifier** — isolated SillyTavern-equivalent expression sidecar.
7. **Static expression portrait** — fast, fixed-square, identity-preserving Comfy image.
8. **Portrait motion** — MiniMax H3 3-second silent natural loop plus other modes.
9. **Inline scene stills** — response-bound landscape generation.
10. **Inline scene motion** — selected landscape video mode/duration.
11. **Living history** — summaries, quote bank, character state, lore projection.
12. **Personal assistant** — isolated mode and persistent structured memory.
13. **LoRA training** — one-image and full-corpus training after the core interaction loop is accepted.

The implementation accumulated much of this code, but it did not satisfy the continuous-playability contract or obtain acceptance for the core portrait loop.
