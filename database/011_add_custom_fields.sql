-- Migration: Admin-configurable custom profile fields
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/011_add_custom_fields.sql

CREATE TABLE IF NOT EXISTS `custom_fields` (
  `id`           INT           NOT NULL AUTO_INCREMENT,
  `label`        VARCHAR(255)  NOT NULL,
  `field_type`   ENUM('text','select','checkbox','date') NOT NULL DEFAULT 'text',
  `options_json` TEXT          DEFAULT NULL COMMENT 'JSON array of options for select fields',
  `required`     TINYINT(1)    NOT NULL DEFAULT 0,
  `applies_to`   ENUM('profile') NOT NULL DEFAULT 'profile',
  `sort_order`   INT           NOT NULL DEFAULT 0,
  `active`       TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_fields_active_sort` (`active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `custom_field_values` (
  `id`         INT           NOT NULL AUTO_INCREMENT,
  `field_id`   INT           NOT NULL,
  `user_id`    INT           NOT NULL,
  `value`      TEXT          DEFAULT NULL,
  `updated_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_custom_field_user` (`field_id`, `user_id`),
  KEY `fk_cfv_user` (`user_id`),
  CONSTRAINT `fk_cfv_field`
    FOREIGN KEY (`field_id`) REFERENCES `custom_fields` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_cfv_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
