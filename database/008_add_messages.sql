-- Migration: Add admin_messages send log
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/008_add_messages.sql

CREATE TABLE IF NOT EXISTS `admin_messages` (
  `id`               INT           NOT NULL AUTO_INCREMENT,
  `admin_id`         INT           DEFAULT NULL,
  `subject`          VARCHAR(255)  NOT NULL,
  `body`             TEXT          NOT NULL,
  `filter_json`      TEXT          DEFAULT NULL,
  `recipient_count`  INT           NOT NULL DEFAULT 0,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_admin_messages_admin` (`admin_id`),
  CONSTRAINT `fk_admin_messages_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `users` (`user_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
