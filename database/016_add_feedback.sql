-- Migration: Post-shift feedback surveys
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/016_add_feedback.sql

ALTER TABLE `applications`
  ADD COLUMN `feedback_requested_at` DATETIME DEFAULT NULL
    COMMENT 'When the post-shift feedback email was sent'
    AFTER `checked_out_at`;

CREATE TABLE IF NOT EXISTS `shift_feedback` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `application_id`  INT           NOT NULL,
  `rating`          TINYINT       NOT NULL,
  `comment`         TEXT          DEFAULT NULL,
  `flag_concern`    TINYINT(1)    NOT NULL DEFAULT 0,
  `handled_at`      DATETIME      DEFAULT NULL
    COMMENT 'When an admin marked a concern as handled',
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_feedback_application` (`application_id`),
  KEY `idx_feedback_flag_handled` (`flag_concern`, `handled_at`),
  KEY `idx_feedback_created` (`created_at`),
  CONSTRAINT `fk_feedback_application`
    FOREIGN KEY (`application_id`) REFERENCES `applications` (`application_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_feedback_rating`
    CHECK (`rating` BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
