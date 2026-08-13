-- Migration: Add recurring opportunity support
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/003_add_recurrence.sql

ALTER TABLE `opportunities`
  ADD COLUMN `recurrence_rule` ENUM('none','daily','weekly') NOT NULL DEFAULT 'none'
    AFTER `created_by`,
  ADD COLUMN `recurrence_until` DATE DEFAULT NULL
    AFTER `recurrence_rule`,
  ADD COLUMN `parent_opportunity_id` INT DEFAULT NULL
    AFTER `recurrence_until`,
  ADD KEY `fk_opportunities_parent` (`parent_opportunity_id`),
  ADD CONSTRAINT `fk_opportunities_parent`
    FOREIGN KEY (`parent_opportunity_id`) REFERENCES `opportunities` (`opportunity_id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
