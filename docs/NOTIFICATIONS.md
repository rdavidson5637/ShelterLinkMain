# Notifications: email and push, SMS switched off

Shift reminders and urgent-cover broadcasts go through `utils/notify/index.js`.

| Channel | How it sends | When it is on |
| --- | --- | --- |
| Email | `utils/emailService.js` (SMTP) | `EMAIL_HOST` and `EMAIL_FROM` (or `EMAIL_USER`) are set |
| Push | `utils/pushService.js` (Web Push) | VAPID keys are set. Volunteer preferences `prefer_reminders` and `prefer_urgent` apply |
| SMS | `utils/notify/smsProvider.js` | Never. The only provider is the disabled one |

## What each send does

- `notifyShiftReminder(app, details)`: emails the volunteer when email is configured, then sends a push in the `reminders` category. The job marks the reminder sent only if the email or a push went out. If email is configured and the volunteer has no address, the reminder counts as failed.
- `notifyUrgentCover({ recipients, opportunity, subject, whenLabel })`: emails every resolved recipient (a failure on one address does not stop the rest), then sends one push batch in the `urgent` category.

Each call returns results per channel (`sent`, `failed`, `skipped`). A push failure never stops email, and email never waits on push.

## SMS

SMS has not been agreed with the charity. There is no SMS provider account, no SMS dependency, and no SMS cost. `getSmsProvider()` always returns the disabled provider, and no environment variable changes that. Phone numbers are not looked up or passed on. The SMS result is always `skipped`.

Turning SMS on later needs Ryan's sign-off and the charity's agreement, then:

1. A provider object with `name`, `isEnabled()` and `send({ to, body, kind })` (checked by `isSmsProvider`).
2. Per-volunteer SMS opt-in and phone verification.
3. A change to `getSmsProvider()` and to `sendSms` in `utils/notify/index.js` to send to opted-in, verified numbers only.

`test/notify.test.js` checks that SMS stays off, that environment variables cannot switch it on, and that no SMS vendor package is installed.
