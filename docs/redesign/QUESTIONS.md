# Questions for Ryan

Agents add questions here instead of stopping. Newest at the bottom.

## Demo logins are hidden on the local server

`/api/public/demo-info` returns `showDemoHints: false`, so the login page does not list demo accounts. Signed-in checks need a volunteer and a staff or admin user. We will not read `.env`. The hints appear only outside production, and only when `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_VOLUNTEER_EMAIL` and `DEMO_VOLUNTEER_PASSWORD` are set. Please set those for the local server, or name accounts we may use.

## C1 (Claude Code) - input border colour

The brief's `--rule-strong` (#B9B2A1) is 2.0:1 against `--surface`. WCAG 1.4.11 asks for 3:1 on form
control edges. I added one token, `--field-border: #8F8877` (3.4:1 on surface, 3.2:1 on paper), and use
it only for input, select and textarea borders. `--rule-strong` still draws the table header rule as the
brief says. OK to keep, or do you want the brief value back?

## K3 - session writes and the shelter lookup

Two server changes would cut the Atlantic wait further, after the Railway region move. They are not applied.

`server.js` sets `rolling: true` on the Postgres session store. Every API call can write the session row to keep the one-hour idle window moving. Turning rolling off, or rolling only on a timer, would drop those writes. It also changes when a session expires, so it needs your say-so.

`middleware/shelter.js` loads the user row on every `/api` request that has a session, to find `shelter_id`. The id could be kept on the session at login and refreshed when the user row changes. That is an auth and session change, so it is left here.

## C1 (Claude Code) - logged-in pages not checked

The login page shows no demo accounts, so C1 was checked on public pages and a scratch fixture of the
new components only. If there are demo logins agents may use, please add them here.

## C3 (Claude Code) - reset password length

`reset-password.html` says "At least 10 characters" but its inputs use `minlength="8"` (register uses 8 too).
The server is the real check, so I left the attributes alone. Which minimum is right? If it is 10, the
two pages' `minlength` should change to match. That is a validation change, so it needs your yes.

## C3 (Claude Code) - kiosk status 401 in the console

When the kiosk is locked, `/api/kiosk/status` returns 401 and the browser logs it as a console error.
It is expected (the tablet is not unlocked yet) but it fails the "no console errors" bar. A 200 with
`{ unlocked: false }` would fix it. That is an API change, so it is yours to decide.

## C5 (Claude Code) - logged-out 401 costs every page a Lighthouse point

Public pages call `/api/auth/me` to send signed-in people to their dashboard. Logged out, it returns 401
and Chrome logs a console error, which is the only thing keeping Best practices at 96 instead of 100 on
the home page and the sign-in page. A `200` with `null` for "not signed in" (on that route, or a new
`/api/auth/session` for this check only) would clear it. Same family as the kiosk 401 above. API change,
so yours to decide.

## P2 (Claude Code) - trimming Pico

Measured with Chrome's CSS rule coverage, 26 Oct 2026, after C1 to C5 and K4. Every public, volunteer and
admin page was loaded at 375px and 1280px (100 page loads), signed in through a client-side mock as a
volunteer and as an admin. The used rules were joined and compared with the shipped file.

| | Raw | Gzip (level 9) |
|---|---|---|
| `pico-2.1.1.min.css` as shipped | 83,319 B | 11,640 B |
| Only the rules that were used | 28,702 B | 5,758 B |
| Saving | 54,617 B (66%) | 5,882 B (51%) |

This is an upper bound on the saving. The mock returned empty lists, so states that only appear with real
data or interaction were not exercised: open dialogs, invalid form fields, tooltips, `<details>`, progress
bars mid-way, and so on. A safe trim would keep Pico's sections for those (forms, dialog, accordion,
progress, tooltip) and drop the rest (grid, nav dropdowns, cards, loading spinners, the dark theme
variables, `.contrast`/`.outline` button variants we no longer use).

Pico stays untouched for now, as the plan says. Do you want a trimmed vendor file (a build-free copy
checked in next to the original, with a test that fails if a page uses a class that was cut)?
