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

- Week sheet.
- A check-in code on the kiosk.
- A message thread, a reply, or the shift chat button after acceptance.
- Logging hours for a date that has already happened.
- Forgot password.
- References and the background check, beyond seeing them listed.
- Cover this shift.
- Day sheet, the staff shift list, and application review at 375.
- Any email. The settings were blank on purpose.
