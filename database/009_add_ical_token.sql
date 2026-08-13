-- Migration: Add per-user iCal feed token
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/009_add_ical_token.sql

ALTER TABLE `users`
  ADD COLUMN `ical_token` VARCHAR(64) DEFAULT NULL AFTER `reset_token_expires`,
  ADD UNIQUE KEY `uq_users_ical_token` (`ical_token`);
