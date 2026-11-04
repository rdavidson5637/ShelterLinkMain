-- Charity register cache (self-serve brief sections 6 and 9 item 4).
-- Global table. Holds rows imported from a regulator's published register
-- file for regulators with no lookup API we can use: the Charity Commission
-- for Northern Ireland (CCNI) to start with, and later the Charities
-- Regulator (Ireland). Filled by scripts/import-charity-register.js. Read by
-- services/charityRegister/ccni.js. Not visible to tenants.
-- A row here is evidence that a charity number was on the register when the
-- file was published. It is not proof of who is applying.
-- Safe to run more than once. Requires 036_self_serve_shelters.pg.sql.
-- Do not run this against production until the deploy is approved.
--
-- Rollback:
--   DROP TABLE IF EXISTS charity_register_cache;

BEGIN;

CREATE TABLE IF NOT EXISTS charity_register_cache (
  regulator       TEXT NOT NULL,
  charity_number  VARCHAR(32) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  status          TEXT NOT NULL,
  removed_at      DATE,
  source          VARCHAR(255) NOT NULL,
  imported_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT charity_register_cache_pkey PRIMARY KEY (regulator, charity_number),
  CONSTRAINT charity_register_cache_regulator_chk CHECK (regulator IN ('ccew','oscr','ccni','cri')),
  CONSTRAINT charity_register_cache_status_chk CHECK (status IN ('registered','removed','unknown'))
);

-- 033 granted every table in public to shelterlink_tenant. On a fresh setup
-- that includes this one. Take it back: only platform code reads the cache.
REVOKE ALL ON charity_register_cache FROM shelterlink_tenant;

COMMIT;
