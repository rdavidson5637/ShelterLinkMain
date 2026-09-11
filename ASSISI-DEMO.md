# ShelterLink — Assisi demo talking points

Use this on the call after `DATABASE_URL` is set and `npm run db:reset` + `npm run dev` work.

## One-line pitch

**The free volunteer system built for animal shelters — with the animals in it — so Assisi can leave WhatsApp and paper behind for day-to-day ops.**

## Setup before the call (you)

1. Supabase session pooler URI on port **5432** in `.env` as `DATABASE_URL`
2. `npm run db:reset` then `npm run dev`
3. On the login page (non-prod), use the **Demo accounts** card:
   - Admin: `admin@shelterlink.org` / `Admin123!`
   - Volunteer: seed volunteer / `Password1`
4. Optional: `SHELTER_EMERGENCY_PHONE`, Brevo `EMAIL_*`, VAPID keys

## Demo flow (20–25 minutes)

### Morning ops
1. **Staff guide** → morning checklist  
2. **Day sheet** → roster, phones, emergency contacts, animal photos + handling notes, print  
3. **Week sheet** → who’s on site this week + ICS download  
4. **Animals** → handling notes; add a **welfare / incident note** (staff-only)  
5. **Urgent cover** on an understaffed shift  

### Kill WhatsApp
6. **Messages** → shift chat; names only between volunteers  
7. **Shift notes** → “bring wellies”  

### Fosters + transport
8. **Fosters** → request → match → confirm placement  
9. **Transport** → sample run with claimable legs (drivers don’t see each other’s phones)  

### Volunteer + trust
10. Volunteer dashboard: onboarding checklist, animals helped, certificate  
11. **Onboarding** admin pipeline — who’s stuck on waiver / refs / AccessNI  
12. **Privacy** page in the footer — say the contact-privacy promise out loud  
13. Phone: install PWA if you want the “app” moment  

## What you can honestly claim

| They use today | ShelterLink |
|---|---|
| Paper day / week roster | Day sheet + week sheet + ICS |
| WhatsApp | Shift threads + announcements |
| Facebook foster plea | Foster matching + placements |
| Phone tree for cover | Urgent cover (email / push) |
| Spreadsheet hours | Hours + certificates |
| “Who can walk Rex?” | Animals + quals + handling notes |
| Ad-hoc welfare memory | Staff-only incident notes |
| “Where is X in onboarding?” | Onboarding pipeline |

## Deliberately later

SMS (Twilio), donor CRM, multi-tenant hosting, native App Store apps (PWA covers phones).
