# Boppi product vision

Approved by the founder on 2026-10-24 as the product direction for every engineering decision. This file is mirrored byte for byte in the scanner repo (`~/Desktop/boppi-scan-auto`) and the control plane repo (`~/Desktop/Boppi-auto`); `apps/control-plane/scripts/verify-ledger-mirror.mjs` fails when the copies differ. Future coding sessions read this file before selecting new work.

Precedence: the safety rules in each repo's `AGENTS.md` and `CLAUDE.md` come first. This vision decides what is worth building. `BOPPI_MASTER_PLAN.md` (control plane) orders the work. `BOPPI_TASK_LEDGER.md` records state and evidence.

**This direction authorizes nothing operational.** No deployment, publication, production change, hosted migration, real telemetry, personal or customer scan, device pairing, enforcement, or previously blocked security decision is unlocked by it. Founder strategy approval is not security-gate approval.

## Mission

Boppi helps people and organizations understand, manage, and control what their AI agents can access and do. It is an accessible AI-agent security and governance platform. The goal is to make AI governance understandable and useful to everyone, not only to security professionals.

## Three pillars

1. **Visibility. Know what is connected.** Which AI agents, MCP servers, applications, identities, permissions, and resources Boppi can identify.
2. **Understanding. Know what matters.** Exposure explained in everyday language and backed by actual evidence. Observed activity, configured potential access, inferred permissions, and unknowns are always told apart. Severity is never exaggerated and certainty is never manufactured.
3. **Control. Know what to do.** Permission guidance, access reviews, policy controls, remediation previews, explicit approvals, verification, and rollback. Boppi never claims to enforce a policy unless enforcement is technically verified.

## Business strategy

The immediate priority is adoption, not monetization. Boppi is free for individual users during this phase. A supported security checkup runs without an account. Optional accounts add persistent checkup history, device registration and synchronization, security changes over time, meaningful notifications, user-submitted corrections, and participation in privacy-conscious intelligence improvements. Cloud syncing and intelligence contributions each require separate, informed consent. People should discover Boppi, understand its value quickly, trust its findings, and return when something meaningful changes.

## Audiences, in order

1. **Developers and AI builders.** Users of supported AI coding assistants and MCP integrations. Accurate discovery, exposure analysis, practical remediation guidance.
2. **Everyday AI power users.** People using assistants with connected applications, files, calendars, and tools. A simpler experience with the same technical accuracy. Only integrations Boppi can genuinely inspect or control.
3. **Small teams.** Shared visibility, devices, policies, history, approval workflows.
4. **Enterprise organizations.** Identity and access governance, policy management, auditability, just-in-time permissions, verified runtime controls.

These phases set priority. They do not bypass release or security gates.

## Competitive positioning

Boppi competes in the AI-agent security and access-governance market. Benchmarks: Opal Security (enterprise identity and access governance), Snyk Agent Scan (AI-agent and MCP scanning), Zenity (AI-agent security and governance), Astrix Security (agent identities and access visibility), Runlayer (MCP governance and tool controls). Capabilities to study from public documentation: identity and access graphs, natural-language access queries, least-privilege recommendations, policy-as-code, approval workflows, just-in-time access, temporary permissions, automated access reviews, audit history, continuous monitoring, organizational governance. Useful concepts are reused through original implementation; proprietary code, designs, and branding are never copied. Boppi has no competitive advantage until user evidence shows one. The intended differentiation is making sophisticated AI governance understandable and accessible to individuals while keeping enterprise-grade security principles. The current evidence is `docs/research/COMPETITIVE_GAPS_2026-10-23.md` (control plane): overlap exists in graphs, natural-language access, approval and JIT, and runtime controls.

## Architecture

- **Boppi Agent.** Local discovery, capability analysis, graph construction, supported monitoring, privacy protection, safe user-approved remediation. The free checkup stays useful without cloud connectivity.
- **Boppi Cloud.** Optional accounts, persistent history, device inventory, authorization, synchronization, notifications, feedback, organizations, governance. Built on the existing control plane.
- **Boppi Intelligence.** A controlled learning system that improves detection through validated evidence, explicit corrections, reproducible evaluation, and reviewed rule releases. Unverified patterns and AI-generated suggestions never become production security rules automatically.

## Experience and brand

Approachable, modern, trustworthy, human. No unnecessarily intimidating security language. Someone new to AI security should understand the value within seconds. Every important finding explains: what Boppi found; why it may matter; what evidence supports it; what remains unknown; what the user can do; what the change may affect; how to verify the result. Advanced detail stays available for experienced users. The existing brand is not redesigned without founder approval.

## Growth and experiential marketing

Playful, educational experiences introduce AI governance to the public. Leading concept: **"Would You Let AI Do That?"**, an interactive social experiment where people decide what actions and permissions they would grant a hypothetical assistant. Approved for later exploration: The AI Red Flag Test; Your AI Is Your Roommate; The Permission Wall; The Boppi Checkup Bar; Your AI Has Access. Do You Have Control? Experiences use synthetic examples, clear disclosures, privacy-safe interactions, and never imply that fictional risks are real scan findings. No campaign is published without approval. No engineering work on campaigns is scheduled by this document.

