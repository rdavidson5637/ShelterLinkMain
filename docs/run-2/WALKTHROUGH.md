# Walkthrough, 2 Nov 2026

Local database only. New account `walk-i6-20261102@example.test`, name Walk Tester. Email settings in `.env.local` were left blank. No email was seen, and none was expected.

Widths are 1280 unless the step says 375. A step is recorded only if it was done.

## Volunteer

1. Create an account. 1280. The form accepted the name, phone, a long password, and the privacy tick. The page then moved to sign in. The intro says "Assisi Animal Sanctuary ." with a space before the full stop. The same page at 375 did not scroll sideways. That 375 check was the empty form only.

2. Sign in as the new account. 1280. Landed on Home, heading "Hello, Walk". No sideways scroll. At 375 the same page has a bottom bar (Home, Shifts, Hours, Messages, More) and did not scroll sideways. Before the profile was saved, Home said the profile was incomplete and every onboarding row said "Onboarding: 1 of 5 steps done". A bar said "ShelterLink has been updated" with Reload and Dismiss. Qualifications had a heading and no sentence under it. Copy link was on the page while the text said the calendar link appears after approval.

3. Open the profile. 1280. The control named "Complete your profile" took focus and the page stayed on Home. The profile URL was opened directly. Required fields were date of birth, emergency contact, address, and availability. Labels are title case (Date of Birth, Emergency Contact, Relevant Skills). Interests include a chip named "admin". Dogs stayed selected after a reload. The page says browser push is not configured and that email alerts still work. No email was received. Saved details were still there after a reload. No sideways scroll.

4. Find a shift, before approval. 1280. Nine shifts listed. The first detail was Weekly Dog Walking on Tue 3 Nov 2026. The date line repeats the same day. The list says "3 of 4 places left" and the detail says "1 of 4 spots filled". The only action was a link, "Profile pending approval". Bella's handling note uses a long dash. At 375 the page did not scroll sideways. The first screen is the filter form. The line "Showing 9 of 9 available shifts" sits against the bottom bar.

5. Log hours, before any application. 1280. The shift list contained only "No approved applications found". Recent hours said "No hours logged yet". The field is labelled Opportunity. No sideways scroll.

6. Messages, before a shift. 1280 and 375. "No threads yet." A control named "Post an announcement" changes the address to `#announcementForm`. There is no form with that id, and nothing else appeared. No sideways scroll.

7. Find a shift, after staff approved the profile. 1280. Weekly Dog Walking now offers "Apply for this Shift". The browser asks "Apply for this shift?" and then says "You need additional qualifications for animals on this shift: Bella (Dog Handling)". The detail had already said Bella requires Dog Handling, and the button was still Apply. Cattery Care and Socialisation has no animal requirement. Applying closed the detail and did not say the application was sent. Your applications then showed that shift as Pending, applied 2 Nov 2026, with Cancel application.

8. Messages, after the cattery application was accepted. 1280. Still "No threads yet", and the announcement control is still there. The shift chat was not opened from the shift detail.

9. Log hours, after the cattery application was accepted. 1280. The list contained Cattery Care and Socialisation. Submitting 3 hours for 6 Nov 2026 showed "There is 1 error in this form. Cannot log hours for future dates". Recent hours stayed "No hours logged yet".

## Staff

Signed in as the seeded admin (Ciara).

10. Today. 1280. Heading "Today at Assisi Animal Sanctuary". It listed applications waiting and hour logs to approve. Two of those hour rows name the shift "Opportunity". No sideways scroll.

11. Volunteers. 1280. Walk Tester was Pending. View shows the profile, foster approval, background check, and references. It does not contain Approve for the volunteer. Approve is under More actions on the row. The first click on Approve was covered by the footer. After scrolling the row up, Approve worked. The page said "Volunteer approved successfully" and the row became Approved. A privacy bar appeared: "Please read the privacy notice ." with a space before the full stop, and the buttons "I have read it" and "Not now". Not now was covered by the top bar on the first try.

12. Shifts. 1280. The list loaded open and closed shifts, with Edit, Duplicate, Open shift chat, Close, and Print code. The page button says "Create opportunity" while the heading is Shifts. The edit form uses title case (Start Date, Max Volunteers). This was the rota that was opened. The week sheet was not opened.

