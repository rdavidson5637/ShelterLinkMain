-- ============================================================================
-- ShelterLink — Full Database Schema
-- Animal shelter volunteer management system
-- ----------------------------------------------------------------------------
-- This file creates the ShelterLink database from scratch. It is idempotent
-- for a fresh setup: it (re)creates the database and all tables in the correct
-- dependency order.
--
-- Usage (MAMP / local MySQL):
--   mysql -u root -p --socket=/Applications/MAMP/tmp/mysql/mysql.sock < database/schema.sql
-- or simply:
--   mysql -u root -proot -h 127.0.0.1 -P 8889 < database/schema.sql
--
-- After loading the schema you can optionally load sample data:
--   mysql -u root -proot -h 127.0.0.1 -P 8889 ShelterLink < database/seed.sql
--
-- Character set: utf8mb4 (full Unicode, including emoji in notes/skills).
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `ShelterLink`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `ShelterLink`;

-- Drop in reverse-dependency order so re-running is clean.
DROP TABLE IF EXISTS `audit_log`;
DROP TABLE IF EXISTS `tag_digest_log`;
DROP TABLE IF EXISTS `opportunity_match_queue`;
DROP TABLE IF EXISTS `opportunity_tags`;
DROP TABLE IF EXISTS `volunteer_tags`;
DROP TABLE IF EXISTS `tags`;
DROP TABLE IF EXISTS `custom_field_values`;
DROP TABLE IF EXISTS `custom_fields`;
DROP TABLE IF EXISTS `user_documents`;
DROP TABLE IF EXISTS `waiver_acceptances`;
DROP TABLE IF EXISTS `waivers`;
DROP TABLE IF EXISTS `opportunity_qualifications`;
DROP TABLE IF EXISTS `volunteer_qualifications`;
DROP TABLE IF EXISTS `qualifications`;
DROP TABLE IF EXISTS `admin_messages`;
DROP TABLE IF EXISTS `job_runs`;
DROP TABLE IF EXISTS `volunteer_hours`;
DROP TABLE IF EXISTS `shift_feedback`;
DROP TABLE IF EXISTS `swap_requests`;
DROP TABLE IF EXISTS `applications`;
DROP TABLE IF EXISTS `volunteer_profiles`;
DROP TABLE IF EXISTS `opportunities`;
DROP TABLE IF EXISTS `sessions`;
DROP TABLE IF EXISTS `users`;