## Engineering priorities

Current order: finish U-5 history correctness; complete regression and tenant-isolation tests; run full control-plane verification; rebuild the candidate; preserve every founder and security gate. Afterward, unfinished work is reconciled against: trustworthy free checkup; optional cloud accounts and history; beginner-friendly onboarding; personal access intelligence; supported personal guardrails; configuration monitoring; privacy-preserving feedback and intelligence; team governance; enterprise-grade policy and access controls; release readiness and usability validation. Verified engineering work is not abandoned or rebuilt without a reason.

## Definition of success

Not the largest number of security features. A product that people understand, trust, and adopt; that accurately explains AI access; that gives meaningful control; that improves through validated evidence; and that can eventually support organizational governance at scale. Guiding principle: Boppi should help people use powerful AI without losing control over what it can access and do.

## Reconciliation with the codebase (2026-10-24)

The five categories below are kept apart on purpose. Only the first is approved direction. Nothing in the others is a readiness claim.

### Approved product vision

Everything above this section.

### Existing implemented capabilities (local, tested, unpublished unless stated)

- Scanner `boppi` 0.3.0 is on npm. 0.4.0 (engine 1.1.0, rubric 1.0.3) is a local candidate: passive scan of Claude Desktop, Claude Code, Cursor configs; exposure paths with evidence layers (configured, advertised, observed, hypothesis); `plan`, `fix`, `verify`, rollback; `demo` sandbox; `boppi ask` grounded questions over an explicit export; opt-in `discover --server` (stdio only); foreground `watch`; hook collector and `events` timeline; SARIF, policy guard, GitHub Action. Zero runtime dependencies, no network except explicit `push`.
- Control plane (app.boppi.io runs an older look-only deploy): organizations, roles, invites; collector enrollment with versioned cloud-sync consent, withdrawal, scoped erasure; token-gated ingest with rate limit and stale-snapshot refusal; AI inventory, graph, exposure history; history comparisons withheld across incomplete, capped, legacy, or differently versioned snapshots (U-5); remediation proposal state machine as a pure module with tests, no routes, tables, or pairing.
- Intelligence: a synthetic, signed, shadow-only demonstration of observe, propose, evaluate, review, version, distribute, verify, roll back. No real feedback intake. Default grades unchanged.

### Planned functionality (not started or design only)

Beginner-friendly onboarding past the current welcome page; notifications; user-submitted corrections flowing into Intelligence; background monitoring install and cloud heartbeat (P4-4); remediation pairing, routes, and screens on top of the proposal state machine; team policies and approval workflows; just-in-time and temporary permissions; policy-as-code; automated access reviews; Phase 2 integrations beyond the three supported clients.

### Hypotheses requiring user validation

That a newcomer understands the value within seconds; that findings are trusted; that an account-free checkup drives return visits; that the seven-part finding explanation is read and acted on; that any campaign concept is shared voluntarily; that Boppi differentiates on accessibility. Zero of five Phase 0 sessions have run. No competitive advantage is assumed.

### Security and founder approval gates (open)

Rubric 1.0.3 sign-off (`docs/milestone1/RISK_RUBRIC_v1.0.3.md`, questions 1 to 4, 6, 7); five uncoached comprehension sessions; Phase 0 sessions 0 of 5; independent security review of remediation; real-device pairing and remediation pilot; retention, two-person, and rollback policies; runtime, content, and hashed-identifier consent; hosted migrations (four pending plus `collector_sync_privacy` and `snapshot_comparison_context`); backup and restore rehearsal; publication of 0.4.0 (NPM_TOKEN); merge and deployment of `codex/live-brand-alignment`; any 24-hour soak; campaign publication. The decision register is `docs/validation/FOUNDER_DECISION_REGISTER.md` (control plane).

### Strategic conflicts recorded for the founder

1. `docs/PRODUCT-VISION.md` (control plane, 2026-08) says Boppi is an enterprise SaaS control plane and not a local-first product. This document supersedes it: the free local checkup is the entry point and must work offline. The old file carries a superseded banner and is kept for history.
2. Phase 2 names connected applications, files, and calendars. Today Boppi inspects MCP configuration for three clients only. Connector-level access (for example a hosted assistant's calendar grant) has no supported evidence source yet. Building Phase 2 requires a new, inspectable integration surface, which is a founder scoping decision.
3. "Supported personal guardrails" and "configuration monitoring" are limited to foreground `boppi watch` and the opt-in hook collector. A persistent background monitor remains blocked on the founder (P4-4) and on consent design.
4. "Meaningful notifications" need a delivery channel and retention policy that do not exist. Both are founder decisions before design.
5. The dashboard's history language now says "no longer reported in comparable snapshots" rather than "closed". The pillar wording "verification" must keep meaning rescan evidence of a configuration change, never proof of effect.
