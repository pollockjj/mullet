# MULLET standing goal (v2 draft, 2026-09-01)

This is the objective for every session until the operator retires it. It outranks any
roadmap, appendix, or plan that conflicts with it. Re-read it after every context
compaction.

## Objective

The operator opens https://barracuda.meteor-tegu.ts.net/mullet/, starts a scenario, and in
one turn sees all five stages land without touching anything:

```
finalized response
  └─ [0] expression label          classifier, no canonical-chat write
     └─ [1] EXPRESSION STILL       ref: immutable identity portrait (Qwen Edit 4-step / Z-Image LoRA)
        └─ [2] EXPRESSION LOOP     FL2VA 4-step, first=last=the still, silent, 2 s, 576x1024
        └─ [3] SCENE STILL         identity refs + this turn's still captioned into the prompt
           └─ [4] SCENE MOTION     FL2VA 4-step loop of the accepted scene still, silent, 3 s, 1024x576
```

Then two consecutive turns in one location hold identity, wardrobe, and setting.

The consistency contract is the caption chain the operator ordered on 2026-09-01: the
scenario's subject, attire and setting go into the expression prompt; the produced still
is captioned; that caption, and nothing older, goes verbatim into this turn's scene still
prompt and scene loop prompt. Whether the accepted still also helps as an extra image
reference to the scene still is a candidate to pair-test under the decision policy, not
part of the contract.

Done is: the operator ran the served build, saw all five stages work, and said so.
Nothing else is done. Deploy + browser check produces `READY FOR OPERATOR`, never `done`.

## Where it actually stands (verified 2026-09-01 16:43-16:46 CDT, served 903140d)

`node tools/browser-check.mjs --url https://barracuda.meteor-tegu.ts.net/mullet/ --scenario Blake --starter Jenna --generate scene`
(record: `scratch/browser-check/fable-served-903140d/check.json` + `app.png`):

| Stage | Observed in that run | Measured on the lanes (ComfyUI history, MULLET jobs only, medians) |
| --- | --- | --- |
| [0] label | `fear` | 1.0-1.5 s |
| [1] still | 576x1024 Jenna, correct identity and costume | Z-Image 4.2 s warm / 13.0 s cold; Qwen 8.4 s warm / 25.6 s cold; plus 39-70 s queue wait when the previous turn's loop is still rendering on the lane |
| [2] loop | "Animating…" at 151 s; never observed playing by any agent | 48.8 s warm / 66.8 s cold (56 frames, 576x1024, 4 steps) |
| [3] scene | 1328x752, Jenna + Cally on the flight deck, 66 s after the starter click | Z-Image 17.5 s cold; Qwen 39-45 s cold; plus caption time and queue wait |
| [4] motion | 1024x576, 3.04 s, silent, playing, 82 s after the still | 81.2 s cold (73 frames); never once warm, because a still always precedes it on the lane |

Every stage runs cold by construction: each lane alternates a still model with H3, and the
H3 model plus video VAE (26 GB) do not fit a 25 GB card, so each loop reloads (~18 s) and
each still reloads (~9 s Z-Image, ~17 s Qwen). No gate in the previous goal is met.

The previous session's "OPEN defect 1" (scene motion rejected on filename) does not exist
on 903140d: the log lines it cited were written at 10:41 CDT under build 8fc36ac and the
regex was fixed in d853b4e at 11:18. Nine scene loops completed on the lane after that,
and the check above shows one playing.

Real remaining defects, in priority order:

1. **The continuity chain runs one turn behind and can drop the scene.** The scene is
   directed seconds after the response finalizes, before this turn's portrait exists
   (the portrait needs classifier + 12-34 s + caption), and the fail-open gate in
   903140d (`subjectContinuityReady`, +page.svelte:4193) only defers when a current
   portrait is already installed. Three consequences, all verified in code and on the
   lanes:
   - the clause injected is empty on a character's first portrait of the session and
     the **previous** portrait's caption after that (`castContinuityClause` reads
     `subjectDescriptors` with no staleness check; `subjectDescriptorPortraitKeys` is
     written at +page.svelte:2613 and never read), so a changed outfit is actively forced
     back to the old one;
   - when the fresh caption lands while the scene is generating, the finished scene is
     discarded at commit (continuity is in `inlineSceneImageRequestKey` but not in the
     page attempt key or `inlineSceneMatchesSettings`) and never retried: no scene and no
     loop for that turn (6 of 6 such turns on firestorm:8189 history);
   - when the caption lands after install, nothing re-attempts, so the scene keeps the
     stale or missing clause (observed: scene_00067 at 16:43:46, no clause; portrait at
     16:44:14).
   Descriptors are in-memory only (re-captioned on every reload, never cleared across
   conversations) and only the speaking character is ever captioned.
2. **Caption filler leaks**: the captioner writes `none` for an empty slot and it goes
   into the prompt verbatim.
3. **Background leaks into continuity**: the clause says surroundings may change, then
   pins "window frame, outdoor background" from the portrait.
