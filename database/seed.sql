-- ============================================================================
-- ShelterLink - Sample / Seed Data
-- ----------------------------------------------------------------------------
-- Loads a realistic set of demo accounts, opportunities, applications and
-- logged hours so the app is immediately usable and demonstrable.
--
-- Every shift, application and hours row is dated relative to NOW() / CURDATE()
-- so a fresh `npm run db:reset` looks alive on any calendar date.
--
-- Load AFTER schema.sql:
--   mysql -u root -proot -h 127.0.0.1 -P 8889 ShelterLink < database/seed.sql
--
-- Login credentials created by this seed:
--   Admin      ->  admin@shelterlink.org      /  Admin123!
--   Volunteers ->  (any volunteer email below) /  Password1
--
-- Password hashes are real bcrypt hashes, so these logins work out of the box.
-- ============================================================================

USE `ShelterLink`;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE `shift_feedback`;
TRUNCATE TABLE `swap_requests`;
TRUNCATE TABLE `volunteer_hours`;
TRUNCATE TABLE `applications`;
TRUNCATE TABLE `group_bookings`;
TRUNCATE TABLE `opportunity_qualifications`;
TRUNCATE TABLE `volunteer_qualifications`;
TRUNCATE TABLE `volunteer_tags`;
TRUNCATE TABLE `opportunity_tags`;
TRUNCATE TABLE `opportunity_match_queue`;
TRUNCATE TABLE `tag_digest_log`;
TRUNCATE TABLE `volunteer_profiles`;
TRUNCATE TABLE `opportunities`;
TRUNCATE TABLE `qualifications`;
TRUNCATE TABLE `users`;
SET FOREIGN_KEY_CHECKS = 1;

-- Shift datetimes: 6 past + 9 upcoming (shelter hours, never midnight).
-- Past
SET @s1_start  = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL -18 DAY), '09:00:00');
SET @s1_end    = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL -18 DAY), '12:00:00');
SET @s2_start  = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL -14 DAY), '09:00:00');
SET @s2_end    = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL -14 DAY), '12:00:00');
SET @s3_start  = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL -10 DAY), '13:00:00');
SET @s3_end    = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL -10 DAY), '16:00:00');
SET @s4_start  = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  -7 DAY), '18:00:00');
SET @s4_end    = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  -7 DAY), '19:30:00');
SET @s5_start  = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  -3 DAY), '09:00:00');
SET @s5_end    = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  -3 DAY), '12:00:00');
SET @s6_start  = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL -21 DAY), '09:00:00');
SET @s6_end    = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL -21 DAY), '12:00:00');
-- Upcoming
SET @s7_start  = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   2 DAY), '09:00:00');
SET @s7_end    = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   2 DAY), '12:00:00');
SET @s8_start  = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   4 DAY), '09:00:00');
SET @s8_end    = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   4 DAY), '12:00:00');
SET @s9_start  = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   5 DAY), '18:00:00');
SET @s9_end    = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   5 DAY), '19:30:00');
SET @s10_start = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   7 DAY), '13:00:00');
SET @s10_end   = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   7 DAY), '16:00:00');
SET @s11_start = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  10 DAY), '09:00:00');
SET @s11_end   = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  10 DAY), '12:00:00');
SET @s12_start = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  12 DAY), '09:00:00');
SET @s12_end   = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  12 DAY), '12:00:00');
-- Recurring weekly dog walking (parent + two children)
SET @s13_start = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   1 DAY), '09:00:00');
SET @s13_end   = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   1 DAY), '12:00:00');
SET @s14_start = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   8 DAY), '09:00:00');
SET @s14_end   = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL   8 DAY), '12:00:00');
SET @s15_start = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  15 DAY), '09:00:00');
SET @s15_end   = TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL  15 DAY), '12:00:00');
SET @s13_until = DATE_ADD(CURDATE(), INTERVAL 21 DAY);

-- Hours spread across months so streaks and the monthly chart have data
SET @hours_m0 = DATE_ADD(CURDATE(), INTERVAL  -5 DAY);
SET @hours_m1 = DATE_ADD(CURDATE(), INTERVAL -35 DAY);
SET @hours_m2 = DATE_ADD(CURDATE(), INTERVAL -65 DAY);

