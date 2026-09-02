# MULLET standing goal (v2, adopted 2026-09-01)

Adopted when the operator set the `/goal` condition below. v1 and its session record are
preserved in git at `1303834:docs/GOAL.md`.

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

## Where it actually stands (served c05e34a, 2026-09-02 00:57 CDT)

`node tools/browser-check.mjs --scenario Blake --starter Jenna --generate loop --turn "..."`
through the real origin (`scratch/browser-check/loop-c05e34a/`): ok=true. Two consecutive
turns each produced label, portrait, caption, portrait loop, scene still and scene loop;
each scene carried the caption of the portrait made for that turn, shown in the Media
panel as "Continuity current · <caption>"; a reload restored all four items with zero
generation and zero caption requests. A service restart mid-loop is drained on the lane
and recovered by the page in about 20 s. Every queue item below has served evidence in
`docs/STATE.md`; none is accepted until the operator says so.

The previous session's "OPEN defect 1" was withdrawn with evidence on 2026-09-01: it was
a misread of a log written under an older build.

Known limits that remain, by design of the hardware rather than defects: stills run cold
every turn and loops take 65-90 s because both lanes are single 25 GB cards on which H3
is never resident; the scene lands about 80 s after the turn because it waits for the
portrait's caption (operator-ordered chain).

## Budgets, measured in pipeline order on the served build (2026-09-01, five-stage check)

| Stage | Click-to-visible from the starter click | What sets it |
| --- | --- | --- |
| [0] label | 1.3 s | classifier |
| [1] portrait | 27 s | Qwen 4-step, cold every turn (H3 evicts it), ~25 s of ComfyUI |
| caption | 2-8 s round trip | vision call on the chat model |
| [3] scene still | 80 s at 1 MP | waits for the caption (~30 s), then 40 s of Qwen; 0.5 MP measures 15.5 s of ComfyUI |
| [2] portrait loop | 95 s | 56 frames, 37 s warm / 48 s cold, queued behind the still |
| [4] scene loop | 155 s | 73 frames, ~75-85 s, queued behind the scene still |

Budget: each number above plus 25% is the alarm line; a run past it is investigated,
not tolerated. These are hardware numbers (25 GB cards, H3 never resident), not targets:
the v1 gates of 8 s / 25 s were never reachable here. Decisions taken with the pairing
data are in `docs/STATE.md`: keep 56 frames (operator-specified 2 s; 39 frames would
save ~12 s), scene still 0.5 MP, loop timeouts 300 s. Routing by media type would make
stills warm (4-8 s) at the cost of serializing both loops; that remains the operator's
standing order to route by pipeline and is not changed here.

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
