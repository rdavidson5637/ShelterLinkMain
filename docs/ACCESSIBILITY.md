# Accessibility

ShelterLink aims to meet WCAG 2.1 AA on volunteer-facing flows first, then admin and staff.

Public statement: [`/pages/accessibility.html`](../frontend/pages/accessibility.html) (linked from the site footer).

## Covered

- Skip-to-content link as the first focusable control on every page (static markup, reused by `frontend/js/utils/skipLink.js` without injecting a second link). Main landmarks are focusable (`tabindex="-1"`). Kiosk can still receive an injected skip link when none is authored.
- Page titles follow `Browse shifts - ShelterLink`.
- Redesign palette in `frontend/public/css/custom.css`: ink, muted, teal brand, amber accent with dark ink, danger. Status badges use tinted backgrounds plus text labels. Automated contrast checks live in `test/a11yRedesign.test.js`.
- Visible keyboard focus: `:focus-visible` ring uses brand teal. Mouse click focus is quiet; keyboard always shows the ring.
- `prefers-reduced-motion: reduce` disables transitions and animations in `custom.css`.
- Native `<dialog>` elements expose an accessible name (`aria-labelledby` / `aria-label`). Opportunity and confirm dialogs trap Tab, close on Escape, and return focus to the trigger.
- Overflow menus and mobile nav close on Escape and restore focus to the toggle. Overflow items are keyboard operable (arrows, Home, End).
- Feedback rating is a radiogroup of real radio inputs, styled as stars.
- Tag chips are `aria-pressed` buttons with a visible focus ring.
- Volunteer, public, and staff forms use real labels (`for` / wrapping `<label>`). Failed submits show a focusable error summary and per-field messages linked with `aria-describedby`.
- Data tables have a `<caption>` and `scope="col"` on header cells where used. Directory tables switch to cards below 768px with 44px tap targets.
- Kiosk controls are at least 44px. Idle reset moves focus to the shifts heading so it does not remain on a hidden field.
- Animal thumbnails next to the animal name use empty `alt` (and `aria-hidden`) so the name is not doubled for screen readers. Poster QR images have descriptive alt text.
- Headings stay in order on redesigned public, volunteer, and staff pages (one `h1`, no skipped levels). Certificate sheet title is styled text, not a second `h1`.
- Staff sidebar chrome uses a plain label (`.sidebar-nav-label`), not a heading, so the page `h1` remains the first heading. The install prompt title is also not a heading for the same reason.

## Automated checks

`test/a11yRedesign.test.js` and `test/accessibilityStatement.test.js` (run with `npm test`) assert:

- WCAG AA contrast for the redesign token pairs, and that `--accent` is not used as body text colour
- `:focus-visible` and `prefers-reduced-motion` rules in `custom.css`
- Well-formed landmarks (single `body`, single skip link before `#main`)
- Heading order and labelled form controls on redesigned public / volunteer / staff HTML
- One `h1` and a `#main` skip target on every staff and volunteer HTML page
- `alt` on static and key dynamic `<img>` markup
- Named `<dialog>` elements on those pages
- Accessibility statement page, footer link, and staff chrome / skip-link source guards

## Known outstanding

- PicoCSS default form chrome is not fully restyled; some browser-native date pickers remain.
- Admin filter and bulk-action forms still rely on live-region messages for some server errors rather than a summary.
- Full axe / Lighthouse CI in a real browser is not wired yet; markup and contrast tests cover the static redesign surface.
- Colour is not the only status cue (badges also have text labels), but charts on the admin dashboard are not in scope for this pass.