13. Day sheet. 1280. 2 Nov 2026 said "No shifts on 2026-11-02." 3 Nov 2026 loaded Weekly Dog Walking, "Roster for 2026-11-03", code WKLY9N, and Alex Jenkins with check-in `not_checked_in`. The qualifications cell was a dash. The privacy bar appeared again. Not checked at 375.

14. Kiosk. 1280. Staff unlock with the seeded admin showed "No shifts scheduled for today" and a Lock control. No check-in code was entered, because there is no shift today. At 375 the same empty state did not scroll sideways. Lock then said "Kiosk locked."

15. Sign in while the kiosk was still unlocked. 1280. Signing in as Walk Tester on the same browser put "Kiosk session cannot access this endpoint" on the email field and stayed on sign in. After Lock, the same sign-in reached Home.

16. Applications. 1280. Walk Tester's cattery application was Pending. Approve removed it from the pending list. Under Accepted it showed Accepted, and the row still had an Approve button. No confirmation sentence was seen. Not checked at 375.

## Not reached

These were not done in the first walk. The second walk below covers them. Email settings were still blank.

- Week sheet.
- A check-in code on the kiosk.
- A message thread, a reply, or the shift chat button after acceptance.
- Logging hours for a date that has already happened.
- Forgot password.
- References and the background check, beyond seeing them listed.
- Cover this shift.
- Day sheet, the staff shift list, and application review at 375.
- Any email. The settings were blank on purpose.

## Second walk, 2 Nov 2026

Same local database and the same Walk Tester account. One shift was created for today so the kiosk had a code to try: Reception cover, 14:00 to 15:00, code SBEHGW. Walk Tester applied and the application was accepted before the kiosk step. Widths are 1280 unless the step says 375.

1. Kiosk check-in. 1280. Staff unlock asked for an email and a password. After unlock, today listed Reception cover at 14:00 and the volunteer as "Walk T." The code SBEHGW returned "Checked in. Welcome!" At 375 the page did not scroll sideways, and the same button then said Checked in. Lock returned to Staff unlock. Signing in as Walk Tester after that lock reached the volunteer pages.

2. Shift chat. 1280. Messages first said "No threads yet." Open shift chat on the accepted application opened a thread named Reception cover, Shift #16. The thread time was "02/11/2026, 16:15:10", not the "2 Nov 2026" form used on applications. A reply, "On my way to reception.", appeared under Walk Tester with the same numeric time, and a Delete control. Participants were Walk Tester and Ciara Gallagher.

3. Hours for a past date. 1280. One hour on 1 Nov 2026 was logged against Reception cover, whose shift is 2 Nov. The page said "Hours logged successfully!" Recent hours showed 1 Nov 2026, Reception cover, 1.00, Pending. The page also says hours can be logged once the shift has happened. The past date was accepted even though it is the day before the shift.

4. Week sheet. 1280. The heading was "Week of Today - Sun 8 Nov (5 shifts)". Reception cover listed Alex Jenkins, phone shown, check-in "Not checked in", Places 1 / 4. The Monday of the week is called Today rather than a date.

5. Forgot password. The email field was left blank. Send reset link did not submit. The field said "Please fill in this field." No reset was requested. The page says a link will be sent. Email settings were still blank, so this was not taken further.

6. References. 1280, on Walk Tester's staff profile. The section started as "No references requested yet." A request for Pat Example at pat.example@example.test then said "Reference request emailed to referee." and the row said requested. The server log said the email failed because EMAIL_HOST and EMAIL_FROM are missing. The page still said the email was sent. Background checks on the same profile said none were recorded. That form was not submitted.

7. Cover this shift. 1280. Ask someone to cover opened a dialog, "Request a shift swap?", with Keep shift and Ask for cover. After Ask for cover the application said "Waiting for someone to cover". Signed in as Alex Jenkins, Find a shift showed Cover a shift for Reception cover, with Cover this shift. Confirming the claim moved the accepted place to Alex. Walk Tester's application became cancelled, and it still showed as checked in. Alex's new application is accepted and not checked in.

8. Day sheet. 375. "Roster for Today" listed Reception cover, Places 1 / 4, and Alex Jenkins as Not checked in. The page did not scroll sideways.

9. Staff shifts. 375. The button says Create shift. The list had 16 rows. The page did not scroll sideways.

