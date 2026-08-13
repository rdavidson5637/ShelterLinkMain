-- ============================================================================
-- ShelterLink — Sample / Seed Data
-- ----------------------------------------------------------------------------
-- Loads a realistic set of demo accounts, opportunities, applications and
-- logged hours so the app is immediately usable and demonstrable.
--
-- Load AFTER schema.sql:
--   mysql -u root -proot -h 127.0.0.1 -P 8889 ShelterLink < database/seed.sql
--
-- Login credentials created by this seed:
--   Admin      →  admin@shelterlink.org      /  Admin123!
--   Volunteers →  (any volunteer email below) /  Password1
--
-- Password hashes are real bcrypt hashes, so these logins work out of the box.
-- ============================================================================

USE `ShelterLink`;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE `volunteer_hours`;
TRUNCATE TABLE `applications`;
TRUNCATE TABLE `volunteer_profiles`;
TRUNCATE TABLE `opportunities`;
TRUNCATE TABLE `users`;
SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------------------------------------------------------
-- Users  (password for admin = "Admin123!", all volunteers = "Password1")
-- ----------------------------------------------------------------------------
INSERT INTO `users`
  (`user_id`, `first_name`, `last_name`, `name`, `phone`, `email`, `password`, `role`, `created_at`) VALUES
  (1, 'Rhian',  'Morgan',   'Rhian Morgan',   '029 2018 0001', 'admin@shelterlink.org',   '$2b$10$LDOn5KOmQXzlxBVW3FAozOVaHNMAv7aPTor624vuhW59P9YiUMBU6', 'admin',     '2026-05-01 09:00:00'),
  (2, 'Alex',   'Jenkins',  'Alex Jenkins',   '07700 900201', 'alex.jenkins@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', '2026-05-04 10:15:00'),
  (3, 'Bethan', 'Price',    'Bethan Price',   '07700 900202', 'bethan.price@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', '2026-05-06 14:20:00'),
  (4, 'Carwyn', 'Davies',   'Carwyn Davies',  '07700 900203', 'carwyn.davies@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2','volunteer', '2026-05-10 11:05:00'),
  (5, 'Delyth', 'Hughes',   'Delyth Hughes',  '07700 900204', 'delyth.hughes@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2','volunteer', '2026-05-18 16:40:00'),
  (6, 'Evan',   'Roberts',  'Evan Roberts',   '07700 900205', 'evan.roberts@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', '2026-06-02 08:50:00'),
  (7, 'Ffion',  'Williams', 'Ffion Williams', '07700 900206', 'ffion.williams@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2','volunteer', '2026-06-21 13:30:00');

-- ----------------------------------------------------------------------------
-- Volunteer profiles (some approved, one still pending review)
-- ----------------------------------------------------------------------------
INSERT INTO `volunteer_profiles`
  (`user_id`, `date_of_birth`, `address`, `emergency_contact`, `skills`, `availability`, `approved`) VALUES
  (2, '1996-03-14', '12 Oak Street, Cardiff, CF10 1AA', 'Sioned Jenkins — 07700 900111', 'Dog handling, first aid', 'Weekday mornings, Saturdays',                1),
  (3, '2001-07-22', '4 Maple Close, Newport, NP20 2BB', 'Gareth Price — 07700 900222',   'Cat care, social media',   'Weekends',                                    1),
  (4, '1988-11-30', '88 Elm Road, Swansea, SA1 3CC',    'Non — 07700 900333',            'Kennel cleaning, driving', 'Flexible',                                    1),
  (5, '1979-05-09', '21 Birch Lane, Bridgend, CF31 4DD','Owain Hughes — 07700 900444',   'Fundraising, admin',       'Tuesday and Thursday afternoons',             1),
  (6, '2003-09-17', '7 Cedar Ave, Cardiff, CF14 5EE',   'Mair Roberts — 07700 900555',   'Dog walking',              'Weekday evenings',                            0);

