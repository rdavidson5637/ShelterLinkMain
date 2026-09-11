# ShelterLink market brief, August 2026

Second, deeper research pass. Two findings change the strategy, and neither showed up in the first round.

---

## Finding 1: the free competition is geo-locked, and you are not in their territory

The platforms everyone cites as "the free option" cannot be used by a Belfast shelter:

| Platform | Free tier | Available to Assisi? |
|---|---|---|
| POINT | Free forever, unlimited volunteers | **No.** Verified US 501(c)(3) only, US and Ukraine |
| Timecounts | Free for verified charities | **No.** US and Canada only |
| Golden | Free, unlimited volunteers | US-centric, background checks are US providers |
| Zelos | Free, unlimited members, global | **Yes.** Estonia-built, GDPR native |
| SignUpGenius | Free with ads | Yes, but it is a sign-up sheet, not a system |
| YourVolunteers | Free up to 1,000, with ads | Yes |
| Track It Forward | Free under 25 volunteers | Yes, but tiny cap |

So the realistic free field in Northern Ireland is Zelos and a couple of ad-supported sign-up sheets. Everything else with real features is paid, and the UK-specific options are not cheap:

- **Volunteero** (UK, built with UK charities, 300+ orgs, 4.7 Trustpilot): roughly $20 per volunteer per year. For 120 volunteers that is about £1,900/year.
- **Access Assemble** (UK, part of The Access Group): from £225/month billed annually, and they recommend it only for charities with 200+ volunteers.
- **VolunteerHub**: $143/month Plus, $288/month Pro, plus a setup fee.
- **Better Impact**: around $315/month at 1,000 volunteers.

The "best free platform" claim is much easier to defend than I first thought, because in the UK the free field is almost empty. But it also means Zelos is your one real free rival, and it is good.

## Finding 2: for a shelter this size, the real competitor is WhatsApp

Zelos markets to animal shelters by listing what it replaces, and this is the honest competitive set for Assisi:

> Facebook foster pleas, WhatsApp volunteer groups, email chains with vet notes, paper walking sign-out sheets, phone calls to find fosters, spreadsheet volunteer tracking.

That is what ShelterLink is actually displacing. Not VolunteerHub. Which means the features that win are the ones that kill a WhatsApp group and a paper sheet, not the ones that match an enterprise feature matrix.

Judged that way, ShelterLink currently replaces the paper sign-out sheet and the spreadsheet. It does not yet replace the WhatsApp group, the Facebook foster plea, or the phone calls.

## Other market movement worth knowing

- **Better Impact acquired Galaxy Digital (Get Connected) in March 2026.** The mid-market is consolidating; two of the names in my first brief are now one company.
- **Salesforce ended new feature development on NPSP** in 2023 and pushes Agentforce Nonprofit. The old free-CRM-plus-volunteers route is a dead end.
- **Volunteero's feature framing is instructive**: recruitment and onboarding, reference collection, native instant messaging, badges, notifications, unlimited database including a *clients* table, missions and shifts as separate concepts, templates, check-in, Zapier.
- **"Missions" versus "shifts" is a real distinction.** A shift is time-boxed. A mission is an open-ended commitment. ShelterLink models everything as a shift, which is exactly why fostering does not fit.

---

## Where ShelterLink actually stands

### Genuinely competitive already
Scheduling, waitlists, recurring shifts, check-in codes, qualifications with expiry gating shifts, waivers, custom fields, hours approval, badges, shift swaps, staff roles with audit log, GDPR export and erasure, group bookings, kiosk. That is a stronger compliance layer than Zelos and comparable to paid mid-market tools.

### The gaps that matter, in priority order

**1. No animals.** This is the big one. Every shelter-specific competitor treats animals as first-class: Zelos targets "the animals that need them most", Volunteero has a clients table, Pawlytics links volunteers to transport for named animals. ShelterLink is a generic volunteer tool with a shelter's name on it. A dog-walking shift that does not know which dogs are being walked cannot produce a walk record, cannot tell a volunteer "Bella has a harness and pulls left", and cannot show a volunteer the animals they have helped. Adding animals is what makes ShelterLink a *shelter* product rather than a scheduling app.

**2. No foster placements.** Fostering is the single highest-value shelter volunteer activity and it is not a shift. It is a placement with a start date, an open end date, an animal, a home-suitability match, and check-ins along the way. Right now a foster coordinator cannot use ShelterLink at all and stays on Facebook.

**3. No conversation.** Bulk email one way is not communication. Every current competitor has threaded messaging attached to the thing being discussed, with admin oversight and without exposing volunteers' contact details to each other. This is the feature that kills the WhatsApp group.

**4. No push, no urgency.** "We need someone at 7am tomorrow" or "this cat needs an emergency foster tonight" has no channel. Email is too slow. Competitors use targeted push to qualified volunteers only.

**5. No transport runs.** Relay legs claimed by drivers is a standard rescue workflow (Zelos and Pawlytics both do it) and has no equivalent here.

**6. No references, no AccessNI.** Volunteero's UK differentiator is reference collection and DBS-friendly workflow. In Northern Ireland the equivalent is AccessNI, and any shelter role involving under-18s or vulnerable adults needs it tracked. The qualifications table is close but does not model a check with a reference number, issue date and renewal.

**7. Contact privacy is unverified.** Zelos makes "volunteers cannot see each other's phone numbers, emails or addresses" a headline promise. ShelterLink should be able to make the same claim, and it needs an audit to prove it.

---

## Recommended positioning

Not "the best free volunteer platform". Too broad, and it invites comparison with tools that have ten years and a product team behind them.

Better: **the free, self-hosted volunteer system built for animal shelters, with the animals in it.** That claim is true, defensible, specific to a real gap in the market, and it is the reason a shelter would choose it over Zelos.

Round-4 prompts implementing all seven gaps are in `shelterlink-round4-prompts.md`.

## Sources

- [Zelos: 22 best volunteer management systems 2026](https://getzelos.com/top-volunteer-management-apps)
- [Zelos: animal shelter volunteer app](https://getzelos.com/animal-shelter-volunteer-app)
- [Volunteero](https://volunteero.org/)
- [Bloomerang: volunteer management software picks 2026](https://bloomerang.com/blog/volunteer-management-software)
- [RallyUp: 15 leading solutions 2026](https://rallyup.com/blog/volunteer-management-software/)
- [Software Advice: volunteer management comparison](https://www.softwareadvice.com/nonprofit/volunteer-management-software-comparison/)
- [Volunteer Shift Manager: best for small nonprofits 2026](https://www.volunteershiftmanager.com/learn/best-volunteer-management-software-2026)
- [Access Assemble](https://www.theaccessgroup.com/en-gb/not-for-profit/software/volunteer-management-software/)
- [Volgistics](https://www.volgistics.com/)
- [VolunteerHub](https://www.volunteerhub.com/)
