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
