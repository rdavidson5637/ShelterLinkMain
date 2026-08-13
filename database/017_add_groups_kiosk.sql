-- Migration: Group bookings, community service tracking, kiosk support
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/017_add_groups_kiosk.sql

ALTER TABLE `volunteer_profiles`
  ADD COLUMN `volunteer_type` ENUM('regular','community_service','corporate_group')
    NOT NULL DEFAULT 'regular'
    AFTER `approved`,
  ADD COLUMN `required_hours` DECIMAL(8,2) DEFAULT NULL
    COMMENT 'Community service hour target'
    AFTER `volunteer_type`;

CREATE TABLE IF NOT EXISTS `group_bookings` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `opportunity_id`  INT           NOT NULL,
  `group_name`      VARCHAR(255)  NOT NULL,
  `contact_name`    VARCHAR(255)  NOT NULL,
  `contact_email`   VARCHAR(255)  NOT NULL,
  `size`            INT           NOT NULL,
  `status`          ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
  `notes`           TEXT          DEFAULT NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_group_bookings_status` (`status`),
  KEY `fk_group_bookings_opportunity` (`opportunity_id`),
  CONSTRAINT `fk_group_bookings_opportunity`
    FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities` (`opportunity_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_group_bookings_size`
    CHECK (`size` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
