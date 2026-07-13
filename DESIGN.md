# VeryGoodWallet Design System — "Intaglio"

The wallet's visual identity is drawn from the material culture of engraved security
documents — banknotes, passports, certificates — rather than app-design defaults.
**Deep petrol ground, banknote-cream ink, guilloché line-work, seal red for action,
engraver's gold for authority.** The State of Utopia, in currency form.

Canonical implementation: `apps/wallet/src/index.css` (tokens + primitives) and
`apps/wallet/src/services/color.ts` (card engraving tints). This document is the
reference for extending the identity to other surfaces (the Utopia DMV issuer site
shares this civic identity; the demo verifier sites get deliberately distinct brands).

## Principles

1. **The dark petrol world is the brand.** It renders unconditionally for everyone,
   independent of OS color scheme. A designed (not inverted) "banknote paper" light
   set exists, parked behind `:root[data-theme="light"]` for a future explicit toggle.
2. **Gold means authority, never interaction.** Seals, issuer names, "Verified"
   wordmarks, section eyebrows. Gold is never a button.
3. **Seal red means action.** Primary buttons, focus rings, selection. Destructive
   red shares the family, so destructive controls always carry explicit text labels.
4. **Cards are physical objects.** Credential cards keep their dark petrol guilloché
   face in both themes, like real cards in a real wallet.
5. **One proof moment.** The verify-success state is the signature flourish
   (seal + gold wordmark); everything around it stays quiet.

## Color tokens

Semantic names are stable; values below are the tuned (AA-checked) finals.
Registered for Tailwind via `@theme inline` → `bg-canvas`, `text-ink`, `text-gold`, etc.

| Token | Dark (default) | Light (parked) | Role |
|---|---|---|---|
| `canvas` | `#0c1f21` | `#ece8db` | page ground (deep petrol / banknote paper) |
| `surface` | `#12292c` | `#f6f3ea` | panels |
| `raised` | `#173437` | `#fdfbf4` | cards-on-panels, popovers |
| `overlay` | `rgb(4 12 13 / .72)` | `rgb(25 40 38 / .40)` | scrims |
| `line` | `rgb(201 168 106 / .16)` | `rgb(23 48 45 / .14)` | hairlines (gold-biased in dark) |
| `line-strong` | `rgb(201 168 106 / .30)` | `rgb(23 48 45 / .26)` | emphasized borders |
| `ink` | `#ece7d3` | `#16302e` | primary text (banknote cream / petrol ink) |
| `ink-dim` | `#c2bfae` | `#46605c` | secondary text |
| `muted` | `#8fa39b` | `#6d827c` | tertiary/labels |
| `accent` | `#c93b3b` | `#b93a3a` | seal red — primary actions, focus, selection |
| `accent-soft` | `rgb(201 59 59 / .14)` | `rgb(185 58 58 / .10)` | red washes |
| `accent-contrast` | `#fdf6ee` | `#fdf6ee` | text on seal red |
| `danger` | `#e07e7e` | `#9c2f2f` | destructive text (oxblood base lives in the wash) |
| `danger-soft` | `rgb(176 54 54 / .14)` | `rgb(156 47 47 / .10)` | destructive washes |
| `ok` | `#4fae83` | `#29704f` | success/verified (banknote verdigris) |
| `ok-soft` | `rgb(79 174 131 / .12)` | `rgb(41 112 79 / .10)` | success washes |
| `gold` | `#c9a86a` | `#7a6128` | authority marks only |
| `gold-soft` | `rgb(201 168 106 / .14)` | `rgb(143 116 52 / .12)` | authority washes |

Tuning history (kept deliberately): seal red deepened from the mockup's `#d64545` for
4.5:1 cream-on-red; dark danger lightened from oxblood `#b03636` (2.3:1 as text on
petrol); verdigris lifted from `#3d8f6a`; light gold/ok deepened for 11px text. Known
residual tradeoffs: `muted` ≈3.3:1 on light canvas (decorative labels only) and primary
button `hover:brightness-110` transiently dips cream-on-red to ≈4.3:1.

## Primitives

- **`.guilloche`** — card-face treatment: two corner-offset `repeating-radial-gradient`
  line fields over the petrol plate `linear-gradient(150deg, #143134, #0f2629)`. Line
  inks are exposed as `--guilloche-line-a` / `--guilloche-line-b` custom properties.
- **`.seal-authority`** — the engraved red seal:
  `repeating-conic-gradient(#d64545 0 8deg, #b03636 8deg 16deg)` circle with an inset
  ring. Used as the card authority mark and in the verify-success moment.
- **Card engraving tints** (`services/color.ts`) — a credential's `colorSeed` picks one
  of four line-work inks via FNV-1a hash: **cream, gold, verdigris, faded-red** — the
  way denominations of one currency share a printing style. The plate never changes.

## Typography

- Sans: system stack (SF Pro / Segoe UI lineage). Mono: `ui-monospace` stack for DIDs,
  serials, hashes, protocol payloads — anything cryptographic is set in mono.
- **Eyebrows/wordmarks**: small caps via uppercase + `letter-spacing: 0.14–0.22em`,
  usually gold. Keep gold text ≥ 0.7rem.
- Display lines (hero thesis) in cream, with fine gold rules/diamond flourishes as
  ornament — engraving, not gradients.

## Motion

`--animate-rise` (0.45s, `cubic-bezier(0.22,1,0.36,1)`) and `--animate-fade` (0.3s)
only; both stilled under `prefers-reduced-motion`. Card hover is a small translateY.
No ambient/looping animation — engraved things do not shimmer.

## Extending to new surfaces

- **Utopia DMV (issuer)**: same tokens; may add its own crest/seal but must follow the
  gold-is-authority and seal-red-is-action rules.
- **Verifier demo sites (Nightcap, Utopia Wheels)**: intentionally different brands
  (they are third parties in the story) — do not reuse Intaglio tokens; only the
  embedded credential cards keep their petrol faces, since the card belongs to the wallet.
- **Inspector-style technical panels**: quiet mono + muted, with a restrained gold tick
  reserved for cryptographic moments (derive/sign/encrypt/prove).
