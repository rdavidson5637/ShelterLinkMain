-- Migration: Qualifications and training with expiry
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/010_add_qualifications.sql

CREATE TABLE IF NOT EXISTS `qualifications` (
  `id`               INT           NOT NULL AUTO_INCREMENT,
  `name`             VARCHAR(255)  NOT NULL,
  `description`      TEXT          DEFAULT NULL,
  `validity_months`  INT           DEFAULT NULL COMMENT 'NULL = never expires',
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_qualifications_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `volunteer_qualifications` (
  `id`                       INT           NOT NULL AUTO_INCREMENT,
  `user_id`                  INT           NOT NULL,
  `qualification_id`         INT           NOT NULL,
  `awarded_at`               DATE          NOT NULL,
  `expires_at`               DATE          DEFAULT NULL,
  `awarded_by`               INT           DEFAULT NULL,
  `last_expiry_notified_at`  DATE          DEFAULT NULL COMMENT 'Idempotency marker for expiry emails',
  `created_at`               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_volunteer_qualification` (`user_id`, `qualification_id`),
  KEY `fk_vq_qualification` (`qualification_id`),
  KEY `fk_vq_awarded_by` (`awarded_by`),
  KEY `idx_vq_expires` (`expires_at`),
  CONSTRAINT `fk_vq_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_vq_qualification`
    FOREIGN KEY (`qualification_id`) REFERENCES `qualifications` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_vq_awarded_by`
    FOREIGN KEY (`awarded_by`) REFERENCES `users` (`user_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `opportunity_qualifications` (
  `opportunity_id`    INT NOT NULL,
  `qualification_id`  INT NOT NULL,
  PRIMARY KEY (`opportunity_id`, `qualification_id`),
  KEY `fk_oq_qualification` (`qualification_id`),
  CONSTRAINT `fk_oq_opportunity`
    FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities` (`opportunity_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_oq_qualification`
    FOREIGN KEY (`qualification_id`) REFERENCES `qualifications` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
