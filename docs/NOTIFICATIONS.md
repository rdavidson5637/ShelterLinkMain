# Notifications: email and push, SMS switched off

Shift reminders and urgent-cover broadcasts go through `utils/notify/index.js`.

| Channel | How it sends | When it is on |
| --- | --- | --- |
| Email | `utils/emailService.js` (SMTP) | `EMAIL_HOST` and `EMAIL_FROM` (or `EMAIL_USER`) are set |
| Push | `utils/pushService.js` (Web Push) | VAPID keys are set. Volunteer preferences `prefer_reminders` and `prefer_urgent` apply |
| SMS | `utils/notify/smsProvider.js` | Never. The only provider is the disabled one |

## Preferences and quiet hours (SL-LATER-16)

- `prefer_reminders` / `prefer_urgent` gate both email and push. The reminder job and urgent-cover recipient query also filter in SQL.
- `quiet_hours_start` / `quiet_hours_end` (shelter local time) hold reminders and urgent-cover alerts. Incomplete pairs mean no quiet hours. Overnight windows (e.g. 22:00–08:00) wrap midnight.
- Volunteers set these on their profile notification prefs.

## What each send does

- `notifyShiftReminder(app, details)`: skips when reminders are off or quiet hours are active; otherwise emails when configured, then pushes in the `reminders` category. The job marks the reminder sent only if email or push went out. If email is configured and the volunteer has no address, the reminder counts as failed.
- `notifyUrgentCover({ recipients, opportunity, subject, whenLabel })`: emails every active recipient (a failure on one address does not stop the rest), then sends one push batch in the `urgent` category. Preference and quiet-hours skips are counted separately.
- `notifyWaitlistSeatOffer(recipient, details)` (SL-LATER-23): when a seat frees, the first eligible waitlisted volunteer gets a time-limited claim link by email and push. Quiet hours delay the send (claim clock starts on notify). No preference gate. The `waitlistOffers` job expires unclaimed offers and cascades to the next eligible person; `job_runs` dedupes notify and expire.

## Replica-safe dedupe

- The scheduler claims each cron minute in `job_runs.run_key` before running a job.
- `jobs/shiftReminders.js` also claims `shiftReminderSend` / `app:{id}:{hour}` so two replicas never double-send the same reminder in the same hour.
- Staff urgent-cover claims `urgentCoverBroadcast` / `opp:{id}:{day}` and atomically flags the opportunity before sending.

## Urgent cover eligibility

Staff can broadcast cover for an understaffed upcoming shift. Recipients are approved volunteers who:

- have not already applied
- hold every required qualification (and animal training quals), not expired
- opted into urgent alerts and are not away
- meet the shelter minimum age / guardian consent rules
- are outside quiet hours

## SMS

SMS has not been agreed with the charity. There is no SMS provider account, no SMS dependency, and no SMS cost. `getSmsProvider()` always returns the disabled provider, and no environment variable changes that. Phone numbers are not looked up or passed on. The SMS result is always `skipped`.

Turning SMS on later needs Ryan's sign-off and the charity's agreement, then:

1. A provider object with `name`, `isEnabled()` and `send({ to, body, kind })` (checked by `isSmsProvider`).
2. Per-volunteer SMS opt-in and phone verification.
3. A change to `getSmsProvider()` and to `sendSms` in `utils/notify/index.js` to send to opted-in, verified numbers only.

`test/notify.test.js` checks that SMS stays off, that environment variables cannot switch it on, and that no SMS vendor package is installed.
