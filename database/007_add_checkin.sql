-- Migration: Add shift check-in codes and timestamps
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/007_add_checkin.sql

ALTER TABLE `opportunities`
  ADD COLUMN `check_in_code` VARCHAR(6) DEFAULT NULL AFTER `parent_opportunity_id`;

ALTER TABLE `applications`
  ADD COLUMN `checked_in_at` DATETIME DEFAULT NULL AFTER `no_show`,
  ADD COLUMN `checked_out_at` DATETIME DEFAULT NULL AFTER `checked_in_at`;

ALTER TABLE `volunteer_hours`
  ADD COLUMN `verified_by_checkin` TINYINT(1) NOT NULL DEFAULT 0 AFTER `approved`;
