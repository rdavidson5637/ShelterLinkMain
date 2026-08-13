-- Migration: Add shift reminder and no-show tracking
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/006_add_reminders_noshow.sql

ALTER TABLE `applications`
  ADD COLUMN `reminder_sent_at` DATETIME DEFAULT NULL AFTER `notes`,
  ADD COLUMN `no_show` TINYINT(1) NOT NULL DEFAULT 0 AFTER `reminder_sent_at`;
