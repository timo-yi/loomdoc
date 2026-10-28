"""Known ways to break the run slot in src/ui/server.ts, mirrored as edits to model/RunSlot.tla.

    python3 -I mutants.py list               -> "name<TAB>expected TLC error (extended regex)" per line
    python3 -I mutants.py apply <name> <in> <out>

Each edit must match the model text exactly once, so a model change that invalidates a mutant
fails loudly instead of silently testing nothing.
"""
import sys

MUTANTS = {
    # The old check-then-set race (fixed in 4a3b00d): the slot is only claimed after the
    # requirements check resolves, so two requests can both pass `if (slotTaken)`. TLC reports
    # whichever slot invariant breaks first: two runs at once, or a concurrent 412 freeing the
    # slot under a live run.
    "claim-after-check": (
        "Invariant (AtMostOneRun|RunHoldsSlot) is violated",
        [
            ("       ELSE /\\ slotTaken' = TRUE\n", "       ELSE /\\ UNCHANGED slotTaken\n"),
            ("  /\\ reply' = [reply EXCEPT ![r] = 202]\n  /\\ UNCHANGED slotTaken\n",
             "  /\\ reply' = [reply EXCEPT ![r] = 202]\n  /\\ slotTaken' = TRUE\n"),
        ],
    ),
    # The 412 path forgets `slotTaken = false`: every later submission gets 409 forever.
    "412-keeps-slot": (
        "Temporal properties were violated",
        [
            ("  /\\ pc[r] = \"checking\"\n  /\\ slotTaken' = FALSE\n", "  /\\ pc[r] = \"checking\"\n"),
            ("  /\\ reply' = [reply EXCEPT ![r] = 412]\n  /\\ UNCHANGED <<activeRunId, running>>\n",
             "  /\\ reply' = [reply EXCEPT ![r] = 412]\n  /\\ UNCHANGED <<slotTaken, activeRunId, running>>\n"),
        ],
    ),
    # execute()'s finally forgets `activeRunId = null`: a reloaded page follows a finished run.
    "finish-keeps-active": (
        "Invariant ActiveRunIsRunning is violated",
        [
            ("  /\\ activeRunId' = None\n  /\\ slotTaken' = FALSE\n  /\\ UNCHANGED <<pc, reply>>\n",
             "  /\\ slotTaken' = FALSE\n  /\\ UNCHANGED <<pc, reply, activeRunId>>\n"),
        ],
    ),
}


def main() -> None:
    if sys.argv[1:2] == ["list"]:
        for name, (expected, _) in MUTANTS.items():
            print(f"{name}\t{expected}")
        return
    if len(sys.argv) != 5 or sys.argv[1] != "apply":
        sys.exit(__doc__)
    name, src, dst = sys.argv[2:]
    text = open(src, encoding="utf-8").read()
    for old, new in MUTANTS[name][1]:
        count = text.count(old)
        if count != 1:
            sys.exit(f"mutant {name}: expected 1 match, found {count}, for:\n{old}")
        text = text.replace(old, new)
    open(dst, "w", encoding="utf-8").write(text)


if __name__ == "__main__":
    main()
