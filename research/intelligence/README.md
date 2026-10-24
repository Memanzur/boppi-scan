# Synthetic intelligence loop

Research-only local mechanism demonstration for the updated founder directive. No real scan/feedback collection, cloud upload, model, rule activation or production signing key is involved. Nothing here is imported by the product CLI or shipped in its package.

```sh
npm run verify:intelligence
npm run intelligence:demo
# Or select a NEW directory; existing files/directories are never overwritten:
node research/intelligence/demo.mjs --out /tmp/boppi-intelligence-new-run
```

The demo prints its output directory and writes owner-only synthetic artifacts there. Ephemeral signing keys stay in memory; only public keys are written. No persistent process or device hook is installed.

## What the demo actually does

1. **Observe:** accept only fixed synthetic-package fixture metadata. Record scanner, engine and rubric versions. Unknown/private-content fields, uncontrolled subjects and unsupported capabilities are refused.
2. **Propose:** deterministic package-version-to-capability claims, supported by development fixture ids. The candidate cannot contain code, evaluation labels or an active status.
3. **Evaluate:** compare against the independent frozen fixture input, preserving the file digest, policy version, per-case false positives/negatives, counts and denominators. The fixture has four positive and four negative held-out setups; thresholds are declared in POLICY, not supplied by a candidate. Any false positive/negative, insufficient controls or unsubstantiated evidence rejects it.
4. **Review:** a separate synthetic reviewer signs the evaluation digest. This is a test of an approval boundary, **not a human approval**. Missing/declined/wrong-key reviews prevent distribution.
5. **Version/distribute:** a publisher signs a versioned inactive bundle and writes it locally; the receiver reads the serialized file. Reviewer and publisher public keys are passed separately from the bundle. Rewriting a bundle cannot establish a new trust root.
6. **Verify:** validate both signatures, recompute evaluation against the receiver's fixture input, and require compatible scanner/engine/rubric evaluation. Emit only experimental claims. These are passed to the existing scanner overlay seam in a synthetic scan: permissions and path grades must remain identical to the baseline, while two claims appear in shadow diagnostics.
7. **Rollback:** a signed receipt binds the current digest, earlier target digest and a unique nonce. Rollback verifies the target, refuses mismatches/replay, and preserves the highest seen version so a normal downgrade remains refused.

Crypto uses Node's built-in [Ed25519 signing and verification](https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key-callback), without a runtime dependency.

## Acceptance evidence and limits

Ten tests cover minimization, injection/unsubstantiated evidence, split overlap, explicit false negatives/positives, signatures, a malicious publisher, downgrade/equivocation, rollback binding/replay, and the real scanner's unchanged shadow output. The demo reports four true positives, zero false positives/negatives, precision 4/4 and recall 4/4 **on this toy fixture only**. The held-out setups reuse package identities from development to test version matching and negative controls. This is not independent-package generalization or field accuracy.

The earlier static-inspector experiment remains failed on precision. Its corpus, labels, metrics and V2 held-out protocol are unchanged. No candidate from that experiment is promoted by this demo. Existing capability overlay behavior is reused; this protocol adds no automatic loader or production update path.

A production update system still needs an independent security review, a human-approved policy for reviewer/publisher trust and key lifecycle, protected durable receiver state, transport/retention/consent design, and evaluated rules with real held-out evidence. The in-memory receiver watermark is a test contract, not tamper-proof installed state. A synthetic receipt cannot approve a production rule. File integrity proves which bytes a key signed, not that a claim is correct. Founder rubric, security, content/hashed-id consent and real-device gates remain open.
