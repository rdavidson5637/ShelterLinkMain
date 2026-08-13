-- Migration: Shift swaps and cancellation cutoff
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/014_add_swap.sql

ALTER TABLE `opportunities`
  ADD COLUMN `cancellation_cutoff_hours` INT NOT NULL DEFAULT 24
    COMMENT 'Volunteers may self-cancel accepted shifts only until this many hours before start'
    AFTER `check_in_code`,
  ADD COLUMN `activity_notes` TEXT DEFAULT NULL
    COMMENT 'Append-only admin-visible activity log (e.g. shift swaps)'
    AFTER `cancellation_cutoff_hours`;

CREATE TABLE IF NOT EXISTS `swap_requests` (
  `id`                          INT           NOT NULL AUTO_INCREMENT,
  `application_id`              INT           NOT NULL,
  `requested_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status`                      ENUM('open','claimed','expired','cancelled') NOT NULL DEFAULT 'open',
  `claimed_by_application_id`   INT           DEFAULT NULL,
  `waitlist_offered_to_user_id` INT           DEFAULT NULL,
  `waitlist_offer_expires_at`   DATETIME      DEFAULT NULL,
  `claim_token`                 VARCHAR(64)   DEFAULT NULL,
  `public_at`                   DATETIME      DEFAULT NULL
    COMMENT 'When set, swap is visible on browse-shifts for qualifying volunteers',
  PRIMARY KEY (`id`),
  KEY `idx_swap_status_public` (`status`, `public_at`),
  KEY `idx_swap_claim_token` (`claim_token`),
  KEY `fk_swap_application` (`application_id`),
  KEY `fk_swap_claimed_by` (`claimed_by_application_id`),
  KEY `fk_swap_waitlist_user` (`waitlist_offered_to_user_id`),
  CONSTRAINT `fk_swap_application`
    FOREIGN KEY (`application_id`) REFERENCES `applications` (`application_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_swap_claimed_by`
    FOREIGN KEY (`claimed_by_application_id`) REFERENCES `applications` (`application_id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_swap_waitlist_user`
    FOREIGN KEY (`waitlist_offered_to_user_id`) REFERENCES `users` (`user_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
