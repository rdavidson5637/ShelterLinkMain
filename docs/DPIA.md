# Data protection impact assessment (template)

Status: DRAFT TEMPLATE. Nobody has filled this in or signed it.

The charity that uses ShelterLink is the controller and owns this document.
The ShelterLink team wrote this draft from what the software stores, so the
controller has a starting point. It is not legal advice and it does not
record any decision. Every place that needs the controller's decision is
marked `CONTROLLER:` and is left blank. Do not treat a blank as "no" or as
"not needed".

The structure follows the ICO's DPIA template: describe the processing, say
why it is necessary, list the risks, list the measures, and sign it off. The
controller can move the content into the ICO's own template if they prefer.

A DPIA is needed here because the software can hold criminal-offence data
(AccessNI check status and reference numbers, UK GDPR Article 10), data about
children if a shelter allows under-18 volunteers, and free-text notes about
people.

Related documents in this repo:

- `docs/VETTING-DATA.md` — what is stored about background checks and who can see it
- `docs/runbooks/retention.md` — retention settings and volunteer erasure
- `docs/runbooks/backup-and-restore.md` — backups and the restore drill
- `docs/tenancy/design.md` — how one shelter's data is kept apart from another's
- `docs/SECURITY.md` — security controls

## 1. Who is involved

| Role | Name | Notes |
| --- | --- | --- |
| Controller | CONTROLLER: | The charity. Registered name and charity number. |
| Person completing this DPIA | CONTROLLER: | |
| Data protection lead or DPO (if any) | CONTROLLER: | |
| Software supplier | ShelterLink | CONTROLLER: confirm whether ShelterLink acts as processor and under what written terms. |
| Database host | Supabase (Postgres) | CONTROLLER: confirm the project region and that a processing agreement is in place. |
| Application host | Railway | CONTROLLER: confirm region and processing terms. |
| Email delivery | The SMTP service set in `EMAIL_HOST` | CONTROLLER: name the provider actually configured. |
| Browser push | The volunteer's browser push service (via `web-push`) | Push messages carry a title and short text. CONTROLLER: confirm what text is acceptable in a push message. |

SMS is not used. There is no SMS provider.

## 2. What the processing is for

CONTROLLER: describe the purpose in your own words. The software supports:

- recruiting and approving volunteers and fosterers
- rostering shifts, waitlists, swaps, check-in and recorded hours
- recording AccessNI check status so a shift that needs a check can only be
  filled by someone whose check is clear on that date
- collecting references from referees named by the volunteer
- messaging between staff and volunteers, shift notes and incident reports
- group and corporate bookings
- reports for trustees and funders (counts and hours, not individual detail)

## 3. What data is held

Taken from `database/schema.pg.sql`. Each shelter's rows are kept apart by
`shelter_id` and row-level security (see `docs/tenancy/design.md`).

| Area | Fields | Whose data | Notes |
| --- | --- | --- | --- |
| Account (`users`) | name, email, phone, hashed password, role, last login, privacy notice version and consent time | volunteers, staff, admins | |
| Profile (`volunteer_profiles`) | date of birth, address, emergency contact, skills, availability, volunteer type, required hours | volunteers, and the emergency contact named | Volunteer type can be `community_service`. See section 4. |
| Foster home (`volunteer_profiles`) | home type, garden, other pets, children under 16 in the home, can medicate, foster notes | fosterers and their household | Says whether children live in the home. |
| Background checks (`background_checks`) | check type (AccessNI basic, standard, enhanced, other), status (including `flagged`), reference number, issued and expiry dates, notes | volunteers | Article 10. The certificate itself is not stored. See `docs/VETTING-DATA.md`. |
| References (`volunteer_references`) | referee name, email, relationship, suitable yes/no, comments | referees and volunteers | Referee did not sign up. They receive a link by email. |
| Documents (`user_documents`) | uploaded file content, name, label, expiry | volunteers | Uploads that look like AccessNI/DBS certificates are refused by name and label. Content is not inspected. |
| Custom answers (`custom_field_values`) | answers to questions the shelter adds | volunteers | The shelter chooses the questions, so the content can vary. |
| Waivers (`waiver_acceptances`) | which waiver version was accepted and when | volunteers | |
| Shifts and hours | applications, attendance, hours, feedback, swaps, certificates of hours | volunteers | |
| Free text | messages, shift notes, incident reports, foster offer notes, admin bulk messages | anyone | Free text can contain anything someone types, including health or offence detail. |
| Group bookings (`group_bookings`) | group name, contact name and email, size, notes | contact person | Contact did not create an account. |
| Push (`push_subscriptions`) | push endpoint and keys, browser user agent | volunteers who turned push on | |
| Audit (`audit_log`, `platform_audit`) | who did what and when | staff, admins, volunteers | Changes to check reference numbers or notes are logged without the old or new text. |

Backups contain all of the above. They are encrypted (see the backup runbook).

## 4. Criminal-offence data (Article 10) and AccessNI

UK GDPR Article 10 data can only be processed under official authority or
where UK law authorises it. In the UK that means meeting a condition in
Schedule 1 to the Data Protection Act 2018, and for most of those conditions
having an appropriate policy document.

