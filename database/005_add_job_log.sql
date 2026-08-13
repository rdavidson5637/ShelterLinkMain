-- Migration: Add job_runs table for scheduler idempotency/logging
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/005_add_job_log.sql

CREATE TABLE IF NOT EXISTS `job_runs` (
  `id`        INT           NOT NULL AUTO_INCREMENT,
  `job_name`  VARCHAR(100)  NOT NULL,
  `ran_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status`    ENUM('ok','error') NOT NULL,
  `detail`    TEXT          DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_job_runs_name_ran` (`job_name`, `ran_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