-- ----------------------------------------------------------------------------
-- users
-- Accounts for both volunteers and administrators.
-- `name` is kept for backwards compatibility; `first_name`/`last_name` are the
-- canonical fields the app writes on registration.
-- ----------------------------------------------------------------------------
CREATE TABLE `users` (
  `user_id`             INT           NOT NULL AUTO_INCREMENT,
  `first_name`          VARCHAR(100)  DEFAULT NULL,
  `last_name`           VARCHAR(100)  DEFAULT NULL,
  `name`                VARCHAR(200)  DEFAULT NULL,
  `phone`               VARCHAR(30)   DEFAULT NULL,
  `email`               VARCHAR(255)  NOT NULL,
  `password`            VARCHAR(255)  NOT NULL,
  `role`                ENUM('volunteer','staff','admin') NOT NULL DEFAULT 'volunteer',
  `created_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login`          DATETIME      DEFAULT NULL,
  `anonymised_at`       DATETIME      DEFAULT NULL,
  `reset_token`         VARCHAR(64)   DEFAULT NULL,
  `reset_token_expires` DATETIME      DEFAULT NULL,
  `ical_token`          VARCHAR(64)   DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_ical_token` (`ical_token`),
  KEY `idx_users_reset_token` (`reset_token`),
  KEY `idx_users_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- opportunities
-- Volunteer shifts / roles that the shelter publishes.
-- ----------------------------------------------------------------------------
CREATE TABLE `opportunities` (
  `opportunity_id`  INT           NOT NULL AUTO_INCREMENT,
  `title`           VARCHAR(255)  NOT NULL,
  `description`     TEXT          DEFAULT NULL,
  `requirements`    TEXT          DEFAULT NULL,
  `location`        VARCHAR(255)  DEFAULT NULL,
  `start_date`      DATETIME      DEFAULT NULL,
  `end_date`        DATETIME      DEFAULT NULL,
  `max_volunteers`  INT           DEFAULT NULL,
  `status`          ENUM('open','closed','cancelled','completed') NOT NULL DEFAULT 'open',
  `created_by`      INT           DEFAULT NULL,
  `recurrence_rule` ENUM('none','daily','weekly') NOT NULL DEFAULT 'none',
  `recurrence_until` DATE         DEFAULT NULL,
  `parent_opportunity_id` INT     DEFAULT NULL,
  `check_in_code`   VARCHAR(6)    DEFAULT NULL,
  `cancellation_cutoff_hours` INT NOT NULL DEFAULT 24,
  `activity_notes`  TEXT          DEFAULT NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`opportunity_id`),
  KEY `idx_opportunities_status_start` (`status`, `start_date`),
  KEY `idx_opportunities_start_date` (`start_date`),
  KEY `fk_opportunities_created_by` (`created_by`),
  KEY `fk_opportunities_parent` (`parent_opportunity_id`),
  CONSTRAINT `fk_opportunities_created_by`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_opportunities_parent`
    FOREIGN KEY (`parent_opportunity_id`) REFERENCES `opportunities` (`opportunity_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- volunteer_profiles
-- One extended profile row per volunteer user. `approved` gates whether an
-- admin has vetted the volunteer.
-- ----------------------------------------------------------------------------
CREATE TABLE `volunteer_profiles` (
  `profile_id`        INT           NOT NULL AUTO_INCREMENT,
  `user_id`           INT           NOT NULL,
  `date_of_birth`     DATE          DEFAULT NULL,
  `address`           VARCHAR(255)  DEFAULT NULL,
  `emergency_contact` VARCHAR(255)  DEFAULT NULL,
  `skills`            TEXT          DEFAULT NULL,
  `availability`      VARCHAR(255)  DEFAULT NULL,
  `approved`          TINYINT(1)    NOT NULL DEFAULT 0,
  `volunteer_type`    ENUM('regular','community_service','corporate_group') NOT NULL DEFAULT 'regular',
  `required_hours`    DECIMAL(8,2)  DEFAULT NULL,
  `created_at`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`profile_id`),
  UNIQUE KEY `uq_profiles_user` (`user_id`),
  CONSTRAINT `fk_profiles_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- applications
-- A volunteer applying to an opportunity. One application per user/opportunity.
-- `status` = pending → accepted/approved → rejected, or cancelled (row removed
-- by the app on cancel, but the value is part of the domain).
-- ----------------------------------------------------------------------------
CREATE TABLE `applications` (
  `application_id`   INT           NOT NULL AUTO_INCREMENT,
  `user_id`          INT           NOT NULL,
  `opportunity_id`   INT           NOT NULL,
  `status`           ENUM('pending','accepted','approved','rejected','cancelled','waitlisted') NOT NULL DEFAULT 'pending',
  `applied_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `rejection_reason` TEXT          DEFAULT NULL,
  `notes`            TEXT          DEFAULT NULL,
  `reminder_sent_at` DATETIME      DEFAULT NULL,
  `no_show`          TINYINT(1)    NOT NULL DEFAULT 0,
  `checked_in_at`    DATETIME      DEFAULT NULL,
  `checked_out_at`   DATETIME      DEFAULT NULL,
  `feedback_requested_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`application_id`),
  UNIQUE KEY `uq_application_user_opportunity` (`user_id`, `opportunity_id`),
  KEY `idx_applications_status` (`status`),
  KEY `idx_applications_opportunity_status` (`opportunity_id`, `status`),
  KEY `idx_applications_status_reminder` (`status`, `reminder_sent_at`),
  CONSTRAINT `fk_applications_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_applications_opportunity`
    FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities` (`opportunity_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- shift_feedback
-- Post-shift volunteer ratings (one per accepted application).
-- ----------------------------------------------------------------------------
CREATE TABLE `shift_feedback` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `application_id`  INT           NOT NULL,
  `rating`          TINYINT       NOT NULL,
  `comment`         TEXT          DEFAULT NULL,
  `flag_concern`    TINYINT(1)    NOT NULL DEFAULT 0,
  `handled_at`      DATETIME      DEFAULT NULL,
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

-- ----------------------------------------------------------------------------
-- swap_requests
-- Self-service cover requests for accepted applications inside the cancel cutoff.
-- Waitlist gets a 12h exclusive offer (claim_token) before public_at is set.
-- ----------------------------------------------------------------------------
CREATE TABLE `swap_requests` (
  `id`                          INT           NOT NULL AUTO_INCREMENT,
  `application_id`              INT           NOT NULL,
  `requested_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status`                      ENUM('open','claimed','expired','cancelled') NOT NULL DEFAULT 'open',
  `claimed_by_application_id`   INT           DEFAULT NULL,
  `waitlist_offered_to_user_id` INT           DEFAULT NULL,
  `waitlist_offer_expires_at`   DATETIME      DEFAULT NULL,
  `claim_token`                 VARCHAR(64)   DEFAULT NULL,
  `public_at`                   DATETIME      DEFAULT NULL,
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

-- ----------------------------------------------------------------------------
-- volunteer_hours
-- Logged service hours. `opportunity_id` is optional (ad-hoc hours allowed).
-- `approved` = 0 pending admin approval, 1 approved (counts toward totals/badges).
-- ----------------------------------------------------------------------------
CREATE TABLE `volunteer_hours` (
  `record_id`       INT           NOT NULL AUTO_INCREMENT,
  `user_id`         INT           NOT NULL,
  `opportunity_id`  INT           DEFAULT NULL,
  `date`            DATE          NOT NULL,
  `hours`           DECIMAL(5,2)  NOT NULL,
  `approved`        TINYINT(1)    NOT NULL DEFAULT 0,
  `verified_by_checkin` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`record_id`),
  KEY `idx_hours_user_approved` (`user_id`, `approved`),
  KEY `idx_hours_approved_date` (`approved`, `date`),
  KEY `fk_hours_opportunity` (`opportunity_id`),
  CONSTRAINT `fk_hours_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_hours_opportunity`
    FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities` (`opportunity_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- job_runs
-- Scheduler run log so jobs can stay idempotent and failures are visible.
-- ----------------------------------------------------------------------------
CREATE TABLE `job_runs` (
  `id`        INT           NOT NULL AUTO_INCREMENT,
  `job_name`  VARCHAR(100)  NOT NULL,
  `ran_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status`    ENUM('ok','error') NOT NULL,
  `detail`    TEXT          DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_job_runs_name_ran` (`job_name`, `ran_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- qualifications
-- Training / certificates that can gate opportunities (e.g. Dog Handling).
-- validity_months NULL means the qualification never expires.
-- ----------------------------------------------------------------------------
CREATE TABLE `qualifications` (
  `id`               INT           NOT NULL AUTO_INCREMENT,
  `name`             VARCHAR(255)  NOT NULL,
  `description`      TEXT          DEFAULT NULL,
  `validity_months`  INT           DEFAULT NULL,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_qualifications_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- volunteer_qualifications
-- Awards of a qualification to a volunteer. expires_at NULL = never expires.
-- last_expiry_notified_at supports idempotent expiry reminder emails.
-- ----------------------------------------------------------------------------
CREATE TABLE `volunteer_qualifications` (
  `id`                       INT           NOT NULL AUTO_INCREMENT,
  `user_id`                  INT           NOT NULL,
  `qualification_id`         INT           NOT NULL,
  `awarded_at`               DATE          NOT NULL,
  `expires_at`               DATE          DEFAULT NULL,
  `awarded_by`               INT           DEFAULT NULL,
  `last_expiry_notified_at`  DATE          DEFAULT NULL,
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

-- ----------------------------------------------------------------------------
-- opportunity_qualifications
-- Required qualifications for an opportunity (many-to-many).
-- ----------------------------------------------------------------------------
CREATE TABLE `opportunity_qualifications` (
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

-- ----------------------------------------------------------------------------
-- tags
-- Shelter-relevant interest / opportunity tags for auto-matching.
-- ----------------------------------------------------------------------------
CREATE TABLE `tags` (
  `id`    INT           NOT NULL AUTO_INCREMENT,
  `name`  VARCHAR(100)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tags_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- volunteer_tags
-- Interest tags selected on a volunteer profile.
-- ----------------------------------------------------------------------------
CREATE TABLE `volunteer_tags` (
  `user_id`  INT NOT NULL,
  `tag_id`   INT NOT NULL,
  PRIMARY KEY (`user_id`, `tag_id`),
  KEY `fk_vt_tag` (`tag_id`),
  CONSTRAINT `fk_vt_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_vt_tag`
    FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- opportunity_tags
-- Tags applied to an opportunity for matching / filtering.
-- ----------------------------------------------------------------------------
CREATE TABLE `opportunity_tags` (
  `opportunity_id`  INT NOT NULL,
  `tag_id`         INT NOT NULL,
  PRIMARY KEY (`opportunity_id`, `tag_id`),
  KEY `fk_ot_tag` (`tag_id`),
  CONSTRAINT `fk_ot_opportunity`
    FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities` (`opportunity_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ot_tag`
    FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- opportunity_match_queue
-- Pending new-opportunity emails for tag-matched approved volunteers.
-- ----------------------------------------------------------------------------
CREATE TABLE `opportunity_match_queue` (
  `id`              INT       NOT NULL AUTO_INCREMENT,
  `opportunity_id`  INT       NOT NULL,
  `user_id`         INT       NOT NULL,
  `created_at`      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_match_queue_opp_user` (`opportunity_id`, `user_id`),
  KEY `idx_match_queue_user` (`user_id`),
  CONSTRAINT `fk_omq_opportunity`
    FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities` (`opportunity_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_omq_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- tag_digest_log
-- Ensures at most one match digest email per volunteer per calendar day.
-- ----------------------------------------------------------------------------
CREATE TABLE `tag_digest_log` (
  `user_id`      INT  NOT NULL,
  `digest_date`  DATE NOT NULL,
  PRIMARY KEY (`user_id`, `digest_date`),
  CONSTRAINT `fk_tdl_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `tags` (`name`) VALUES
  ('dogs'),
  ('cats'),
  ('small animals'),
  ('cleaning'),
  ('events'),
  ('admin'),
  ('transport'),
  ('photography'),
  ('fundraising');

-- ----------------------------------------------------------------------------
-- custom_fields
-- Admin-configurable profile fields (text, select, checkbox, date).
-- Soft-deactivate via active=0; never hard-delete once values exist.
-- ----------------------------------------------------------------------------
CREATE TABLE `custom_fields` (
  `id`           INT           NOT NULL AUTO_INCREMENT,
  `label`        VARCHAR(255)  NOT NULL,
  `field_type`   ENUM('text','select','checkbox','date') NOT NULL DEFAULT 'text',
  `options_json` TEXT          DEFAULT NULL,
  `required`     TINYINT(1)    NOT NULL DEFAULT 0,
  `applies_to`   ENUM('profile') NOT NULL DEFAULT 'profile',
  `sort_order`   INT           NOT NULL DEFAULT 0,
  `active`       TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_custom_fields_active_sort` (`active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- custom_field_values
-- Per-volunteer answers for custom profile fields (unique per field+user).
-- ----------------------------------------------------------------------------
CREATE TABLE `custom_field_values` (
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

-- ----------------------------------------------------------------------------
-- waivers
-- Electronic liability / policy waivers. Editing bumps version; when
-- requires_reacceptance is set, volunteers must accept the new version.
-- ----------------------------------------------------------------------------
CREATE TABLE `waivers` (
  `id`                     INT           NOT NULL AUTO_INCREMENT,
  `title`                  VARCHAR(255)  NOT NULL,
  `body`                   MEDIUMTEXT    NOT NULL,
  `version`                INT           NOT NULL DEFAULT 1,
  `active`                 TINYINT(1)    NOT NULL DEFAULT 1,
  `requires_reacceptance`  TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- waiver_acceptances
-- One row per volunteer acceptance of a specific waiver version.
-- ----------------------------------------------------------------------------
CREATE TABLE `waiver_acceptances` (
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

-- ----------------------------------------------------------------------------
-- user_documents
-- Volunteer-uploaded files (stored outside the web root; served via auth route).
-- ----------------------------------------------------------------------------
CREATE TABLE `user_documents` (
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

-- ----------------------------------------------------------------------------
-- admin_messages
-- Log of admin bulk email sends (filters + recipient count).
-- ----------------------------------------------------------------------------
CREATE TABLE `admin_messages` (
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

-- ----------------------------------------------------------------------------
-- audit_log
-- Records mutating staff/admin actions (and explicit GDPR events).
-- ----------------------------------------------------------------------------
CREATE TABLE `audit_log` (
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

-- ----------------------------------------------------------------------------
-- group_bookings
-- Company/school group slot requests. Size counts against capacity only when
-- status is confirmed.
-- ----------------------------------------------------------------------------
CREATE TABLE `group_bookings` (
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
  KEY `idx_group_bookings_opportunity_status` (`opportunity_id`, `status`),
  CONSTRAINT `fk_group_bookings_opportunity`
    FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities` (`opportunity_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_group_bookings_size`
    CHECK (`size` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- sessions
-- Backing store for express-mysql-session. The library can auto-create this,
-- but defining it explicitly means the DB user does not need CREATE privileges
-- at runtime. Schema matches express-mysql-session's default.
-- ----------------------------------------------------------------------------
CREATE TABLE `sessions` (
  `session_id` VARCHAR(128)     NOT NULL,
  `expires`    INT UNSIGNED     NOT NULL,
  `data`       MEDIUMTEXT       DEFAULT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
