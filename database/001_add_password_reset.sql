-- Migration: Add password reset token columns to users table
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/migrations/001_add_password_reset.sql

ALTER TABLE `users`
  ADD COLUMN `reset_token`         varchar(64)  DEFAULT NULL AFTER `last_login`,
  ADD COLUMN `reset_token_expires` datetime     DEFAULT NULL AFTER `reset_token`,
  ADD INDEX  `idx_users_reset_token` (`reset_token`);
