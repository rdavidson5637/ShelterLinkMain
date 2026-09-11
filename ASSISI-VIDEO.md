# ShelterLink - Assisi demo video

Shelter-facing walkthrough. Target length **7 minutes**. Audience is Assisi staff
and coordinators, not developers. Nothing technical goes in this cut.

Companion to `ASSISI-DEMO.md`, which is the live-call version. This is the one
they can rewatch and forward to a colleague.

## Before you record

- [ ] `DATABASE_URL` set, `npm run db:reset`, `npm run dev`, `npm run smoke` clean
- [ ] Seed data reviewed: animal names and photos should look like a real rescue,
      not `Test Dog 1`. This is the single biggest thing that makes it land.
- [ ] One shift deliberately left understaffed, for the urgent cover beat
- [ ] One foster request sitting unmatched, for the fosters beat
- [ ] Browser at 1280x720, bookmarks bar hidden, no other tabs, no extensions visible
- [ ] The login page shows a **Demo accounts** card outside production. Either
      start recording after login, or say "this only appears on my test copy"
- [ ] Zoom the browser to 110% or 125%. People will watch this on a phone
- [ ] Mic test. Room tone, no laptop fans

Do not show any real volunteer's name, email or phone at any point.

## Structure

| Time | Beat | Why it's there |
|---|---|---|
| 0:00 | The problem | Earns the next 6 minutes |
| 0:35 | What it is | One sentence, then move |
| 1:00 | Morning ops | Their most repetitive daily task |
| 2:30 | Replacing WhatsApp | Their loudest pain |
| 3:45 | Fosters and transport | The bit no spreadsheet does |
| 5:00 | The volunteer's view | Retention argument |
| 6:00 | Privacy | Pre-empts the objection |
| 6:30 | Close | What happens next |

---

## 0:00 - The problem

**On screen:** nothing yet, or a static title card. Do not open the app.

> Right now a morning at Assisi starts with a paper rota, a WhatsApp group, and
> someone phoning round to find cover. It works, because people make it work.
> But it lives in three places, and none of them talk to each other.
>
> This is one place for all of it.

Keep this under 35 seconds. Resist listing features here.

## 0:35 - What it is

**On screen:** log in as admin, land on the dashboard. Let it sit.

> ShelterLink is a volunteer system built for animal shelters, with the animals
> in it. It's free, it runs in a browser, and it's built for Assisi specifically.

Then stop talking and go straight to the day sheet. Don't tour the nav.

## 1:00 - Morning ops

**Click path:** Staff guide → Day sheet → Week sheet → Animals

1. **Staff guide.** Scroll the morning checklist. "Whoever opens up follows this."
2. **Day sheet.** This is the hero shot of the whole video. Hold on it.
   Point out: who's on, their phone numbers, emergency contacts, and the animals
   with their handling notes and photos. Hit **Print** on camera. Say out loud
   that it prints, because half the room will want paper and that's fine.
3. **Week sheet.** Who's on site this week. Download the calendar file so they
   see it drop into Outlook or a phone calendar.
4. **Animals.** Open one animal. Show the handling notes. Add a short
   **welfare note**, then say clearly that welfare and incident notes are
   staff-only and volunteers never see them.

> That's the morning rota, the phone list, and who can handle which dog, on one
> page, without anyone printing a spreadsheet at half seven.

## 2:30 - Replacing WhatsApp

**Click path:** Urgent cover on the understaffed shift → Messages → Shift notes

1. **Urgent cover.** Find the short-staffed shift. Send the cover request on
   camera. Say who gets it and how, then show it arriving.
2. **Messages.** Open a shift thread. Say the important bit: volunteers see each
   other's names, never each other's phone numbers.
3. **Shift notes.** Add "bring wellies, field is churned up". Small, but it's the
   exact thing that currently goes in the group chat at 9pm.

> Nobody has to be in a WhatsApp group with forty people to find out the field
> is muddy. And nobody's mobile number is in a group they can't leave.

## 3:45 - Fosters and transport

**Click path:** Fosters → request → match → confirm. Then Transport → sample run

1. **Fosters.** Take the waiting request, match it to a carer, confirm the
   placement. Whole flow on camera, it's about 20 seconds.
2. **Transport.** Open a run with claimable legs. Claim one. Note that drivers
   can see the run but not each other's phone numbers.

> This is the part that currently happens as a Facebook post and a lot of hope.

## 5:00 - The volunteer's view

**Click path:** log out, log in as the seed volunteer

Show the dashboard: onboarding checklist, hours, animals helped, the certificate.
Then log back in as admin and open the **Onboarding pipeline**.

> From your side, that's who is stuck, and on what. Waiver, references, AccessNI.
> No more wondering why someone signed up in March and never came in.

The certificate is worth five seconds on its own. Volunteers keep them.

## 6:00 - Privacy

**Click path:** Privacy page from the footer

Say the contact-privacy promise out loud, plainly. Mention the retention policy
in one sentence. Do not read the page aloud.

> Volunteers' details are visible to staff, not to each other. Records for people
> who stop volunteering are cleared down automatically.

## 6:30 - Close

**On screen:** back to the day sheet. End on the thing they'd use daily.

> Nothing here needs installing and there's nothing to pay for. If you want to
> try it, we can put your real rota in and you can run a week on it alongside
> the paper one.

End on that offer. Do not end on "let me know what you think".

---

## If you need a 90-second cut

Day sheet → urgent cover → fosters → privacy line. That's the whole argument.
Everything else is detail they'll ask about on a call.

## Things to avoid

- Saying "Postgres", "Supabase", "API", "deployed" or "stack". Not this audience
- Apologising for anything being unfinished. If it's not ready, don't film it
- Reading the screen out loud. Say why it matters, let the screen say what it is
- Demoing more than one thing per beat. Every extra click costs you attention
