# Coauthor Proposal: LF x402 Privacy Extension (TACEO + Bermuda + zBase)

We are proposing a joint draft for an LF x402 privacy extension focused on interoperable verification, replay safety, and compliance hooks.

Draft spec:
- https://github.com/goheesheng/zx402/blob/main/beta/docs/competitive/joint-x402-privacy-spec.md

Concrete ask:
1. TACEO sanity-checks verifier interface + field schema.
2. We align on minimal conformance vectors (valid proof, replay rejection, idempotent retry).
3. We co-submit a v0.1 proposal to the LF x402 working track.

Why now:
- Third-party private x402 implementations are active.
- A shared extension surface keeps implementations interoperable without forcing one proving system.

Open decisions proposed for coauthors:
1. Nullifier format: chain-agnostic bytes vs chain-profile typed format.
2. Compliance hooks: synchronous gating vs async reporting.
3. Verifier endpoint: provider-required vs facilitator-delegated option.

If this direction is useful, we can do a 30-minute technical review call and convert outcomes into issue-backed checklist items.