| Question | Answer |
| --- | --- |
| Which roles need an AccessNI check, and at which level? | CONTROLLER: |
| Who in the charity is a registered body or uses an umbrella body for AccessNI? | CONTROLLER: |
| Lawful basis under Article 6 | CONTROLLER: |
| Schedule 1 DPA 2018 condition relied on for Article 10 data | CONTROLLER: |
| Is an appropriate policy document needed, and where is it kept? | CONTROLLER: |
| Who may see a check's status? | Software today: staff and admins. CONTROLLER: confirm. |
| Who may see the reference number and notes? | Software today: admins, and the volunteer sees their own reference number. CONTROLLER: confirm. |
| What does `flagged` mean in practice, and who decides it? | CONTROLLER: |
| How long is a check record kept after it expires or the volunteer leaves? | CONTROLLER: no retention period is set yet. See `docs/runbooks/retention.md`. |
| Should `background_checks.notes` exist at all? | CONTROLLER: it is free text, so offence detail could be typed into it. |
| Does recording a volunteer as `community_service` reveal that they have a court order? | CONTROLLER: if yes, treat that field as Article 10 data too and decide who may see it. |

The software does not store certificates, and the upload route refuses files
named or labelled as AccessNI, DBS or disclosure certificates. That is a name
check only. A certificate uploaded under another name would be stored.

## 5. Children

| Question | Answer |
| --- | --- |
| Does any shelter allow volunteers under 18? | CONTROLLER: |
| Minimum age per shelter | CONTROLLER: the build plan makes this a per-shelter setting. Check whether it has shipped before relying on it. |
| How is guardian consent collected and recorded? | CONTROLLER: guardian consent for under-18s is planned. Check whether it has shipped. |
| Are children's details visible to other volunteers? | CONTROLLER: confirm after checking rosters and messaging. |
| Foster homes record whether children under 16 live there. Is that needed? | CONTROLLER: |

## 6. Consultation

| Who | How and when | What they said |
| --- | --- | --- |
| Volunteers | CONTROLLER: | |
| Staff and trustees | CONTROLLER: | |
| Data protection adviser (if any) | CONTROLLER: | |
| ShelterLink (supplier) | CONTROLLER: | |

## 7. Necessity and proportionality

| Question | Answer |
| --- | --- |
| Lawful basis for ordinary volunteer data | CONTROLLER: |
| Is every field in section 3 needed? Which can be turned off or left empty? | CONTROLLER: |
| How are people told? Which privacy notice version is current? | CONTROLLER: the software records the version each person saw (`privacy_notice_version`). |
| How do people get a copy of their data? | CONTROLLER: |
| How is a volunteer erased? | Software: an admin can anonymise one volunteer. Approved hours and waiver acceptances stay. See `docs/runbooks/retention.md`. CONTROLLER: confirm this is acceptable. |
| Retention periods | CONTROLLER: none set. Each row in `docs/runbooks/retention.md` needs a number. |
| International transfers | CONTROLLER: confirm the hosting regions in section 1. |

## 8. Risks

Likelihood and severity are for the controller to score. The list is a
starting point and is not complete.

| # | Risk | Likelihood | Severity | Overall |
| --- | --- | --- | --- | --- |
| R1 | Staff account is taken over and check status for every volunteer is read. | CONTROLLER: | CONTROLLER: | |
| R2 | Offence detail is typed into a free-text field (check notes, incident, message) and seen by people who should not see it. | CONTROLLER: | CONTROLLER: | |
| R3 | A certificate is uploaded under a neutral file name and stored. | CONTROLLER: | CONTROLLER: | |
| R4 | One shelter sees another shelter's volunteers. | CONTROLLER: | CONTROLLER: | |
| R5 | A backup file and its key are lost or exposed together. | CONTROLLER: | CONTROLLER: | |
| R6 | The database is lost and cannot be restored (no restore drill has been run yet). | CONTROLLER: | CONTROLLER: | |
| R7 | Data is kept longer than needed because no retention period is set. | CONTROLLER: | CONTROLLER: | |
| R8 | A child's details are collected without guardian consent. | CONTROLLER: | CONTROLLER: | |
| R9 | A referee or group contact did not expect their details to be stored. | CONTROLLER: | CONTROLLER: | |
| R10 | A push or email notification shows personal detail on a locked phone screen. | CONTROLLER: | CONTROLLER: | |

## 9. Measures

What the software already does, so the controller can judge what is left.
The controller decides whether each is enough.

| Risk | In the software now | Still open | Residual risk |
| --- | --- | --- | --- |
| R1 | Role checks on staff and admin routes. Staff cannot see reference numbers or notes. Login rate limiting. Two-factor sign-in for staff is planned, not built. | CONTROLLER: | |
| R2 | Check notes are admin-only. Audit records that notes changed, not the text. | Decide whether `notes` stays. Staff guidance on what not to type. | |
| R3 | Upload refused when name or label looks like a certificate. Other volunteers' uploads are admin-only. | Staff guidance. | |
| R4 | `shelter_id` on tenant tables with row-level security. See `docs/tenancy/`. | | |
| R5 | Backups are encrypted with AES-256-GCM. No plaintext dump is left on disk. | Who holds the key; where copies go. See the backup runbook. | |
| R6 | Backup and restore scripts with guards against restoring over the live database. | Run the drill and record it. | |
| R7 | Retention job and erasure route exist, and do nothing until a period is set. | Set the periods. | |
| R8 | Date of birth is collected. | Minimum age and guardian consent. | |
| R9 | Reference links expire. | Wording of the reference request email. | |
| R10 | | CONTROLLER: | |

## 10. Sign-off

| Item | Name and role | Date | Notes |
| --- | --- | --- | --- |
| Measures approved by | CONTROLLER: | | |
| Residual risks approved by | CONTROLLER: | | If any high risk remains, the ICO must be consulted before processing starts. |
| DPO or adviser advice | CONTROLLER: | | |
| Advice accepted or overruled | CONTROLLER: | | Give reasons if overruled. |
| Review date | CONTROLLER: | | Review when a new shelter joins, a new data field is added, or the hosting changes. |