-- ----------------------------------------------------------------------------
-- Opportunities (created by admin, user_id 1). Today is ~2026-07-07.
-- Mix of upcoming (open), a full one, a cancelled one, and past (completed).
-- ----------------------------------------------------------------------------
INSERT INTO `opportunities`
  (`opportunity_id`, `title`, `description`, `requirements`, `location`, `start_date`, `end_date`, `max_volunteers`, `status`, `created_by`, `created_at`) VALUES
  (1, 'Morning Dog Walking',
      'Walk our resident dogs around the exercise field and local paths. A great way to give the dogs enrichment and exercise before the day gets busy.',
      'Comfortable with medium/large dogs. Sturdy footwear. Full induction provided.',
      'Main Kennels — Field Entrance', '2026-07-10 08:00:00', '2026-07-10 10:00:00', 4, 'open', 1, '2026-06-15 09:00:00'),
  (2, 'Cattery Care & Socialisation',
      'Feed, clean and spend quiet time socialising our cats, especially the shy ones who need gentle human contact to become adoption-ready.',
      'Calm and patient. Comfortable around cats. No allergies.',
      'Cattery Block B', '2026-07-12 09:30:00', '2026-07-12 12:00:00', 3, 'open', 1, '2026-06-16 10:00:00'),
  (3, 'Weekend Adoption Event',
      'Help run our pop-up adoption day: greet visitors, introduce animals, and support the rehoming team with paperwork.',
      'Friendly and confident talking to the public. Full day commitment preferred.',
      'Cardiff City Retail Park', '2026-07-20 10:00:00', '2026-07-20 16:00:00', 6, 'open', 1, '2026-06-20 11:30:00'),
  (4, 'Kennel Deep-Clean',
      'A thorough clean and disinfect of the kennel block to keep our animals healthy and comfortable.',
      'Happy with physical work and cleaning chemicals. PPE provided.',
      'Main Kennels', '2026-07-15 13:00:00', '2026-07-15 16:00:00', 2, 'open', 1, '2026-06-22 14:00:00'),
  (5, 'Fundraising Stall — Summer Fair',
      'Staff our stall at the community summer fair. Sell merchandise, share our story and sign up new supporters.',
      'Outgoing and reliable. Cash-handling done in pairs.',
      'Bute Park, Cardiff', '2026-08-02 10:00:00', '2026-08-02 15:00:00', 5, 'open', 1, '2026-06-28 09:15:00'),
  (6, 'Evening Dog Enrichment (FULL)',
      'Provide evening enrichment — puzzle feeders, gentle play and calm company — to settle the dogs before night.',
      'Confident with dogs. Induction required.',
      'Main Kennels', '2026-07-11 18:00:00', '2026-07-11 19:30:00', 2, 'open', 1, '2026-06-18 17:00:00'),
  (7, 'Transport Run — Vet Appointments',
      'Drive animals to and from routine vet appointments. Mileage reimbursed.',
      'Full clean UK driving licence. Own car with valid insurance.',
      'Depart from Main Kennels', '2026-06-30 09:00:00', '2026-06-30 13:00:00', 1, 'cancelled', 1, '2026-06-10 12:00:00'),
  (8, 'June Dog Walking',
      'Past shift — daily dog walking through late June.',
      'Comfortable with dogs.',
      'Main Kennels — Field Entrance', '2026-06-21 08:00:00', '2026-06-21 10:00:00', 4, 'completed', 1, '2026-06-01 09:00:00'),
  (9, 'June Cattery Care',
      'Past shift — cattery cleaning and socialisation in June.',
      'Comfortable around cats.',
      'Cattery Block B', '2026-06-28 09:30:00', '2026-06-28 12:00:00', 3, 'completed', 1, '2026-06-05 10:00:00');

-- ----------------------------------------------------------------------------
-- Applications
--   status: pending | accepted | approved | rejected
--   'accepted'/'approved' both count as a filled spot.
-- ----------------------------------------------------------------------------
INSERT INTO `applications`
  (`user_id`, `opportunity_id`, `status`, `applied_at`, `rejection_reason`) VALUES
  -- Upcoming: Morning Dog Walking (id 1)
  (2, 1, 'approved', '2026-06-16 09:10:00', NULL),
  (4, 1, 'accepted', '2026-06-17 12:00:00', NULL),
  (6, 1, 'pending',  '2026-07-02 19:20:00', NULL),
  -- Cattery Care (id 2)
  (3, 2, 'approved', '2026-06-18 08:30:00', NULL),
  (5, 2, 'pending',  '2026-07-03 15:00:00', NULL),
  -- Adoption Event (id 3)
  (2, 3, 'pending',  '2026-07-01 10:00:00', NULL),
  (3, 3, 'approved', '2026-06-25 14:15:00', NULL),
  -- Evening Dog Enrichment (id 6) — full: 2 approved against max 2
  (2, 6, 'approved', '2026-06-19 18:10:00', NULL),
  (4, 6, 'approved', '2026-06-19 18:45:00', NULL),
  -- Fundraising (id 5)
  (5, 5, 'approved', '2026-06-29 09:30:00', NULL),
  -- Transport run (id 7, cancelled event) — one rejected
  (4, 7, 'rejected', '2026-06-11 10:00:00', 'Event cancelled — vet rescheduled in-house.'),
  -- Past completed shifts (approved)
  (2, 8, 'approved', '2026-06-02 09:00:00', NULL),
  (4, 8, 'approved', '2026-06-03 09:00:00', NULL),
  (3, 9, 'approved', '2026-06-06 10:00:00', NULL),
  (5, 9, 'approved', '2026-06-07 10:00:00', NULL);

-- ----------------------------------------------------------------------------
-- Volunteer hours (approved ones count toward totals & badges)
-- ----------------------------------------------------------------------------
INSERT INTO `volunteer_hours`
  (`user_id`, `opportunity_id`, `date`, `hours`, `approved`) VALUES
  -- Alex (2): plenty of approved hours → several badges
  (2, 8, '2026-06-21', 2.00, 1),
  (2, 8, '2026-06-22', 2.00, 1),
  (2, 6, '2026-06-25', 1.50, 1),
  (2, 1, '2026-07-01', 2.00, 1),
  (2, NULL, '2026-07-04', 3.00, 0),  -- pending approval
  -- Bethan (3)
  (3, 9, '2026-06-28', 2.50, 1),
  (3, 9, '2026-06-29', 2.50, 1),
  (3, NULL, '2026-07-05', 2.00, 0),  -- pending
  -- Carwyn (4)
  (4, 8, '2026-06-21', 2.00, 1),
  (4, 6, '2026-06-25', 1.50, 1),
  -- Delyth (5)
  (5, 9, '2026-06-28', 2.50, 1),
  (5, 5, '2026-07-02', 4.00, 0),     -- pending
  -- Evan (6): none yet (still awaiting profile approval)
  (7, NULL, '2026-07-06', 1.00, 0);  -- Ffion, pending
