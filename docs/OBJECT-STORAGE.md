# Object storage for uploads

Volunteer documents and animal photos used to live only as Postgres `bytea`
(see migration `032`). That is fine for one sanctuary. Before a third shelter
joins, bytes should move to an S3-compatible bucket so the free-tier database
is not filled with files.

## Behaviour

| `OBJECT_STORAGE_*` env | Where new uploads go | Old rows |
| --- | --- | --- |
| Unset or incomplete | Postgres `content` bytea (unchanged) | Still readable |
| All four required vars set | Bucket via `storage_key`; `content` left null | Still readable from bytea |

Reads always prefer `storage_key` when present, then fall back to `content`.
List and detail queries never select file bytes or storage keys.

## Required settings (optional)

Set all four on the host. Incomplete config is ignored and the app keeps
using the database. Do not invent values — create a free-tier bucket first
(Cloudflare R2, Supabase Storage S3 API, or MinIO), then paste the real keys.

```
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
```

Optional:

```
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_FORCE_PATH_STYLE=true
```

Path-style addressing is the default (`true`). Set
`OBJECT_STORAGE_FORCE_PATH_STYLE=false` only for virtual-hosted-style
endpoints that require it.

## What this does not do

- No new paid dependency and no AWS SDK. The client is a small SigV4 helper
  in `utils/objectStorage/s3.js`.
- No automatic migration of existing bytea rows into the bucket. That can be
  a later script once a bucket is live.
- No change to shelter logos (`shelters.logo`) in this task.
- Production migrations are applied by the coordinator/keeper, not by a lane.

## Code map

- `utils/objectStorage/` — config, key builder, S3 client
- `models/UserDocument.js` / `models/Animal.js` / `models/ShelterResource.js` — put/get/delete
- `models/Gdpr.js` — deletes object blobs before erasing document rows
- `database/045_object_storage_keys.pg.sql` — `storage_key` columns
- `database/062_shelter_resources.pg.sql` — shelter handbook/policy library files
