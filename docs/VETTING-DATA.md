# Vetting data

This is a description of what the software stores. It is not a DPIA and it is
not a controller/processor contract. Assisi still needs both before this data
is relied on: a DPIA for criminal-offence data (UK GDPR Article 10) and a
written arrangement with whoever operates the database.

## What is stored

`background_checks` stores the check type, status, reference number, issued
date, expiry date, and a notes field. It does not store the certificate.

Who can see which fields:

- Staff see the type, status, issued date, and expiry date. They can set those
  so a shift can be rostered. They do not see or change the reference number
  or notes. A staff save keeps the reference number and notes already stored.
- Admins see and edit the reference number and notes.
- The volunteer sees their own reference number, type, status, and dates. They
  do not see admin notes.

Volunteer file uploads go into `user_documents.content` as bytes. The upload
route rejects a file whose name or label looks like an AccessNI, DBS, or
disclosure certificate. Those files should not be uploaded. An admin records
the status and reference number on the background check instead.

Uploaded files for another volunteer are visible to admin accounts only. Staff
can still see check status so they can roster a shift. The volunteer can
download their own files. The staff home lists checks that expire in the next
60 days, with name, type, status, and date only.

A shift that requires a check can only be applied for, accepted, or claimed
from a swap when that check is still clear on the shift date. A check that is
clear today and expires before the shift is refused. When an admin changes a
reference number or notes, the audit log records that those fields changed.
It does not store the old or new text.

## Still open

- DPIA for Article 10 data, signed by the controller.
- Written controller/processor terms with Assisi, including who may see a
  reference number and how long it is kept.
- Confirm the live Supabase region and that it is the region the controller agreed.
- Decide whether `background_checks.notes` should stay. It is free text, so an
  admin can still type offence detail into it. The form should be used for
  operational notes only.
