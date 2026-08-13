-- Migration: Add waitlisted status to applications
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/004_add_waitlist.sql

ALTER TABLE `applications`
  MODIFY COLUMN `status`
    ENUM('pending','accepted','approved','rejected','cancelled','waitlisted')
    NOT NULL DEFAULT 'pending';
