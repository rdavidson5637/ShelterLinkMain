-- Migration: Add phone column to users table
-- The registration form collects a (required) phone number and the admin
-- volunteers view displays it, but the column was missing so the value was
-- never stored. Run this against an existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/002_add_phone.sql

ALTER TABLE `users`
  ADD COLUMN `phone` varchar(30) DEFAULT NULL AFTER `name`;
