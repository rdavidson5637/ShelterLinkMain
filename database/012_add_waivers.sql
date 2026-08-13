-- Migration: Electronic waivers and volunteer document uploads
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/012_add_waivers.sql

CREATE TABLE IF NOT EXISTS `waivers` (
  `id`                     INT           NOT NULL AUTO_INCREMENT,
  `title`                  VARCHAR(255)  NOT NULL,
  `body`                   MEDIUMTEXT    NOT NULL,
  `version`                INT           NOT NULL DEFAULT 1,
  `active`                 TINYINT(1)    NOT NULL DEFAULT 1,
  `requires_reacceptance`  TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `waiver_acceptances` (
  `id`           INT       NOT NULL AUTO_INCREMENT,
  `waiver_id`    INT       NOT NULL,
  `user_id`      INT       NOT NULL,
  `version`      INT       NOT NULL,
  `accepted_at`  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_waiver_user_version` (`waiver_id`, `user_id`, `version`),
  KEY `fk_wa_user` (`user_id`),
  CONSTRAINT `fk_wa_waiver`
    FOREIGN KEY (`waiver_id`) REFERENCES `waivers` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_wa_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_documents` (
  `id`             INT           NOT NULL AUTO_INCREMENT,
  `user_id`        INT           NOT NULL,
  `filename`       VARCHAR(255)  NOT NULL,
  `original_name`  VARCHAR(255)  NOT NULL,
  `mime_type`      VARCHAR(100)  NOT NULL,
  `size`           INT           NOT NULL,
  `uploaded_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`     DATE          DEFAULT NULL,
  `label`          VARCHAR(255)  DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_ud_user` (`user_id`),
  CONSTRAINT `fk_ud_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