-- ----------------------------------------------------------------------------
-- Users  (password for admin = "Admin123!", all volunteers = "Password1")
-- ----------------------------------------------------------------------------
INSERT INTO `users`
  (`user_id`, `first_name`, `last_name`, `name`, `phone`, `email`, `password`, `role`, `created_at`) VALUES
  (1, 'Ciara',  'Gallagher', 'Ciara Gallagher', '028 9083 0001', 'admin@shelterlink.org',    '$2b$10$LDOn5KOmQXzlxBVW3FAozOVaHNMAv7aPTor624vuhW59P9YiUMBU6', 'admin',     DATE_ADD(NOW(), INTERVAL -90 DAY)),
  (2, 'Alex',   'Jenkins',   'Alex Jenkins',    '07700 900201',  'alex.jenkins@example.com', '$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', DATE_ADD(NOW(), INTERVAL -85 DAY)),
  (3, 'Niamh',  'Price',     'Niamh Price',     '07700 900202',  'niamh.price@example.com',  '$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', DATE_ADD(NOW(), INTERVAL -80 DAY)),
  (4, 'Ciaran', 'Davies',    'Ciaran Davies',   '07700 900203',  'ciaran.davies@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', DATE_ADD(NOW(), INTERVAL -75 DAY)),
  (5, 'Siobhan','Hughes',    'Siobhan Hughes',  '07700 900204',  'siobhan.hughes@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2','volunteer', DATE_ADD(NOW(), INTERVAL -70 DAY)),
  (6, 'Eoin',   'Roberts',   'Eoin Roberts',    '07700 900205',  'eoin.roberts@example.com', '$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', DATE_ADD(NOW(), INTERVAL -40 DAY)),
  (7, 'Maeve',  'Williams',  'Maeve Williams',  '07700 900206',  'maeve.williams@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2','volunteer', DATE_ADD(NOW(), INTERVAL -10 DAY));

-- ----------------------------------------------------------------------------
-- Volunteer profiles
-- Maeve (7) is still pending review. Eoin (6) is community service with a target.
-- ----------------------------------------------------------------------------
INSERT INTO `volunteer_profiles`
  (`user_id`, `date_of_birth`, `address`, `emergency_contact`, `skills`, `availability`, `approved`, `volunteer_type`, `required_hours`) VALUES
  (2, '1996-03-14', '12 Oak Street, Belfast, BT7 1AA',        'Sioned Jenkins - 07700 900111', 'Dog handling, first aid', 'Weekday mornings, Saturdays',    1, 'regular',            NULL),
  (3, '2001-07-22', '4 Maple Close, Newtownabbey, BT36 5BB',  'Gareth Price - 07700 900222',   'Cat care, social media',   'Weekends',                        1, 'regular',            NULL),
  (4, '1988-11-30', '88 Elm Road, Bangor, BT20 3CC',          'Niall Davies - 07700 900333',   'Kennel cleaning, driving', 'Flexible',                        1, 'regular',            NULL),
  (5, '1979-05-09', '21 Birch Lane, Holywood, BT18 4DD',      'Owain Hughes - 07700 900444',   'Fundraising, admin',       'Tuesday and Thursday afternoons', 1, 'regular',            NULL),
  (6, '2003-09-17', '7 Cedar Ave, Carrickfergus, BT38 5EE',   'Mair Roberts - 07700 900555',   'Dog walking',              'Weekday evenings',                1, 'community_service',  40.00),
  (7, '2002-01-08', '15 Willow Park, Lisburn, BT28 1FF',      'Aoife Williams - 07700 900666', 'Events, photography',      'Weekends',                        0, 'regular',            NULL);

-- ----------------------------------------------------------------------------
-- Qualifications
-- ----------------------------------------------------------------------------
INSERT INTO `qualifications` (`id`, `name`, `description`, `validity_months`, `created_at`) VALUES
  (1, 'Dog Handling', 'Induction covering lead work, kennel safety and reading canine body language.', 24, DATE_ADD(NOW(), INTERVAL -120 DAY));

INSERT INTO `volunteer_qualifications`
  (`user_id`, `qualification_id`, `awarded_at`, `expires_at`, `awarded_by`) VALUES
  (2, 1, DATE_ADD(CURDATE(), INTERVAL -90 DAY), DATE_ADD(CURDATE(), INTERVAL 270 DAY), 1);

