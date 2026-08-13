-- Migration: Interest tags and opportunity auto-matching
-- Run this against your existing shelterlink database.
--
-- Usage:
--   mysql -u root -p shelterlink < database/013_add_tags.sql

CREATE TABLE IF NOT EXISTS `tags` (
  `id`    INT           NOT NULL AUTO_INCREMENT,
  `name`  VARCHAR(100)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tags_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `volunteer_tags` (
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

CREATE TABLE IF NOT EXISTS `opportunity_tags` (
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

-- Pending match notifications; digests send at most once per volunteer per day.
CREATE TABLE IF NOT EXISTS `opportunity_match_queue` (
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

CREATE TABLE IF NOT EXISTS `tag_digest_log` (
  `user_id`      INT  NOT NULL,
  `digest_date`  DATE NOT NULL,
  PRIMARY KEY (`user_id`, `digest_date`),
  CONSTRAINT `fk_tdl_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `tags` (`name`) VALUES
  ('dogs'),
  ('cats'),
  ('small animals'),
  ('cleaning'),
  ('events'),
  ('admin'),
  ('transport'),
  ('photography'),
  ('fundraising');
