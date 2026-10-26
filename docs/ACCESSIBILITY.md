# Accessibility

ShelterLink aims to meet WCAG 2.1 AA on volunteer-facing flows first, then admin.

## Covered

- Skip-to-content link as the first focusable control on every page (injected by `frontend/js/utils/skipLink.js`, loaded with the shared footer script). Kiosk includes the same module. The offline page, which loads no shared scripts, has the link in its markup.
- Page titles follow `Browse shifts - ShelterLink`.
- Colour (October 2026 redesign, tokens in `frontend/public/css/custom.css`): every text and background pair meets 4.5:1. Body ink is 14.2:1 on paper, secondary ink 6.9:1, brand links 7.0:1, danger text 6.0:1, confirmed text 5.7:1, white on the primary button 7.9:1. Form control borders use `--field-border` at 3.4:1 (WCAG 1.4.11). Light theme only.
- Type: Atkinson Hyperlegible Next for body and controls, 16px base, six sizes from 14px up. Times, dates and counts use tabular figures.
- Focus: one style everywhere, a 2px brand outline with a 2px offset on every interactive element.
- Status is never colour alone: status labels and badges are an 8px dot plus a word. Kiosk check-in tiles say "Checked in" or "Done for today" as well as changing colour.
- Tap targets are at least 44px on buttons, links styled as buttons, form controls, nav links and tab bar items.
- Navigation: volunteer phones get a bottom tab bar with text labels under each icon. The admin drawer below 1024px is a modal dialog: focus moves into it, Tab is trapped, Escape and the backdrop close it, and focus returns to the Menu button. More menus and the account menu close on Escape and return focus to their button.
- Native `<dialog>` elements are marked `role="dialog"` and `aria-modal="true"`. Opportunity and confirm dialogs trap Tab, close on Escape, and return focus to the trigger. In the confirm dialog the safe choice is the focused primary button and the destructive choice is red text.
- Loading placeholders are skeleton blocks marked `aria-hidden`, with a visually hidden "Loading" line or `aria-busy` where a region updates. Empty lists say so in one sentence.
- Icons are inline SVG with `aria-hidden` and always sit next to visible text or inside a labelled button. No emoji.
- Motion is limited to 120ms colour changes and skeleton pulses, and both stop under `prefers-reduced-motion`.
- Feedback rating is a radiogroup of real radio inputs, styled as stars.
- Tag chips are `aria-pressed` buttons with a visible focus ring.
- Volunteer and public forms use real labels. Failed submits show a focusable error summary and per-field messages linked with `aria-describedby`.
- Data tables have a `<caption>` (visually hidden where the panel heading already names the table) and `scope="col"` on header cells.
- Kiosk controls are at least 44px. Idle reset moves focus to the shifts heading so it does not remain on a hidden field.

## Checked

26 October 2026, axe-core 4 with the WCAG 2.0 and 2.1 A and AA rules, at 375px and 1280px, on all 14 public pages and all 13 volunteer pages, signed in through a client-side mock. No violations, apart from the FullCalendar items below. Lighthouse accessibility scored 100 on the home page and the sign-in page, mobile and desktop.

## Known outstanding

- FullCalendar on the volunteer calendar: at 375px its column header is a scroll region that is not keyboard focusable, and its day cells use `aria-labelledby` pointing at the day number, so the accessible name differs from the cell's text. Both come from the library. The list view (the List button) avoids both.
- Some browser-native date pickers remain.
- Admin filter and bulk-action forms still rely on live-region messages for some server errors rather than a summary.
- Admin pages have not had the axe pass yet.
- Automated axe or Lighthouse CI is not part of the test suite yet.