-- ----------------------------------------------------------------------------
-- Opportunities (created by admin, user_id 1).
-- Mix of upcoming (open), a genuinely full one, a cancelled one, past
-- (completed), a weekly series, and one gated by a qualification.
-- ----------------------------------------------------------------------------
INSERT INTO `opportunities`
  (`opportunity_id`, `title`, `description`, `requirements`, `location`,
   `start_date`, `end_date`, `max_volunteers`, `status`, `created_by`, `created_at`,
   `recurrence_rule`, `recurrence_until`, `parent_opportunity_id`, `check_in_code`) VALUES
  (1, 'Morning Dog Walking',
      'Walk our resident dogs around the exercise field and local paths. A great way to give the dogs enrichment and exercise before the day gets busy.',
      'Comfortable with medium/large dogs. Sturdy footwear. Full induction provided.',
      'Main Kennels, Assisi Animal Sanctuary',
      @s1_start, @s1_end, 4, 'completed', 1, DATE_ADD(NOW(), INTERVAL -40 DAY),
      'none', NULL, NULL, 'WALK2A'),
  (2, 'Cattery Care and Socialisation',
      'Feed, clean and spend quiet time socialising our cats, especially the shy ones who need gentle human contact to become adoption-ready.',
      'Calm and patient. Comfortable around cats. No allergies.',
      'Cattery, Assisi Animal Sanctuary',
      @s2_start, @s2_end, 3, 'completed', 1, DATE_ADD(NOW(), INTERVAL -35 DAY),
      'none', NULL, NULL, 'CAT9B3'),
  (3, 'Kennel Deep-Clean',
      'A thorough clean and disinfect of the kennel block to keep our animals healthy and comfortable.',
      'Happy with physical work and cleaning chemicals. PPE provided.',
      'Main Kennels, Assisi Animal Sanctuary',
      @s3_start, @s3_end, 2, 'completed', 1, DATE_ADD(NOW(), INTERVAL -30 DAY),
      'none', NULL, NULL, 'KEN7C4'),
  (4, 'Evening Dog Enrichment',
      'Provide evening enrichment: puzzle feeders, gentle play and calm company to settle the dogs before night.',
      'Confident with dogs. Induction required.',
      'Main Kennels, Assisi Animal Sanctuary',
      @s4_start, @s4_end, 2, 'completed', 1, DATE_ADD(NOW(), INTERVAL -28 DAY),
      'none', NULL, NULL, 'EVE5D2'),
  (5, 'Weekend Adoption Morning',
      'Help greet visitors, introduce animals, and support the rehoming team with paperwork.',
      'Friendly and confident talking to the public.',
      'Adoption Centre, Assisi Animal Sanctuary',
      @s5_start, @s5_end, 6, 'completed', 1, DATE_ADD(NOW(), INTERVAL -25 DAY),
      'none', NULL, NULL, 'ADPT8E'),
  (6, 'Transport Run: Vet Appointments',
      'Drive animals to and from routine vet appointments. Mileage reimbursed.',
      'Full clean UK driving licence. Own car with valid insurance. Dog Handling qualification required.',
      'Depart from Assisi Animal Sanctuary',
      @s6_start, @s6_end, 1, 'cancelled', 1, DATE_ADD(NOW(), INTERVAL -45 DAY),
      'none', NULL, NULL, 'VET3F6'),
  (7, 'Morning Dog Walking',
      'Walk our resident dogs around the exercise field and local paths. A great way to give the dogs enrichment and exercise before the day gets busy.',
      'Comfortable with medium/large dogs. Sturdy footwear. Full induction provided.',
      'Cave Hill Country Park, Belfast',
      @s7_start, @s7_end, 4, 'open', 1, DATE_ADD(NOW(), INTERVAL -20 DAY),
      'none', NULL, NULL, 'WALK4G'),
  (8, 'Cattery Care and Socialisation',
      'Feed, clean and spend quiet time socialising our cats, especially the shy ones who need gentle human contact to become adoption-ready.',
      'Calm and patient. Comfortable around cats. No allergies.',
      'Cattery, Assisi Animal Sanctuary',
      @s8_start, @s8_end, 3, 'open', 1, DATE_ADD(NOW(), INTERVAL -18 DAY),
      'none', NULL, NULL, 'CAT2H8'),
  (9, 'Evening Dog Enrichment',
      'Provide evening enrichment: puzzle feeders, gentle play and calm company to settle the dogs before night.',
      'Confident with dogs. Induction required.',
      'Main Kennels, Assisi Animal Sanctuary',
      @s9_start, @s9_end, 2, 'open', 1, DATE_ADD(NOW(), INTERVAL -16 DAY),
      'none', NULL, NULL, 'EVE9J4'),
  (10, 'Kennel Deep-Clean',
      'A thorough clean and disinfect of the kennel block to keep our animals healthy and comfortable.',
      'Happy with physical work and cleaning chemicals. PPE provided.',
      'Main Kennels, Assisi Animal Sanctuary',
      @s10_start, @s10_end, 2, 'open', 1, DATE_ADD(NOW(), INTERVAL -14 DAY),
      'none', NULL, NULL, 'KEN6K2'),
  (11, 'Fundraising Stall: Summer Fair',
      'Staff our stall at the community summer fair. Sell merchandise, share our story and sign up new supporters.',
      'Outgoing and reliable. Cash-handling done in pairs.',
      'St George''s Market, Belfast',
      @s11_start, @s11_end, 8, 'open', 1, DATE_ADD(NOW(), INTERVAL -12 DAY),
      'none', NULL, NULL, 'FAIR7L'),
  (12, 'Transport Run: Vet Appointments',
      'Drive animals to and from routine vet appointments. Mileage reimbursed.',
      'Full clean UK driving licence. Own car with valid insurance. Dog Handling qualification required.',
      'Depart from Assisi Animal Sanctuary',
      @s12_start, @s12_end, 1, 'open', 1, DATE_ADD(NOW(), INTERVAL -10 DAY),
      'none', NULL, NULL, 'VET8M3'),
  (13, 'Weekly Dog Walking',
      'Standing weekly walk for the kennel dogs. Same route, same crew, rain or shine.',
      'Comfortable with medium/large dogs. Sturdy footwear.',
      'Main Kennels, Assisi Animal Sanctuary',
      @s13_start, @s13_end, 4, 'open', 1, DATE_ADD(NOW(), INTERVAL -8 DAY),
      'weekly', @s13_until, NULL, 'WKLY9N'),
  (14, 'Weekly Dog Walking',
      'Standing weekly walk for the kennel dogs. Same route, same crew, rain or shine.',
      'Comfortable with medium/large dogs. Sturdy footwear.',
      'Main Kennels, Assisi Animal Sanctuary',
      @s14_start, @s14_end, 4, 'open', 1, DATE_ADD(NOW(), INTERVAL -8 DAY),
      'none', NULL, 13, 'WKLY2P'),
  (15, 'Weekly Dog Walking',
      'Standing weekly walk for the kennel dogs. Same route, same crew, rain or shine.',
      'Comfortable with medium/large dogs. Sturdy footwear.',
      'Main Kennels, Assisi Animal Sanctuary',
      @s15_start, @s15_end, 4, 'open', 1, DATE_ADD(NOW(), INTERVAL -8 DAY),
      'none', NULL, 13, 'WKLY5Q');

