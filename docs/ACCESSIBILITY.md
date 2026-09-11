# Accessibility

ShelterLink aims to meet WCAG 2.1 AA on volunteer-facing flows first, then admin.

## Covered

- Skip-to-content link as the first focusable control on every page (injected by `frontend/js/utils/skipLink.js`, loaded with the shared footer script). Kiosk includes the same module.
- Page titles follow `Browse shifts - ShelterLink`.
- `--text-muted` darkened to `#5a635e` so small muted copy meets 4.5:1 on white. Status badges use 14px type on tinted backgrounds.
- Native `<dialog>` elements are marked `role="dialog"` and `aria-modal="true"`. Opportunity and confirm dialogs trap Tab, close on Escape, and return focus to the trigger.
- Overflow menus and mobile nav close on Escape and restore focus to the toggle. Overflow items are keyboard operable (arrows, Home, End).
- Feedback rating is a radiogroup of real radio inputs, styled as stars.
- Tag chips are `aria-pressed` buttons with a visible focus ring.
- Volunteer and public forms use real labels. Failed submits show a focusable error summary and per-field messages linked with `aria-describedby`.
- Data tables have a `<caption>` and `scope="col"` on header cells. Directory tables switch to cards below 768px with 44px tap targets.
- Kiosk controls are at least 44px. Idle reset moves focus to the shifts heading so it does not remain on a hidden field.

## Known outstanding

- PicoCSS default form chrome is not fully restyled; some browser-native date pickers remain.
- Admin filter and bulk-action forms still rely on live-region messages for some server errors rather than a summary.
- Opportunity modal location/hours lines still use decorative emoji; they are `aria-hidden`.
- Automated axe or Lighthouse CI is not part of the test suite yet.
- Colour is not the only status cue (badges also have text labels), but charts on the admin dashboard are not in scope for this pass.
