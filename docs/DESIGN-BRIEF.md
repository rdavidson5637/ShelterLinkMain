# ShelterLink design brief

Written for `SL-NEXT-02`. Implement in `SL-NEXT-03` and later small PRs. This document is the starting point for the redesign. Draft PR #31 (`lane/sl-design-pro`) is **not** a base to polish or merge into.

## Product and job

ShelterLink is a volunteer management system for animal shelters. Assisi is the likely first live shelter. The product replaces paper rotas, WhatsApp groups, and spreadsheet hours with shift booking, animal-aware day sheets, onboarding, and hours logging.

**Primary audiences**

1. **Volunteers** on a phone: register, get approved, pick shifts, check in, log hours.
2. **Staff / admin** on a desk or tablet: day sheet, urgent cover, animals, onboarding pipeline.
3. **Public visitors**: understand the shelter, see open shifts, start registration.

**Design job.** Feel like a tool built for this sanctuary, not a SaaS marketing template. Calm, specific, and usable with wet hands and low patience. Public pages sell volunteering with real place and animals. App screens prioritise the next action over decoration.

## References (study these; do not copy layouts)

Use live products, not AI template galleries or generic “charity website” packs.

| Product | Why it matters for ShelterLink |
| --- | --- |
| [Battersea](https://www.battersea.org.uk/) | Animal charity with strong photography, plain CTAs, and shelter-specific voice without slogan fog. |
| [Dogs Trust](https://www.dogstrust.org.uk/) | Clear volunteer and adopt paths; warmth without sticky-card grids on every section. |
| [Blue Cross](https://www.bluecross.org.uk/) | Service pages that lead with what to do next; readable forms and help content. |
| [National Trust](https://www.nationaltrust.org.uk/) | Place-led imagery and membership/booking clarity; good model for “this location” branding. |
| [Calendly](https://calendly.com/) | Slot picking that stays quiet: one primary action, dense but scannable times. |
| [ClassPass](https://classpass.com/) (browse / book flows) | Mobile-first session lists: time, place, capacity, one tap to continue. |
| [GOV.UK Design System](https://design-system.service.gov.uk/) | Form patterns, error summaries, focus states, and copy that says the next step. Borrow behaviour, not the black-and-yellow look. |
| [GoodGym](https://www.goodgym.org/) | Volunteering product with character in type and copy; proves charity tools need not look institutional-grey. |

When stuck, prefer Battersea or Dogs Trust for public tone, Calendly or ClassPass for shift lists, and GOV.UK for forms and errors.

## Direction for SL-NEXT-03

One coherent visual system. Do **not** stack a third skin on top of Pico + `custom.css` + draft #31. Prefer:

1. Keep Pico only where it still earns its keep (forms, reset), or replace contested pieces deliberately.
2. Put ShelterLink tokens and layout in one owned stylesheet (today: `frontend/public/css/custom.css`).
3. Public and volunteer surfaces first; admin can follow the same tokens with denser tables.

**Idea.** Shelter mornings: mud, leads, printed day sheets, named animals, short messages. The UI should feel like that clipboard and those photos, not a startup landing page.

## Colour

**Platform default (use these until a second shelter needs its own theme).** Already in `custom.css`; do not invent a new Assisi palette in this brief.

| Role | Token (approx.) | Use |
| --- | --- | --- |
| Brand | `--green` `#0f766e` | Primary buttons, links, focus, active nav |
| Brand hover | `--green-hover` `#115e59` | Hover / pressed primary |
| Brand tint | `--green-tint` / `--green-tint-border` | Soft selected rows, chips |
| Accent | `--accent` `#f59e0b` | Pending / attention marks only; dark ink on amber |
| Ink | `--text` `#1f2937` | Headings and body |
| Muted | `--text-secondary` | Supporting lines; keep AA contrast |
| Page / surface | `--page-bg` / `--surface` | Flat backgrounds |
| Danger | `--danger` | Errors and destructive actions only |

Rules:

- One brand colour, one accent. Everything else is a tint of these or neutral ink.
- No purple or blue gradients, no gradient text, no glow blobs, no frosted glass.
- Headings stay ink; do not colour every title with brand teal.
- Status must never rely on colour alone (label + tint, as today).
- **Per-shelter colour** (`SL-LATER-10`): admins set `primary_colour` in branding settings. Public/volunteer pages map it onto the same token roles (`--green` and tints) when WCAG AA contrast against white passes; otherwise the platform teal/amber set stays. Do not guess Assisi’s print or website palette.

Dark mode may keep following system preference with the existing token remap; do not invent a second art direction for dark.

## Typography

Today’s stack is system / Inter-like via Pico. The redesign must leave that.

- **Display:** one characterful family for page titles and section heads (load via self-hosted files or `next/font`-equivalent for this static site: vendored `@font-face`, no runtime Google Fonts link dependency if avoidable).
- **Body:** one quiet sans for UI, forms, and tables.
- Two families maximum. Never Inter, Roboto, Arial, Open Sans, or bare system UI as the display face.
- Fixed scale of six sizes (already sketched as `--text-xs` … `--text-2xl`). Do not add label/caption one-offs.
- Body measure about 65–75 characters; body line-height 1.5–1.7; headings 1.05–1.2.
- Sentence case for headings unless a shelter brand is deliberately all caps (platform default: sentence case).

Suggested pairing for implementation (change only with a reason written in the PR):

- Display: **Fraunces** or **Source Serif 4** (warm, readable at large sizes).
- Body: **Source Sans 3** or **IBM Plex Sans** (clear on small phone UI).

## Grid and layout

- Spacing on an **8px** grid. One section spacing token (today `--section-gap`; make it generous and consistent on public pages).
- Content max width stays near `--content-max-width` (1160px) for app chrome; public marketing sections may go full-bleed for imagery only.
- Prefer **ruled rows** and lists for “ways to help”, shift lists, and settings: title, one line, affordance. Not equal-width icon tiles.
- Maximum **one** equal-width card grid per page, and only when the card is the interaction container (for example a shift you can open). If removing border/shadow/radius does not hurt understanding, it should not be a card.
- Alternate rhythm: at least one full-bleed image (or solid type-led) block and one quieter content block on public pages. Do not default to hero → stat strip → three cards → testimonials → CTA banner.
- Mobile (390px): no horizontal scroll; tap targets ≥ 44px; inputs ≥ 16px to avoid iOS zoom.

## Containers and chrome

Pick **one** container language for the whole product and stick to it:

- Preferred: **bordered panel / ruled row** on a flat page background (matches ops tools and day sheets).
- Avoid soft multi-layer shadows and large `rounded-2xl` marketing cards as the default.
- Existing radii (`--radius-card` 8px, `--radius-control` 6px) may stay for controls; do not grow them into pill-everything.
- Motion: colour/background/border only, short (about 120ms). Respect `prefers-reduced-motion`. No parallax, no bouncing decoration, no fade-up on every section.

## Photography and media

- Use **real shelter photographs** supplied by the client (animals, grounds, volunteers at work). Crop to one aspect ratio per set.
- No stock-looking illustrations, emoji decoration, or generic icon packs as section filler.
- If a required photo is missing, use a clearly labelled placeholder and list it in the PR; do not invent animals, people, or locations.
- Today the repo ships logo/icons under `frontend/public/images` and `frontend/public/icons` only. Treat animal photography as a content dependency for SL-NEXT-03, not something to fabricate.
- Decorative emoji in opportunity chrome (noted in `docs/ACCESSIBILITY.md`) should be removed or replaced with text/status in the redesign.

## Copy voice

Plain, specific, human. Say what the shelter does, where, and what to do next.

- Good: “Browse open shifts at Assisi, apply, and log your hours.”
- Bad: slogan stacks and filler (“elevate your volunteering journey”).

**Banned words and patterns:** seamless, elevate, unlock, passionate, journey, crafting experiences, leverage, synergy, “we take pride”, “look no further”, “second to none”, “welcome to”, em dashes.

Do not invent testimonials, stats, awards, prices, opening hours, or town names. If the homepage needs a place name, it must come from real shelter data (see `SL-NOW-07`). Do not claim booking, payments, or SMS features that are not live.

Primary actions: one clear CTA above the fold on public pages (“Become a volunteer” / “See open shifts”). Secondary is a text link. Phone or email stays visible in header or footer when the shelter has published contact details.

## Surfaces and page jobs

| Surface | Job |
| --- | --- |
| Public home | Name the shelter, one reason to volunteer, one primary CTA, real image when available |
| Open shifts | Scan time, role, places left; apply or sign in |
| Register / login / invite | Forms first; GOV.UK-like errors; no marketing chrome |
| Volunteer dashboard | Next shift, onboarding gaps, hours; not a promo wall |
| Staff day sheet / kiosk | Dense, printable, high contrast; brand stays quiet |
| Admin tables | Same tokens; ruled density over cards |

## Accessibility and quality bar

- WCAG 2.1 AA on volunteer-facing flows first (see `docs/ACCESSIBILITY.md`).
- Visible focus rings using brand tokens; skip link first.
- Contrast AA on text over photos via a real scrim, not a faint wash.
- Lighthouse accessibility target 95+; no layout shift on image load; no console errors on happy paths.
- `npm test` and `npm run test:security` stay green; design PRs should not weaken auth, tenancy, or form handlers.

## Banned patterns (hard)

Do not ship any of these in SL-NEXT-03 or follow-on polish:

1. Identical rounded cards in a three-up or six-up grid as the default section.
2. Icon or emoji grids as “features”.
3. Gradient blobs, mesh backgrounds, or glow accents.
4. Filler or slogan copy; fake quotes or stats.
5. Polishing or merging draft #31 as the redesign base.
6. A second competing primary button beside the hero CTA.
7. Hero clutter: stat strips, schedule snippets, floating badges, or promo chips on the first viewport.

## Out of scope for this brief

- Implementing CSS or HTML (that is `SL-NEXT-03`).
- Approving shelters, contacting Assisi, or inventing brand assets.
- Per-shelter colour UI is `SL-LATER-10` (uses `primary_colour` from 036 plus logo storage key in 049).
- SMS, paid imagery, or new third-party font CDNs that break offline/PWA assumptions without a decision in the implementing PR.

## Handoff to SL-NEXT-03

1. Read this file before touching layout CSS.
2. Start from `origin/main`, not from draft #31.
3. Ship small PRs: public home + opportunities, then auth/register, then volunteer dashboard; admin last.
4. Replace or strictly contain Pico; one owned token file; delete dead #31-only styles if they ever land by mistake.
5. List missing photographs and unresolved Assisi brand assets as TODOs in each PR. Do not fake them.
