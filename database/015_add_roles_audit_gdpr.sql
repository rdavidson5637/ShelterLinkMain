-- Migration: Admin roles (staff), audit log, GDPR anonymisation support
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/015_add_roles_audit_gdpr.sql

-- Extend users.role to include staff (existing admins and volunteers unchanged).
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('volunteer','staff','admin') NOT NULL DEFAULT 'volunteer';

ALTER TABLE `users`
  ADD COLUMN `anonymised_at` DATETIME DEFAULT NULL
    COMMENT 'When set, PII has been erased for GDPR / retention'
    AFTER `last_login`;

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id`           INT           NOT NULL AUTO_INCREMENT,
  `user_id`      INT           DEFAULT NULL,
  `action`       VARCHAR(100)  NOT NULL,
  `entity_type`  VARCHAR(100)  DEFAULT NULL,
  `entity_id`    VARCHAR(64)   DEFAULT NULL,
  `detail_json`  JSON          DEFAULT NULL,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_user` (`user_id`),
  KEY `idx_audit_action` (`action`),
  KEY `idx_audit_entity` (`entity_type`, `entity_id`),
  CONSTRAINT `fk_audit_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
