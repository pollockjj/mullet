# MULLET standing goal

This is the objective for every session until the operator retires it. It outranks
any roadmap, appendix, or plan that conflicts with it. Re-read it after every context
compaction.

## Objective

Deliver one fast, identity-consistent core media loop in the operator's browser:

**one expression determination → two images → two short videos**, chained by references
so character and setting stay consistent, every default accelerated by the available
turbo/lightning LoRAs.

Ordered stages, references chained forward:

```
finalized response
  └─ [0] expression label          classifier, no canonical-chat write
     └─ [1] EXPRESSION STILL       ref: immutable identity portrait
        └─ [2] EXPRESSION LOOP     FL2VA, first=last=the accepted still, silent, 2s
        └─ [3] SCENE STILL         refs: identity + accepted still + retained setting still
           └─ [4] SCENE MOTION     Ref2VA, accepted scene still = Picture 1, + cast refs
```

Execution detail lives in `docs/PLAN.md`. Where the two conflict, this file wins.

## Done

Done is: the operator ran the served build, saw all five stages work, and said so.
Nothing else is done. Not tests, not commits, not builds, not deploys, not agent probes.
Deploy + browser-verified produces `READY FOR OPERATOR`, never `done`.

## Hard gates

Warm click-to-visible: still ≤ 8s, video ≤ 25s. Cold ≤ 3× warm.
A candidate that misses its gate cannot become a default regardless of output quality.
No default changes without a recorded paired cold+warm run on identical references,
dimensions, seed, and prompt.

## Decision policy — do not stop to ask

Decide these yourself, record the decision and its evidence in `docs/STATE.md`, continue:

- model, LoRA, step count, sampler, scheduler, shift, resolution, frame count
- which default wins a paired timing comparison
- prompt wording, reference ordering, reference count
- what to delete from the discard list in `docs/PLAN.md`
- refactors, but only inside files a current milestone already touches
- deploying to the operator's served build, with the rollback plist recorded first
- how to recover a failure: retry the same target immediately, never substitute another

Never ask the operator to choose, approve, architect, configure, or run anything.
If two options are close, ship the faster one and keep the other selectable.

## The one thing that waits

Only the operator can say an image looks right. When a milestone is at
`awaiting-operator`, you do **not** advance to the next milestone and you do **not**
open new surface area. You keep working the same milestone: measure more candidates,
tighten timing, harden the reference chain, add the regression for the last observed
defect. Report `READY FOR OPERATOR` with a screenshot and timings, then continue
improving that same stage until told otherwise.

Horizontal expansion while blocked is the failure that killed the previous 30 hours.

## Forbidden without an explicit current-turn operator order

- mutating a shared ComfyUI install: restart, reconfigure, clean, unload, queue-clear,
  queue-wide interrupt. Cancel only the exact prompt ID MULLET submitted.
- restoring Mage-Flow or FLUX.2 in any form
- building anything past stage [4] — no living lore, quote banks, character state,
  personal-assistant mode, memory, workspace modes, or LoRA training
- writing a unit test as the evidence for a milestone
- the words done, fixed, delivered, restored, complete, or playable below acceptance

## Test policy

Tests exist to pin defects the operator or the browser check actually observed.
Write a test when a real defect is seen; name it after the defect. Do not write tests
for coverage, for internal contracts, for byte layouts, or to feel progress.
The browser check is the evidence. `node --test` is not.

## Every session

1. Read `docs/GOAL.md`, `docs/STATE.md`, `docs/PLAN.md`.
2. Run the browser check against the served build before claiming any state.
3. Work the milestone named in `docs/STATE.md`. Only that one.
4. Rewrite the single line in `docs/STATE.md` on every commit.
5. Freeze every accepted result into `workflows/`: graph, prompt, seed, ordered
   references, output bytes, hashes, timing, served SHA.

## Progress reports

State the evidence class and the next action, in that order, briefly.
Never report a failure and stop. Diagnose it, execute every safe in-scope fix, carry
it to a verified state, then report. Escalate only when recovery needs authority you
do not have, and include the completed diagnosis and the exact remaining blocker.
