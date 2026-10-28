---
name: verify-ui-run-slot
description: Model-check the single run slot of `loomdoc ui` (src/ui/server.ts) with TLA+/TLC. It proves that at most one paid run executes at a time and that the slot is always released. Use whenever a change touches the POST /api/runs handler, `slotTaken`, `activeRunId`, `execute()`, or adds an `await` anywhere in that path.
---

# Verify the `loomdoc ui` run slot

## What is verified

- **Property:** across every interleaving of concurrent `POST /api/runs` requests and finishing runs, at most one runner (the paid pipeline) executes at a time. The slot is always freed again, and every submission gets an answer.
- **Harm if broken:** two runs execute at once, so the user pays twice and two runs write into `out/` together. Or the slot leaks, and every later submission gets 409 until `loomdoc ui` is restarted. This already broke once: the check-then-set race fixed in `4a3b00d`.
- **Why TLA+:** the risk is events happening in a bad order. JavaScript only switches between handlers at `await`, so a small model whose steps are the stretches between awaits covers every order. Tests cover one order per run. `test/ui-server.test.ts` "simultaneous submissions start exactly one run" uses one timing.

## Coverage record

- **Covered file:** `src/ui/server.ts`, inside `startUiServer`:
  - the `activeRunId` / `slotTaken` declarations
  - the `POST /api/runs` branch of `handle()`, from `await readJson(req)` through `sendJson(res, 202, …)`
  - `execute()`, its `try` / `catch` / `finally`
- **Sync commit:** `34dbfc1` — the commit at which the model was last confirmed to describe the covered code. It was moved from `8945d55` after #11, which changed only `serveOutputFile` and an import, outside the covered code. The model was not edited.

| Model action (`model/RunSlot.tla`) | Code it mirrors in `startUiServer` |
| --- | --- |
| `Claim(r)` | after `await readJson(req)`: `if (slotTaken) { … 409 }`, then `slotTaken = true;`, up to `await options.checkRequirements(body.url)` |
| `CheckFail(r)` | `if (problems.length > 0) { slotTaken = false; … 412 }`. A thrown check becomes `problems` through the `catch` |
| `CheckOk(r)` | `runs.set(…)`, `activeRunId = record.id`, and `void execute(record, body)`, whose synchronous part calls `runner(…)`, then 202 |
| `Finish(r)` | the runner settles, then `execute()`'s `finally { activeRunId = null; slotTaken = false; }` |
| `Retry(r)` | the same client submits again after its own run ended |

## Bounds and assumptions

- 3 clients (`Req = {c1, c2, c3}` in `model/RunSlot.cfg`). Each can retry any number of times, so run sequences of any length are covered: about 1,000 distinct states, which takes seconds.
- Fairness: every handler resumes, every `checkRequirements` call settles, and every runner settles. A runner that hangs forever is outside the model. The ffmpeg watchdog covers part of that, but the LLM call is not modeled.
- Omitted because they touch no shared slot state: body validation (400), the 415 content-type check, the auth checks, and SSE streaming.
- Not covered: a synchronous throw between `slotTaken = true` and `execute()` outside the `try` around `checkRequirements` (for example, inside `runs.set` or `randomUUID`). It would leak the slot through `handle().catch` (500). Today none of those calls can throw in practice, but the model assumes it.
- Not covered: `server.close()` during a run, several `loomdoc ui` processes (each has its own slot), and anything in the pipeline itself.

## Does my change touch this?

Run `git diff 34dbfc1 -- src/ui/server.ts`, also `git diff -- src/ui/server.ts` for uncommitted work, and read the hunks. The change touches the verification if it:

- adds, removes, or moves an `await` in the `POST /api/runs` branch or in `execute()`
- reads or writes `slotTaken` or `activeRunId` anywhere
- changes when `execute()` is called, or what can throw before it is called
- adds another way to start a run

`check.sh` reports this drift on every run, but only per file. You still decide whether a hunk is in the covered code.

## Run the check

```bash
.claude/skills/verify-ui-run-slot/scripts/check.sh
```

This needs Java (`brew install openjdk`, or set `JAVA=`) and Python 3. On the first run, it downloads `tla2tools.jar` v1.7.4 to `~/.cache/tlaplus/` and checks its sha256. Or point `TLA2TOOLS_JAR` at an existing copy of the same file.

Expected output on the code as of the sync commit:

```
MODEL: PASS (1049 distinct states found)
MUTANT claim-after-check: caught (Invariant (AtMostOneRun|RunHoldsSlot) is violated)
MUTANT 412-keeps-slot: caught (Temporal properties were violated)
MUTANT finish-keeps-active: caught (Invariant ActiveRunIsRunning is violated)
DRIFT: …
MUTANTS: 3/3 caught
```

The script exits 0 only if the model passes and every mutant is caught. `--model` runs only the model. Each mutant in `scripts/mutants.py` is a known way to break the code, mirrored in the model. It must fail, which proves the check can still fail.

Read every TLC result with the pstack `/pstack:statechart` skill. For a violation, it tells the shortest path to the bad state in plain words. For a pass, it draws how the slot moves between states. `check.sh` prints the full TLC output on a model failure. For a mutant, rerun TLC by hand on the mutated file to get its trace for `/pstack:statechart`.

## When the check fails

1. **First, check the model against the code.** Does every action in the table above still match the code, line by line? Is every stretch between two awaits still one action? A mismatch is a modeling error. Fix the model to match the code, never the other way around, and rerun.
2. **If the model matches the code,** the violation is a real bug. Report it with the TLC trace retold in code terms, for example: "request A passes `if (slotTaken)`, awaits `checkRequirements`; request B passes `if (slotTaken)` too; both reach `void execute`". Don't weaken an invariant or a fairness condition to make it pass, and don't change product code unless the user asks.
3. **If a mutant is NOT APPLIED,** the model text changed. Update its edit in `mutants.py` so it still mirrors the same code break. **If a mutant is MISSED,** the model lost the ability to see that break. Treat it as a modeling error.

## When a change to the covered code is intended

1. Update `model/RunSlot.tla` so each action again mirrors one stretch between awaits, and update the code map table above.
2. If the change adds a promise, such as a queue instead of a 409, add it as an invariant or property in the model, and add a mutant to `mutants.py` that breaks it.
3. Run `check.sh` until the model passes and every mutant is caught.
4. Move **Sync commit** forward only after confirming that the model describes the code at the new commit. Also update the expected output's state count if it changed.