INSERT INTO `opportunity_qualifications` (`opportunity_id`, `qualification_id`) VALUES
  (12, 1);

-- ----------------------------------------------------------------------------
-- Applications
--   status: pending | accepted | approved | rejected | waitlisted
--   'accepted'/'approved' both count as a filled spot.
--   Opp 9 is genuinely full (2/2). Opp 10 is full with a waitlisted volunteer.
-- ----------------------------------------------------------------------------
INSERT INTO `applications`
  (`application_id`, `user_id`, `opportunity_id`, `status`, `applied_at`, `rejection_reason`) VALUES
  -- Past: Morning Dog Walking (1)
  (1,  2, 1,  'approved',   DATE_ADD(NOW(), INTERVAL -30 DAY), NULL),
  (2,  4, 1,  'approved',   DATE_ADD(NOW(), INTERVAL -29 DAY), NULL),
  -- Past: Cattery (2)
  (3,  3, 2,  'approved',   DATE_ADD(NOW(), INTERVAL -28 DAY), NULL),
  (4,  5, 2,  'approved',   DATE_ADD(NOW(), INTERVAL -27 DAY), NULL),
  -- Past: Kennel Deep-Clean (3)
  (5,  4, 3,  'approved',   DATE_ADD(NOW(), INTERVAL -22 DAY), NULL),
  -- Past: Evening enrichment (4)
  (6,  2, 4,  'approved',   DATE_ADD(NOW(), INTERVAL -20 DAY), NULL),
  (7,  4, 4,  'approved',   DATE_ADD(NOW(), INTERVAL -19 DAY), NULL),
  -- Past: Adoption morning (5)
  (8,  3, 5,  'approved',   DATE_ADD(NOW(), INTERVAL -12 DAY), NULL),
  (9,  2, 5,  'approved',   DATE_ADD(NOW(), INTERVAL -11 DAY), NULL),
  -- Cancelled transport (6)
  (10, 4, 6,  'rejected',   DATE_ADD(NOW(), INTERVAL -44 DAY), 'Event cancelled: vet rescheduled in-house.'),
  -- Upcoming: Morning Dog Walking (7) - Alex will request a swap
  (11, 2, 7,  'accepted',   DATE_ADD(NOW(), INTERVAL -15 DAY), NULL),
  (12, 4, 7,  'accepted',   DATE_ADD(NOW(), INTERVAL -14 DAY), NULL),
  (13, 6, 7,  'pending',    DATE_ADD(NOW(), INTERVAL  -2 DAY), NULL),
  -- Upcoming: Cattery (8)
  (14, 3, 8,  'approved',   DATE_ADD(NOW(), INTERVAL -13 DAY), NULL),
  (15, 5, 8,  'pending',    DATE_ADD(NOW(), INTERVAL  -1 DAY), NULL),
  -- Upcoming: Evening enrichment (9) - full: 2 accepted against max 2
  (16, 2, 9,  'accepted',   DATE_ADD(NOW(), INTERVAL -12 DAY), NULL),
  (17, 4, 9,  'accepted',   DATE_ADD(NOW(), INTERVAL -12 DAY), NULL),
  -- Upcoming: Kennel Deep-Clean (10) - full + waitlist
  (18, 3, 10, 'accepted',   DATE_ADD(NOW(), INTERVAL -10 DAY), NULL),
  (19, 5, 10, 'accepted',   DATE_ADD(NOW(), INTERVAL  -9 DAY), NULL),
  (20, 6, 10, 'waitlisted', DATE_ADD(NOW(), INTERVAL  -3 DAY), NULL),
  -- Upcoming: Fundraising stall (11)
  (21, 5, 11, 'approved',   DATE_ADD(NOW(), INTERVAL  -8 DAY), NULL),
  -- Upcoming: Transport (12) - requires Dog Handling
  (22, 2, 12, 'accepted',   DATE_ADD(NOW(), INTERVAL  -6 DAY), NULL),
  -- Recurring parent (13)
  (23, 2, 13, 'accepted',   DATE_ADD(NOW(), INTERVAL  -5 DAY), NULL);