10. Application review. 375. Pending showed Siobhan Hughes for Cattery Care and Socialisation, 1 Nov 2026, and Eoin Roberts for Morning Dog Walking, 31 Oct 2026. Each card had Approve and More actions. The page did not scroll sideways. Approve was not clicked.

## Phone width, pages the walks had not opened, 2 Nov 2026

Findings only. Width 375. Local server on port 3000, signed in as Ciara Gallagher for staff pages and Alex Jenkins for volunteer pages. No rows were added, approved, declined, cancelled, deleted, or erased. The document width stayed at 375 on every page measured below. Console messages were not captured.

Shared on these pages: the skip link measured about 146 by 40, and the footer Privacy link about 44 by 19. The volunteer privacy bar's accessible name was "Please read the privacy notice . It says what we hold about you." The privacy notice link in that bar measured about 97 by 21.

### Staff

Animals. All showed Bella, Miso, Pip, and Rex. The species column read dog, cat, and small_animal, and the status read available. Edit measured 36 by 44. Edit Bella filled the form in place, headed "Edit Bella", with arrival date 2026-09-23 and sex "female". Cancel edit returned to Add animal. Nothing was saved. Activity for Miso opened "Activity: Miso", "No activity logged yet.", and "No incident notes yet." An incident note was not added. Cat showed only Miso. Other showed "No animals yet." and "Add an animal".

Fosters. Open requests said "No open foster requests." Active placements said "No active placements." The animal list in the new-request form included "Pip (small_animal), available". The six requirement checkboxes measured 20 by 20. A request was not created, so a list of one or many was not on screen.

Transport. One run: "Rex transfer to foster · 2026-11-05 · open · 0/3 legs claimed · Rex", with three unclaimed legs. The new-run form already showed two leg rows, each with Remove. Chase for cover and Cancel run were on the run. They were not pressed: both submit straight away, with no confirm step. The animal list used the same raw species labels as fosters. A second run was not in the list.

Shift feedback. Unfiltered: "4.00" and "2 ratings". Rows were 20 Oct 2026, Niamh Price, Cattery Care and Socialisation, 3/5, "Needs attention", Mark handled; and 16 Oct 2026, Alex Jenkins, Morning Dog Walking, 5/5, "None", "No action needed". Rating 5 left only Alex's row. Rating 5 plus Flagged only said "No ratings yet", "0 ratings", and "No feedback matching filters". Mark handled was not pressed.

Group bookings. Pending, and All, showed one row: Belfast Metropolitan College, Fundraising Stall: Summer Fair, "Thu 12 Nov, 09:00", Orla Magee, size 6, Pending. Confirm measured 78 by 44 and Decline 59 by 44. They were not pressed: both submit straight away. Cancelled said "No group bookings".

Hours to approve. Four rows: Alex Jenkins, N/A, 28 Oct 2026, 2.00; Siobhan Hughes, Fundraising Stall: Summer Fair, 31 Oct 2026, 4.00; Niamh Price, N/A, 1 Nov 2026, 2.00; Walk Tester, Reception cover, 1 Nov 2026, 1.00. Each had Approve. The select boxes measured 20 by 20. Approve selected was disabled until a box is ticked. Nothing was approved, so an empty list was not opened.

Morning staff guide. A checklist, not a list of records. The lead read "A short checklist for opening the volunteer day at Assisi Animal Sanctuary ." with a space before the full stop. The links in the list, including Open day sheet, Animals, and Staff home, measured about 21 pixels tall.

Custom fields. "No custom fields yet." The Required checkbox measured 20 by 20. A field was not saved.

Waivers. "No waivers yet." The two checkboxes measured 20 by 20. A waiver was not saved.

Qualifications. One row: Dog Handling, "24 months", Edit and Delete. Edit measured 36 by 44 and opened "Edit qualification" with validity 24. Cancel edit cleared it. Nothing was saved. Delete was not pressed: it asks to confirm, and confirming would remove the row. An empty list was not opened.