4. **Speed**: see the table. The 5.8 s "warm" Qwen figure in `docs/PLAN.md` was
   measured in isolation and never occurs in pipeline order; the composed 6.5-7.5 s was
   never observed. The levers that exist, measured:
   - **Loop frame count** (the only lever that moves all four stages, because it also
     shortens the next still's queue wait): H3 4-step at 0.59 MP costs ~5.7 s for the
     first latent frame and ~14 s per additional 17 frames. 22 frames (~0.9 s of video)
     is predicted ~20 s warm; 39 frames ~34 s; 56 frames measures 48.8 s.
   - **Cancel the superseded loop**: each lane is a single FIFO and MULLET never
     pre-empts, so a still submitted while a 47-88 s loop is running waits for it. When a
     new still is requested, cancel MULLET's own still-rendering loop from the previous
     turn by its exact prompt ID before submitting. Inside the shared-service rule (own
     prompt ID only). The 39-70 s waits recorded on 09-01 were mostly caused by stale
     loops re-fired on reload and by the previous session's orphaned candidate server and
     headless Chrome pages, which kept submitting to the shared lanes for eleven hours
     until this session killed them; the mechanism stands, the number was inflated.
   - **Routing by media type** (all stills on one lane, both loops on the other) would make
     stills warm (Z-Image 4.2 s, Qwen 8.4 s) and loops ~49-63 s warm. It is barred by the
     operator's standing order to route by pipeline. That order is the operator's to
     revisit with these numbers; it is not decided here.
5. **Stage [2] has never been watched to completion** by any agent or check, and **every
   page reload regenerates it**: `restoreGeneratedPortraitVideo` runs once, before the
   portrait capabilities have loaded, so the stored loop is never accepted and a fresh
   45-90 s H3 loop is submitted (seven loop-only jobs with no preceding still on the
   expression lane, two of them minutes after the previous agent told the operator to
   reload). The still, scene still and scene loop do restore from stored bytes. The
   loop key also includes prompt ID and timestamps, so a byte-identical still (fixed
   seed per character) still costs a new loop every turn.

## Work queue - in this order, one at a time, each verified in the browser before the next

1. Extend `tools/browser-check.mjs` to wait for all five stages, record per-stage
   click-to-visible from the starter click and the caption round-trip, fail (`ok=false`,
   exit 1) on any stage error or 5xx console entry, then reload the page in the same
   Chrome profile and assert that no generation is submitted and all four media items
   come back from storage. It is the only evidence. Run it through the real origin
   against the served build at the start of every session and after every deploy, only
   when `/queue` on both lanes is empty, and tear the Chrome down in the same command.
1b. Restore the expression loop on reload (await portrait capabilities and the scenario
   catalog before `restoreGeneratedPortraitVideo`, or re-run it when the loop request
   first becomes non-null), and key the stored loop on the portrait bytes' SHA rather
   than prompt ID and timestamps so an identical still reuses its loop. Pin with the
   reload assertion in the check.
2. Order the chain: a descriptor is used only when it was read from the portrait on
   screen for this turn (`subjectDescriptorPortraitKeys[profile] === generatedPortrait.requestKey`),
   never from an older one. When a portrait is expected for this turn, the scene waits for
   its caption up to a bounded time (start at 60 s) and never latches; portrait failure
   or timeout releases the scene without a clause. A caption that lands during or after
   a generation must never discard a finished scene silently: either the in-flight
   currency check ignores continuity, or the attempt key is reset so the reconciliation
   retries. The caption-in-flight state must be a reactive input of the scene
   reconciliation, otherwise the release never re-runs it. Persist the descriptor with
   the stored portrait, cache it by portrait SHA so an identical still is not re-captioned,
   and clear descriptors on conversation and scenario change. One scene still and one loop
   per turn. Pin with the check by asserting the submitted scene prompt on the lane
   carries this turn's clause.
3. Caption hygiene: drop filler tokens (`none`, `n/a`, `no visible ...`) and keep the
   background out of the continuity clause (capture it separately for later use). Log
   caption failures server-side and show "continuity unavailable" in the Media panel;
   today a failed caption is a `console.warn` and nothing else. Measure the caption
   round-trip in the check, since item 2 puts it on the scene's click-to-visible path,
   and bound the deferral by that measurement rather than the 60 s timeout.
4. Speed, in this order, each with a paired cold/warm record in `docs/STATE.md` before it
   becomes a default: cancel the superseded loop by exact prompt ID when a new still is
   requested; pair 576x1024 at 22 and 39 frames against the current 56 on identical seed
   and references and ship the shortest loop that still reads as motion (H3 accepts 5+17k
   frames); drop the scene still default to 0.5 MP since the scene loop is 0.59 MP;
   pre-generate the active character's expression stills at scenario start so an
   expression change is a ComfyUI cache hit. Then replace the 900 s video and 300 s still
   timeouts (unchanged since the first agent; two guard H3 still paths that no longer
   exist) with fail-fast budgets derived from the measurements. Budgets are written here
   from measurements, not aspirations: the previous 8 s / 25 s gates were never
   reachable on this hardware and were never measured in pipeline order.
5. Harden the two failure latches the audit found on the loop path, each pinned by the
   check: a single 5xx or client-side rejection latches `inlineSceneVideoError` and the
   attempt key, and the only recovery is the Media refresh button regenerating the still
   and therefore the loop at full cost (add a motion-only retry with backoff for 5xx and
   network failures; `retryInlineSceneVideoPlayback` is dead code); a capability GET that exceeds
   10 s while a lane is loading H3 sets capabilities to null for the whole page session
   (retry the load; the served log already shows this happening). Also log one success
   line per delivered loop server-side, since client-side rejections are otherwise
   invisible in `scratch/mullet.stderr.log`.
6. Two-scene continuity in one location (old milestone 5).

## Turn discipline - this is what killed the previous two sessions

Audited from the previous session's transcript and adversarially checked: of 862 idle
minutes, roughly 680 were the operator's overnight absence and a Claude Code restart; the
agent-attributable part is the 05:24Z stop with the operator's named 20-step defect still
live on the served build (the agent obeyed its own "do not advance past milestone 1"
rule, so the fix waited 8 hours for the operator to find it broken) plus about an hour
across three turn ends on 903140d that ended on stated intent with nothing running. Nine
turn ends carried present-tense intent ("starting now", "verifying now", "fixing those
three now") with zero activity afterwards; six of nine operator complaints followed such a
turn end; the `/goal` Stop hook evaluated once, judged the vague condition "follow the
goal" satisfied, and removed itself 34 minutes after being set.

- A turn may end only in one of two states: a background task, monitor, or wakeup is
  running and its purpose is written in the message; or the message says in one line that
  nothing is running and why. "Verifying now" or "fixing that next" with nothing running is
  a false statement, not a plan.
- The `/goal` condition must be falsifiable and long-lived so the hook cannot self-clear:
  `/goal line 1 of docs/STATE.md contains LAST-OPERATOR-RESULT: accepted-all-five-stages`.
  Only the operator's acceptance, recorded there, satisfies it.
- An operator question is answered inside the work. It never ends the work.
- The defect the operator names is fixed and deployed before any re-planning, re-tooling,
  measuring, or discarding. The previous session diagnosed the 20-step default at 04:04Z
  and shipped the two-line fix at 13:35Z, after the operator found it broken.
- Every stage is in scope at all times. There is no milestone gate that leaves a known
  defect live on the served build while waiting for acceptance of another stage.
- An evidence-backed conclusion is not reversed because the operator is angry. It is
  reversed by new evidence, cited.
- The whole loop is verified after every change, not the stage just touched. Bulk regex
  edits over `+page.svelte` are followed by a per-function size diff. Two of the previous
  session's 23 commits put a regression on the served build (0616a39 broke every scene
  video request for 45 minutes; b529cd3 deadlocked all scene generation for 29 minutes),
  and no browser check ran across four consecutive deploys that afternoon; a candidate
  build gets the full-loop browser check on a spare port before it replaces the served
  build, unless the served build is already broken.
- One change per commit, and the `docs/STATE.md` line is rewritten in the same commit.
  The previous session left SERVED-SHA stale across eight commits and seven deploys.

## Hard rules carried forward

- Decision policy: model, LoRA, steps, sampler, resolution, frame count, prompt wording,
  reference order, deploy timing, and how to recover a failure are decided here, recorded
  in `docs/STATE.md`, and never put to the operator as a question.
- Deploy: when the served build is broken, deploy the fix first and verify the deployed
  build. Otherwise deploy only when no `mullet-*` client is running or pending on either
  lane; the server has no drain, so a restart kills the operator's in-flight turn and
  leaves its ComfyUI prompts running as orphans (the "no scene, no movement" symptom).
  Adding a SIGTERM drain that cancels MULLET's own prompt IDs is on the queue. Record the
  rollback plist before every deploy.
- Shared ComfyUI: never restart, reconfigure, clean, unload, queue-clear, or queue-wide
  interrupt. Cancel only the exact prompt ID MULLET submitted. Probe 127.0.0.1 only for
  GETs; every multipart POST must go through the real origin.
- No agent process outlives its purpose. A candidate server and a headless Chrome are
  torn down in the same command that finishes the check; at session start, list and kill
  any predecessor's candidate servers (`lsof -iTCP:8782`) and `mullet-cdp-` Chrome
  profiles. The previous session's orphans submitted to the shared lanes for eleven
  hours while the operator was playtesting.
- Excluded for good: LTX 2.5, Mage-Flow, FLUX.2, unaccelerated 20-step paths, per-feature
  media toggles, model or method selectors, living lore, quote banks, assistant mode,
  memory, workspace modes, LoRA training. Do not raise them.
- Tests pin observed defects only, named after the defect. `node --test` is never evidence.
- Freeze every accepted result into `workflows/`: graph, prompt, seed, ordered references,
  output bytes, hashes, timing, served SHA.
- Progress reports: what the operator can see, the evidence class, the next action.
  Never the words done, fixed, delivered, restored, complete, or playable below acceptance.