-- ----------------------------------------------------------------------------
-- Open swap on Alex's upcoming morning walk (application 11).
-- public_at is in the past so the 12-hour waitlist window has ended.
-- ----------------------------------------------------------------------------
INSERT INTO `swap_requests`
  (`application_id`, `requested_at`, `status`, `public_at`) VALUES
  (11, DATE_ADD(NOW(), INTERVAL -14 HOUR), 'open', DATE_ADD(NOW(), INTERVAL -2 HOUR));

-- ----------------------------------------------------------------------------
-- Feedback on a past shift (Alex, application 1) plus one flagged comment
-- ----------------------------------------------------------------------------
INSERT INTO `shift_feedback`
  (`application_id`, `rating`, `comment`, `flag_concern`, `created_at`) VALUES
  (1, 5, 'Lovely morning with the kennel dogs. The new puzzle feeders went down well.', 0, DATE_ADD(NOW(), INTERVAL -17 DAY)),
  (3, 3, 'Cattery was short-staffed and two of the shy cats were quite stressed.', 1, DATE_ADD(NOW(), INTERVAL -13 DAY));

-- ----------------------------------------------------------------------------
-- Pending group booking on the fundraising stall (does not count against capacity)
-- ----------------------------------------------------------------------------
INSERT INTO `group_bookings`
  (`opportunity_id`, `group_name`, `contact_name`, `contact_email`, `size`, `status`, `notes`, `created_at`) VALUES
  (11, 'Belfast Metropolitan College', 'Orla Magee', 'orla.magee@bmc.example.com', 6, 'pending',
   'Student volunteer group looking to help on the stall for the morning.', DATE_ADD(NOW(), INTERVAL -4 DAY));