Onboarding. Counts: 0 needs profile, 1 awaiting approval, 0 needs waiver, 6 needs references, 0 flagged, 0 needs AccessNI, 0 ready. Empty stages said "Nobody is at this stage." Awaiting approval was Maeve Williams. Needs references listed Alex Jenkins, Niamh Price, Ciaran Davies, Siobhan Hughes, Eoin Roberts, and Walk Tester at walk-i6-20261102@example.test. The name links measured 309 by 24. Maeve's link went to volunteers.html?user=7 and opened a profile dialog. Date of birth in that dialog read 2002-01-08. The dialog also showed a phone, a street address, and an emergency contact. It was closed without a change.

Reports. Headings included "Reports & Exports", "Start Date", and "End Date". Leaderboard: Alex Jenkins 23.5 hours, Eoin Roberts 12.0, Ciaran Davies 10.5, Niamh Price 10.0, Siobhan Hughes 3.0. Hours by month listed Jan through Dec and no hour figures in the text. The export buttons were not pressed. One row and an empty leaderboard were not available without changing data.

Privacy tools. A form, not a list. The sentence said no retention period is set and the button changes nothing while the period is empty. "directory" measured 62 by 21. Export, Erase, and Run retention now were not pressed.

Audit log. Unfiltered rows were timed "Today, 18:11" and similar, actor "Ciara Gallagher (admin@shelterlink.org)", entity "volunteer #7", detail `{"user_id":7}`. Action "no.such.action" then said "No matching audit rows". A filter that returns exactly one row was not set up.

Threads. One thread, Reception cover, listed twice in the list. Opening it showed "Reception cover · 2 Nov 2026, 16:15", participants Walk Tester and Ciara Gallagher, and one message from Walk Tester at that time: "On my way to reception." Mute measured 48 by 44, Delete 53 by 44, Send 275 by 44. Nothing was muted, deleted, or sent. Bulk email measured 74 by 21. The separate bulk-email page was not opened. An empty thread list was not on screen.

### Volunteer, signed in as Alex Jenkins

Certificate. "No certificate issued yet. Use Make or refresh the certificate to create one from your approved hours." Make or refresh was not pressed. A second heading, "Certificate of volunteer service", was in the page but hidden. More in the tab bar opened Calendar, Applications, Foster, Transport, and Profile, each about 391 by 48.

Calendar. Month view titled November 2026. The day numbers measured about 18 by 32, the weekday labels about 25 pixels tall, and List 38 by 44. The control labelled "today" was lowercase. List showed Reception cover, Weekly Dog Walking, Morning Dog Walking, Cattery Care and Socialisation, Evening Dog Enrichment, Kennel Deep-Clean, Fundraising Stall: Summer Fair, and Transport Run: Vet Appointments, several of them repeating. A list row sat too low to click, so a shift dialog was not opened and nothing was applied.

Your hours. The page said 23.5 hours approved and 2.0 waiting. The history included 30 Oct 2026, Weekend Adoption Morning, 3.00, Approved; 28 Oct 2026, N/A, 2.00, Pending; 26 Oct 2026, Evening Dog Enrichment, 1.50, Approved; 15 Oct 2026, Morning Dog Walking, 3.00, Approved; 28 Sept 2026, N/A, 8.00, Approved; 29 Aug 2026, N/A, 8.00, Approved. Your certificate measured 123 by 24. Leave feedback measured 110 by 21, on rows including 2 Nov 2026, Reception cover. Setting status to Waiting for approval and applying then said "No hours found matching your filters", even though the unfiltered history had a Pending row. The first press on Apply hit the ShelterLink brand link. The filter was applied from the button itself after that. Log hours and Export were not pressed.

Foster. "No foster requests match your home right now." and "No animals are staying with you yet." The profile link measured 89 by 23. A request was not created.

Transport. Three open legs for Rex transfer to foster, each dated "Thu 5 Nov" with no year, and a "Drive this leg" button. "Legs you are driving" said "You are not driving any legs yet." No leg was claimed. The note about other drivers uses a curly apostrophe in "drivers'".

Accept waiver. Opened directly at /pages/volunteer/accept-waiver.html while signed in as Alex. It left that address and showed the volunteer home. The waiver text was not on screen.

Complete profile. The form stayed on screen. The date of birth value was 1996-03-14. Address and emergency contact were filled. The garden, animals, children, medication, and alert checkboxes measured 20 by 20. Nothing was saved, and Sign out of all devices was not pressed.

### Still not opened

The first "Not reached" list above stands. This pass also did not open the bulk-email page behind the Threads link, and it did not open a calendar shift dialog.
