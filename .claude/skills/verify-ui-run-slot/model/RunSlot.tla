------------------------------ MODULE RunSlot ------------------------------
(***************************************************************************)
(* The single run slot of `loomdoc ui` (src/ui/server.ts, startUiServer).  *)
(*                                                                         *)
(* JavaScript runs each stretch of code between two `await`s without      *)
(* interruption, so each action below is exactly one such stretch. Other   *)
(* requests and the finishing run can only interleave at the awaits.       *)
(*                                                                         *)
(*   Claim(r)      POST /api/runs, after `await readJson(req)` resolves,   *)
(*                 up to `await options.checkRequirements(...)`.           *)
(*   CheckFail(r)  the requirements check resolves with problems (or       *)
(*                 throws): release the slot, reply 412.                   *)
(*   CheckOk(r)    the check resolves clean: record, activeRunId, and the  *)
(*                 synchronous start of execute() up to `await runner(...)`*)
(*                 (the runner is called in this step), reply 202.         *)
(*   Finish(r)     the runner settles (success or failure): execute()'s    *)
(*                 `finally` clears activeRunId and the slot.              *)
(*   Retry(r)      the same client submits again later.                    *)
(*                                                                         *)
(* Each element of Req is one client. Its run id is the client id; a       *)
(* client retries only once its own run has ended (see Retry).             *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Req, None

VARIABLES
  pc,       \* per client: "new" (body read), "checking" (awaiting checkRequirements), "sent"
  reply,    \* per client: last HTTP status sent, or 0 before the first reply
  slotTaken,\* server.ts `slotTaken`
  activeRunId, \* server.ts `activeRunId` (a client id, or None)
  running   \* clients whose runner() has been called and has not settled

vars == <<pc, reply, slotTaken, activeRunId, running>>

TypeOK ==
  /\ pc \in [Req -> {"new", "checking", "sent"}]
  /\ reply \in [Req -> {0, 202, 409, 412}]
  /\ slotTaken \in BOOLEAN
  /\ activeRunId \in Req \cup {None}
  /\ running \subseteq Req

Init ==
  /\ pc = [r \in Req |-> "new"]
  /\ reply = [r \in Req |-> 0]
  /\ slotTaken = FALSE
  /\ activeRunId = None
  /\ running = {}

\* server.ts: `if (slotTaken) { 409 } slotTaken = true;` then `await checkRequirements`.
\* (Body validation 400s happen before this check and touch no shared state, so they are omitted.)
Claim(r) ==
  /\ pc[r] = "new"
  /\ IF slotTaken
       THEN /\ pc' = [pc EXCEPT ![r] = "sent"]
            /\ reply' = [reply EXCEPT ![r] = 409]
            /\ UNCHANGED slotTaken
       ELSE /\ slotTaken' = TRUE
            /\ pc' = [pc EXCEPT ![r] = "checking"]
            /\ UNCHANGED reply
  /\ UNCHANGED <<activeRunId, running>>

\* server.ts: `if (problems.length > 0) { slotTaken = false; 412 }` (a thrown check counts as problems).
CheckFail(r) ==
  /\ pc[r] = "checking"
  /\ slotTaken' = FALSE
  /\ pc' = [pc EXCEPT ![r] = "sent"]
  /\ reply' = [reply EXCEPT ![r] = 412]
  /\ UNCHANGED <<activeRunId, running>>

\* server.ts: `activeRunId = record.id; void execute(record, body);` then 202.
CheckOk(r) ==
  /\ pc[r] = "checking"
  /\ activeRunId' = r
  /\ running' = running \cup {r}
  /\ pc' = [pc EXCEPT ![r] = "sent"]
  /\ reply' = [reply EXCEPT ![r] = 202]
  /\ UNCHANGED slotTaken

\* server.ts execute(): `finally { activeRunId = null; slotTaken = false; }`.
Finish(r) ==
  /\ r \in running
  /\ running' = running \ {r}
  /\ activeRunId' = None
  /\ slotTaken' = FALSE
  /\ UNCHANGED <<pc, reply>>

Retry(r) ==
  /\ pc[r] = "sent"
  /\ r \notin running
  /\ pc' = [pc EXCEPT ![r] = "new"]
  /\ UNCHANGED <<reply, slotTaken, activeRunId, running>>

Next == \E r \in Req : Claim(r) \/ CheckFail(r) \/ CheckOk(r) \/ Finish(r) \/ Retry(r)

\* Assumptions: every request handler gets to run, every requirements check settles, and
\* every runner settles. Retry is not fair: a client may never come back.
Fairness ==
  \A r \in Req :
    /\ WF_vars(Claim(r))
    /\ WF_vars(CheckFail(r) \/ CheckOk(r))
    /\ WF_vars(Finish(r))

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
\* The promise: at most one paid run at a time.
AtMostOneRun == Cardinality(running) <= 1

\* A run in progress always holds the slot, so the next submission gets 409.
RunHoldsSlot == running # {} => slotTaken

\* The page follows activeRunId after a reload: it names the run in progress, and only that.
ActiveRunIsRunning ==
  /\ (activeRunId # None => activeRunId \in running)
  /\ (running # {} => activeRunId \in running)

\* The slot is never stuck: once taken, it is eventually free again.
SlotReleased == slotTaken ~> ~slotTaken

\* Every submission gets an answer.
EveryRequestAnswered == \A r \in Req : pc[r] = "new" ~> pc[r] = "sent"
=============================================================================