-- ----------------------------------------------------------------------------
-- Volunteer hours (approved ones count toward totals, badges, streaks and the chart)
-- ----------------------------------------------------------------------------
INSERT INTO `volunteer_hours`
  (`user_id`, `opportunity_id`, `date`, `hours`, `approved`, `created_at`) VALUES
  -- Alex (2): ~25.5 approved hours across three months -> Regular Volunteer badge + streak
  (2, 1,    DATE_ADD(CURDATE(), INTERVAL -18 DAY), 3.00, 1, DATE_ADD(NOW(), INTERVAL -18 DAY)),
  (2, 4,    DATE_ADD(CURDATE(), INTERVAL  -7 DAY), 1.50, 1, DATE_ADD(NOW(), INTERVAL  -7 DAY)),
  (2, 5,    DATE_ADD(CURDATE(), INTERVAL  -3 DAY), 3.00, 1, DATE_ADD(NOW(), INTERVAL  -3 DAY)),
  (2, NULL, @hours_m1,                             8.00, 1, DATE_ADD(NOW(), INTERVAL -35 DAY)),
  (2, NULL, @hours_m2,                             8.00, 1, DATE_ADD(NOW(), INTERVAL -65 DAY)),
  (2, NULL, @hours_m0,                             2.00, 0, DATE_ADD(NOW(), INTERVAL  -2 DAY)),
  -- Niamh (3)
  (3, 2,    DATE_ADD(CURDATE(), INTERVAL -14 DAY), 3.00, 1, DATE_ADD(NOW(), INTERVAL -14 DAY)),
  (3, 5,    DATE_ADD(CURDATE(), INTERVAL  -3 DAY), 3.00, 1, DATE_ADD(NOW(), INTERVAL  -3 DAY)),
  (3, NULL, @hours_m1,                             4.00, 1, DATE_ADD(NOW(), INTERVAL -35 DAY)),
  (3, NULL, DATE_ADD(CURDATE(), INTERVAL  -1 DAY), 2.00, 0, DATE_ADD(NOW(), INTERVAL  -1 DAY)),
  -- Ciaran (4)
  (4, 1,    DATE_ADD(CURDATE(), INTERVAL -18 DAY), 3.00, 1, DATE_ADD(NOW(), INTERVAL -18 DAY)),
  (4, 3,    DATE_ADD(CURDATE(), INTERVAL -10 DAY), 3.00, 1, DATE_ADD(NOW(), INTERVAL -10 DAY)),
  (4, 4,    DATE_ADD(CURDATE(), INTERVAL  -7 DAY), 1.50, 1, DATE_ADD(NOW(), INTERVAL  -7 DAY)),
  (4, NULL, @hours_m1,                             3.00, 1, DATE_ADD(NOW(), INTERVAL -35 DAY)),
  -- Siobhan (5)
  (5, 2,    DATE_ADD(CURDATE(), INTERVAL -14 DAY), 3.00, 1, DATE_ADD(NOW(), INTERVAL -14 DAY)),
  (5, 11,   DATE_ADD(CURDATE(), INTERVAL  -2 DAY), 4.00, 0, DATE_ADD(NOW(), INTERVAL  -2 DAY)),
  -- Eoin (6): community service progress toward 40 hours
  (6, NULL, @hours_m1,                            6.00, 1, DATE_ADD(NOW(), INTERVAL -35 DAY)),
  (6, NULL, @hours_m0,                            6.00, 1, DATE_ADD(NOW(), INTERVAL  -5 DAY));

-- ----------------------------------------------------------------------------
-- Tags (ids come from schema.sql seed: 1 dogs, 2 cats, 4 cleaning, 5 events,
-- 6 admin, 7 transport, 9 fundraising)
-- ----------------------------------------------------------------------------
INSERT INTO `volunteer_tags` (`user_id`, `tag_id`) VALUES
  (2, 1), (2, 7),
  (3, 2), (3, 5),
  (4, 1), (4, 4),
  (5, 9), (5, 6),
  (6, 1);

INSERT INTO `opportunity_tags` (`opportunity_id`, `tag_id`) VALUES
  (1, 1), (2, 2), (3, 4), (4, 1), (5, 5), (6, 7),
  (7, 1), (8, 2), (9, 1), (10, 4), (11, 9), (11, 5), (12, 7),
  (13, 1), (14, 1), (15, 1);
