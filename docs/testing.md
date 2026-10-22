# Testing

Unit tests use an in-memory database mock. They do not connect to the shelter's database.

```bash
npm test
```

The security subset is the same runner, limited to the auth, permission, validation, header, and retention files:

```bash
npm run test:security
```

GitHub Actions runs `npm test` on every pull request (`.github/workflows/ci.yml`). That workflow also starts a local Postgres only for the tenant isolation script.

The tenant isolation script refuses to run unless the database host is localhost and the database name is `shelterlink_tenant_test`. Do not point `DATABASE_URL` or `TENANT_DATABASE_URL` at the live Supabase database.

`npm run retention:sweep` prints a plan and changes nothing. It reads whatever database the environment points at, so run it against a copy. Do not add `--apply` against production.
