# Charity register lookups

Self-serve brief sections 6 and 9 item 4. Code: `services/charityRegister/`.

## What a lookup is for

A register lookup is **evidence for the platform owner**. It shows that a
charity number exists and what the register calls it. It does not prove that
the person applying speaks for that charity. No lookup result approves or
rejects anything by itself. The platform owner's one-click approval stays the
gate before any shelter goes live.

## Regulators

| Regulator | Code | Source | Live for launch |
|---|---|---|---|
| Charity Commission for England and Wales | `ccew` | Register API, `CCEW_API_KEY` | Yes |
| Charity Commission for Northern Ireland | `ccni` | Published CSV imported into `charity_register_cache` (migration 037) | Yes |
| Scottish Charity Regulator | `oscr` | Stub. `OSCR_API_KEY` name reserved | No |
| Charities Regulator (Ireland) | `cri` | Stub. Can reuse the cache table later | No |

Format checks stay in `formats.js` (PR #14). Every adapter runs them first and
never calls a register for a badly shaped number.

## Result shape

```js
{ found, name, status, removedAt, source, checkedAt }
```

| `status` | `found` | Meaning |
|---|---|---|
| `registered` | `true` | On the register now |
| `removed` | `true` | Was registered, since removed. `removedAt` is set when the register says when |
| `not_found` | `false` | The register answered and does not hold this number |
| `unavailable` | `null` | The lookup failed: network, timeout, auth, rate limit, 5xx, unreadable answer, or a status we do not recognise |
| `not_configured` | `null` | No key (CCEW), CCNI cache never imported, or regulator not live (OSCR, CRI) |
| `invalid_format` | `null` | Number fails `formats.js`. `message` is fit to show the applicant |

Some results also carry `error` (a short code such as `ccew_timeout`; never a
key or a raw response body), `message`, and for CCNI `cachedAt` (when the row
or the last import was loaded).

`needsHandCheck(result)` is true for everything except `found: true` with
`status: 'registered'`.

## When a lookup is unavailable (for PR6)

PR6 (`/start` apply) should follow these rules. Nothing in this PR
calls a lookup from a route yet.

1. **Never block an application because the register is down.** Save the
   application as `pending` with the lookup result in
   `shelter_applications.register_snapshot`.
2. **Mark it unverified.** `unavailable` and `not_configured` mean "we do not
   know". They are not "not a charity". The platform owner sees the status and
   checks the register by hand before approving.
3. **Do not tell the applicant the register rejected them.** Only
   `invalid_format` produces an applicant-facing error. `not_found` and
   `removed` go to the platform owner for a decision.
4. **Re-check is allowed.** The platform owner screen (PR5) may run the lookup
   again. Store the newest result; keep `checkedAt`.
5. **No retries in the request path.** One attempt with an 8 second timeout.
   Retrying belongs to the platform owner.

## CCNI import

CCNI has no documented lookup API. A platform owner downloads the register CSV
from the CCNI website, then:

```sh
node scripts/import-charity-register.js --regulator ccni --file ./ccni.csv --dry-run
node scripts/import-charity-register.js --regulator ccni --file ./ccni.csv
```

The dry run prints row counts and changes nothing. The importer matches a few
header names for each column and refuses a file without number, name and
status columns. Subsidiary rows and numbers that fail the NIC format are
skipped. Rows already in the cache but missing from a new file are left as
they are; `imported_at` shows how old they are. Run imports against a
non-production database first. A production import needs the same approval
as any other production write.

`charity_register_cache` is global and revoked from `shelterlink_tenant`.
`ccni.js` reads it outside any shelter context.

## CCEW API

`GET https://api.charitycommission.gov.uk/register/api/charitydetails/{number}/{suffix}`
with header `Ocp-Apim-Subscription-Key`. The adapter reads `charity_name`,
`reg_status` (`R` registered, `RM` removed) and `date_of_removal`. These field
names follow the published API definition and have not been checked against a
live key. Check them once a key exists, before PR6 relies on the result.
`CCEW_API_URL` overrides the base URL for a test double only.
