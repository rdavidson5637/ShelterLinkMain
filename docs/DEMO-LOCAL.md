# Local demo (Assisi)

Run ShelterLink on your own machine against a local Postgres, with the demo
data loaded and the Assisi shelter renamed for the demo. Nothing here
touches staging or production.

Checked on macOS with Postgres 16 and Node 22, 9 Nov 2026.

## 1. Postgres

```sh
brew install postgresql@16
brew services start postgresql@16
createdb shelterlink
```

## 2. `.env`

```sh
cp .env.example .env
```

Then edit `.env`:

- Leave `DATABASE_URL=` blank. The app then uses `DB_HOST`, `DB_PORT`,
  `DB_USER`, `DB_PASSWORD` and `DB_NAME`.
- Set `DB_USER` to your Mac user name (Homebrew Postgres has no `postgres`
  user by default), leave `DB_PASSWORD` blank, and keep `DB_NAME=shelterlink`.
- Set `SESSION_SECRET` to any long random string, for example the output of
  `openssl rand -hex 32`.
- Keep `NODE_ENV=development` and `APP_URL=http://localhost:3000`.
- Leave the `EMAIL_*` settings blank. No email is sent locally.

Never put a staging or production `DATABASE_URL` in this file for a demo:
the next step deletes every table in the database it points at.

## 3. Load the demo data

```sh
npm install
npm run db:reset
```

`db:reset` drops and rebuilds every table in that database, then loads
the sample data. It refuses to run when `NODE_ENV=production`. The demo
logins are listed at the top of `database/seed.pg.sql`:

| Who | Email | Password |
|---|---|---|
| Admin | `admin@shelterlink.org` | `Admin123!` |
| Volunteers | any volunteer email in the seed file | `Password1` |

## 4. Name the shelter

`db:reset` already creates Assisi as shelter 1 (slug `assisi`). Rename it
for the demo with `--update`:

```sh
node scripts/create-shelter.js --update --slug assisi --name "Assisi demo"
```

Leaving out `--update` does not work here: without it the script tries to
create a new shelter, which needs `--admin-name`, `--admin-email` and
`--admin-password`, and the `assisi` slug is already taken anyway. Add
`--logo ./logo.png` (PNG or JPEG, under 512 KB) to set a logo too.

## 5. Run it

```sh
npm run dev
```

Open <http://localhost:3000>:

- `/login.html`: sign in as the admin above.
- `/s/assisi`: the public page, showing "Assisi demo".
- `/s/assisi/opportunities`: the public shift board.

## Optional: the platform owner queue

To show `/platform/shelters` as well, make the demo admin a platform owner
on this local database:

```sh
node scripts/platform-owner.js add --email admin@shelterlink.org
```

The script refuses production and any database that is not on localhost.

## Starting again

Run `npm run db:reset` and step 4 again. To remove the database
completely: `dropdb shelterlink`.
