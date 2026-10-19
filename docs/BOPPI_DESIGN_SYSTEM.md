# Boppi: live brand audit and shared product specification

Source of truth: https://boppi.io/, inspected live on October 18, 2026.
Source CSS: https://boppi.io/assets/index-DFc36zh3.css.
Source document references /assets/index-o04ECX06.js and /boppi-logo.png.
Desktop viewport: 1440 x 1000. Mobile viewport: 390 x 844.
Both live layouts were inspected in the browser; neither overflowed horizontally.
Screenshots: Desktop/Boppi-brand-review-2026-10-18.x4Yo9Z/live-{desktop,mobile}.png.

## Verified palette

HSL is authoritative (from the live :root). Hex is rounded to 8-bit sRGB.

| Role | Live HSL | Hex |
| --- | --- | --- |
| Canvas | 222 31% 8% | #0e121b |
| Card/popover | 222 27% 12% | #161b27 |
| Raised/muted surface | 222 22% 18% | #242a38 |
| Border/input | 220 20% 24% | #313949 |
| Foreground | 210 25% 96% | #f2f5f7 |
| Muted text | 215 16% 68% | #a0abba |
| Primary, cyan | 188 86% 62% | #4bdbf1 |
| Secondary, periwinkle | 221 84% 72% | #7ca2f4 |
| Accent/warning, amber | 38 95% 66% | #fbbe56 |
| Destructive | 0 72% 60% | #e25050 |
| Success | 154 64% 55% | #43d696 |

No purple/blue gradient theme is being carried forward. Secondary periwinkle
is a live token, not a replacement primary. Severity uses text as well as color.

## Typography and assets

The live body declares `Nunito, ui-sans-serif, system-ui, sans-serif`, 16px/400.
Headings use 600; navigation and buttons use 500/600. Desktop hero is 68px;
mobile hero is 36px. Section headings are 24/36px, card headings 20px.
Commands and terminal output use the system monospace stack.
The live page supplies no @font-face or font stylesheet; document.fonts was
empty. Nunito is a declared preference, not a verified downloaded font. Use the
same stack and system fallback locally; do not introduce an external font request.

Use the actual /boppi-logo.png with its original multicolor shape, plus the
lowercase `boppi` wordmark. Do not recolor, redraw, or invent a substitute logo.
Local standalone reports embed the verified asset as a data URL for offline use.

## Components, spacing, and interaction

- Canvas: restrained dark charcoal. Cards: solid raised charcoal, 1px border,
  8px radius, 24px padding. The live card includes a subtle shadow-sm; custom
  glow utilities explicitly set box-shadow:none. No decorative neon glow.
- Primary: cyan fill with dark text (not white), 6px radius, weight 600.
  Live small navigation action has 6px 12px padding; hover uses primary/90.
- Secondary: transparent/surface fill, foreground text, border, 6px radius.
  Live cards hover to primary/50 border in 200ms.
- Scan command: monospace, 12px radius, card/80 fill, primary/30 border;
  hover strengthens the border. No gradient on the primary action or headings.
  The source's gradient-text class sets plain foreground, not a gradient.
- Header: background/70, backdrop blur, subtle bottom border. Responsive nav
  hides secondary marketing links on mobile, retaining logo and sign-in.
- Spacing: 4/8/12/16/24/32px scale. Live sections use 24px horizontal gutters,
  64px section padding; desktop hero 112px top/128px bottom, mobile 80px/96px.
- Product adaptation: denser 14px body, 32-44px page title, 16-24px panels,
  44px minimum interactive targets, visible cyan focus rings, reduced motion.
  These are explicit usability adaptations, not claims about the live CSS.
- Responsive: stack panels below 760px; preserve navigation on narrow devices.
  Graphs scroll inside a labeled region rather than squeezing/truncating labels.

## First 30 seconds

Lead with what was discovered, potential paths, and the next safe action.
Keep sample-data status persistent. State why the selected risk matters, then
the simulated change, resulting path count, and lost capabilities. Counts must
come from the engine view; no invented score, percentage, closure, or assurance.
Inventory and coverage are first-class sections. Technical evidence expands
on demand and never masquerades as runtime observation.

Configured means read from supported configuration. Inferred means derived
from identity/metadata/catalog. Observed requires actual runtime evidence and
is not produced by an ordinary scan. Verified means a subsequent supported
rescan checked a specific prediction, not that the entire environment is safe.
Demo before/after states are engine rescans of synthetic fixtures, not verified
changes to the viewer's machine. Monitoring remains a manual opt-in prototype.

## Graph contract

Full labels wrap into variable-height boxes; badges occupy a separate line.
Column headings must not overlap. Arrows indicate relationship direction;
dashed edges identify inference. Selecting a path isolates its evidenced chain
with an explicit option to restore context. Tool detail remains available but
is not the initial wall of nodes. Every node is keyboard-selectable with a
complete accessible name. Evidence details preserve engine IDs and provenance.

## Shared implementation

`src/design/tokens.css` is the canonical token file. Scanner HTML inlines it.
The control plane uses an identical copy in `app/brand-tokens.css`, synchronized
and checked by its local `scripts/sync-brand.mjs`. This document is the shared
specification; the control-plane design doc points here. No runtime dependency,
font CDN, tracker, remote graph library, or upload is added.
