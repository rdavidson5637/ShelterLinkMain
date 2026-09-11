-- ============================================================================
-- ShelterLink - Sample / Seed Data (Postgres)
-- Converted from database/seed.sql. Bcrypt hashes are unchanged.
-- ============================================================================

-- ============================================================================
-- ShelterLink - Sample / Seed Data
-- ----------------------------------------------------------------------------
-- Loads a realistic set of demo accounts, opportunities, applications and
-- logged hours so the app is immediately usable and demonstrable.
--
-- Every shift, application and hours row is dated relative to NOW() / CURDATE()
-- so a fresh npm run db:reset looks alive on any calendar date.
--
-- Load AFTER schema.pg.sql via: node scripts/setup-db.js --seed
--
-- Login credentials created by this seed:
--   Admin      ->  admin@shelterlink.org      /  Admin123!
--   Volunteers ->  (any volunteer email below) /  Password1
--
-- Password hashes are real bcrypt hashes, so these logins work out of the box.
-- ============================================================================

TRUNCATE TABLE animal_activity RESTART IDENTITY CASCADE;
TRUNCATE TABLE opportunity_animals RESTART IDENTITY CASCADE;
TRUNCATE TABLE transport_legs RESTART IDENTITY CASCADE;
TRUNCATE TABLE transport_runs RESTART IDENTITY CASCADE;
TRUNCATE TABLE incidents RESTART IDENTITY CASCADE;
TRUNCATE TABLE animals RESTART IDENTITY CASCADE;
TRUNCATE TABLE shift_feedback RESTART IDENTITY CASCADE;
TRUNCATE TABLE swap_requests RESTART IDENTITY CASCADE;
TRUNCATE TABLE volunteer_hours RESTART IDENTITY CASCADE;
TRUNCATE TABLE applications RESTART IDENTITY CASCADE;
TRUNCATE TABLE group_bookings RESTART IDENTITY CASCADE;
TRUNCATE TABLE opportunity_qualifications RESTART IDENTITY CASCADE;
TRUNCATE TABLE volunteer_qualifications RESTART IDENTITY CASCADE;
TRUNCATE TABLE volunteer_tags RESTART IDENTITY CASCADE;
TRUNCATE TABLE opportunity_tags RESTART IDENTITY CASCADE;
TRUNCATE TABLE opportunity_match_queue RESTART IDENTITY CASCADE;
TRUNCATE TABLE tag_digest_log RESTART IDENTITY CASCADE;
TRUNCATE TABLE opportunity_templates RESTART IDENTITY CASCADE;
TRUNCATE TABLE volunteer_profiles RESTART IDENTITY CASCADE;
TRUNCATE TABLE opportunities RESTART IDENTITY CASCADE;
TRUNCATE TABLE qualifications RESTART IDENTITY CASCADE;
TRUNCATE TABLE users RESTART IDENTITY CASCADE;

-- Shift datetimes: 6 past + 9 upcoming (shelter hours, never midnight).
-- Past

-- Upcoming

-- Recurring weekly dog walking (parent + two children)

-- Hours spread across months so streaks and the monthly chart have data

-- ----------------------------------------------------------------------------
-- Users  (password for admin = "Admin123!", all volunteers = "Password1")
-- ----------------------------------------------------------------------------
INSERT INTO users
  (user_id, first_name, last_name, name, phone, email, password, role, created_at) VALUES
  (1, 'Ciara',  'Gallagher', 'Ciara Gallagher', '028 9083 0001', 'admin@shelterlink.org',    '$2b$10$LDOn5KOmQXzlxBVW3FAozOVaHNMAv7aPTor624vuhW59P9YiUMBU6', 'admin',     CURRENT_TIMESTAMP + INTERVAL '-90 days'),
  (2, 'Alex',   'Jenkins',   'Alex Jenkins',    '07700 900201',  'alex.jenkins@example.com', '$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', CURRENT_TIMESTAMP + INTERVAL '-85 days'),
  (3, 'Niamh',  'Price',     'Niamh Price',     '07700 900202',  'niamh.price@example.com',  '$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', CURRENT_TIMESTAMP + INTERVAL '-80 days'),
  (4, 'Ciaran', 'Davies',    'Ciaran Davies',   '07700 900203',  'ciaran.davies@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', CURRENT_TIMESTAMP + INTERVAL '-75 days'),
  (5, 'Siobhan','Hughes',    'Siobhan Hughes',  '07700 900204',  'siobhan.hughes@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2','volunteer', CURRENT_TIMESTAMP + INTERVAL '-70 days'),
  (6, 'Eoin',   'Roberts',   'Eoin Roberts',    '07700 900205',  'eoin.roberts@example.com', '$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2', 'volunteer', CURRENT_TIMESTAMP + INTERVAL '-40 days'),
  (7, 'Maeve',  'Williams',  'Maeve Williams',  '07700 900206',  'maeve.williams@example.com','$2b$10$mVXam9SA8ZFtje4V4ATOP.alMu7dUhNPtKlflHW1gQ.7kGUs5U9/2','volunteer', CURRENT_TIMESTAMP + INTERVAL '-10 days');

-- ----------------------------------------------------------------------------
-- Volunteer profiles
-- Maeve (7) is still pending review. Eoin (6) is community service with a target.
-- ----------------------------------------------------------------------------
INSERT INTO volunteer_profiles
  (user_id, date_of_birth, address, emergency_contact, skills, availability, approved, volunteer_type, required_hours) VALUES
  (2, '1996-03-14', '12 Oak Street, Belfast, BT7 1AA',        'Sioned Jenkins - 07700 900111', 'Dog handling, first aid', 'Weekday mornings, Saturdays',    1, 'regular',            NULL),
  (3, '2001-07-22', '4 Maple Close, Newtownabbey, BT36 5BB',  'Gareth Price - 07700 900222',   'Cat care, social media',   'Weekends',                        1, 'regular',            NULL),
  (4, '1988-11-30', '88 Elm Road, Bangor, BT20 3CC',          'Niall Davies - 07700 900333',   'Kennel cleaning, driving', 'Flexible',                        1, 'regular',            NULL),
  (5, '1979-05-09', '21 Birch Lane, Holywood, BT18 4DD',      'Owain Hughes - 07700 900444',   'Fundraising, admin',       'Tuesday and Thursday afternoons', 1, 'regular',            NULL),
  (6, '2003-09-17', '7 Cedar Ave, Carrickfergus, BT38 5EE',   'Mair Roberts - 07700 900555',   'Dog walking',              'Weekday evenings',                1, 'community_service',  40.00),
  (7, '2002-01-08', '15 Willow Park, Lisburn, BT28 1FF',      'Aoife Williams - 07700 900666', 'Events, photography',      'Weekends',                        0, 'regular',            NULL);

-- ----------------------------------------------------------------------------
-- Qualifications
-- ----------------------------------------------------------------------------
INSERT INTO qualifications (id, name, description, validity_months, created_at) VALUES
  (1, 'Dog Handling', 'Induction covering lead work, kennel safety and reading canine body language.', 24, CURRENT_TIMESTAMP + INTERVAL '-120 days');

INSERT INTO volunteer_qualifications
  (user_id, qualification_id, awarded_at, expires_at, awarded_by) VALUES
  (2, 1, CURRENT_DATE + INTERVAL '-90 days', CURRENT_DATE + INTERVAL '270 days', 1);

-- ----------------------------------------------------------------------------
-- Opportunities (created by admin, user_id 1).
-- Mix of upcoming (open), a genuinely full one, a cancelled one, past
-- (completed), a weekly series, and one gated by a qualification.
-- ----------------------------------------------------------------------------
INSERT INTO opportunities
  (opportunity_id, title, description, requirements, location,
   start_date, end_date, max_volunteers, status, created_by, created_at,
   recurrence_rule, recurrence_until, parent_opportunity_id, check_in_code) VALUES
  (1, 'Morning Dog Walking',
      'Walk our resident dogs around the exercise field and local paths. A great way to give the dogs enrichment and exercise before the day gets busy.',
      'Comfortable with medium/large dogs. Sturdy footwear. Full induction provided.',
      'Main Kennels, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '-18 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '-18 days') + TIME '12:00:00'), 4, 'completed', 1, CURRENT_TIMESTAMP + INTERVAL '-40 days',
      'none', NULL, NULL, 'WALK2A'),
  (2, 'Cattery Care and Socialisation',
      'Feed, clean and spend quiet time socialising our cats, especially the shy ones who need gentle human contact to become adoption-ready.',
      'Calm and patient. Comfortable around cats. No allergies.',
      'Cattery, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '-14 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '-14 days') + TIME '12:00:00'), 3, 'completed', 1, CURRENT_TIMESTAMP + INTERVAL '-35 days',
      'none', NULL, NULL, 'CAT9B3'),
  (3, 'Kennel Deep-Clean',
      'A thorough clean and disinfect of the kennel block to keep our animals healthy and comfortable.',
      'Happy with physical work and cleaning chemicals. PPE provided.',
      'Main Kennels, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '-10 days') + TIME '13:00:00'), ((CURRENT_DATE + INTERVAL '-10 days') + TIME '16:00:00'), 2, 'completed', 1, CURRENT_TIMESTAMP + INTERVAL '-30 days',
      'none', NULL, NULL, 'KEN7C4'),
  (4, 'Evening Dog Enrichment',
      'Provide evening enrichment: puzzle feeders, gentle play and calm company to settle the dogs before night.',
      'Confident with dogs. Induction required.',
      'Main Kennels, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '-7 days') + TIME '18:00:00'), ((CURRENT_DATE + INTERVAL '-7 days') + TIME '19:30:00'), 2, 'completed', 1, CURRENT_TIMESTAMP + INTERVAL '-28 days',
      'none', NULL, NULL, 'EVE5D2'),
  (5, 'Weekend Adoption Morning',
      'Help greet visitors, introduce animals, and support the rehoming team with paperwork.',
      'Friendly and confident talking to the public.',
      'Adoption Centre, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '-3 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '-3 days') + TIME '12:00:00'), 6, 'completed', 1, CURRENT_TIMESTAMP + INTERVAL '-25 days',
      'none', NULL, NULL, 'ADPT8E'),
  (6, 'Transport Run: Vet Appointments',
      'Drive animals to and from routine vet appointments. Mileage reimbursed.',
      'Full clean UK driving licence. Own car with valid insurance. Dog Handling qualification required.',
      'Depart from Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '-21 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '-21 days') + TIME '12:00:00'), 1, 'cancelled', 1, CURRENT_TIMESTAMP + INTERVAL '-45 days',
      'none', NULL, NULL, 'VET3F6'),
  (7, 'Morning Dog Walking',
      'Walk our resident dogs around the exercise field and local paths. A great way to give the dogs enrichment and exercise before the day gets busy.',
      'Comfortable with medium/large dogs. Sturdy footwear. Full induction provided.',
      'Cave Hill Country Park, Belfast',
      ((CURRENT_DATE + INTERVAL '2 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '2 days') + TIME '12:00:00'), 4, 'open', 1, CURRENT_TIMESTAMP + INTERVAL '-20 days',
      'none', NULL, NULL, 'WALK4G'),
  (8, 'Cattery Care and Socialisation',
      'Feed, clean and spend quiet time socialising our cats, especially the shy ones who need gentle human contact to become adoption-ready.',
      'Calm and patient. Comfortable around cats. No allergies.',
      'Cattery, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '4 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '4 days') + TIME '12:00:00'), 3, 'open', 1, CURRENT_TIMESTAMP + INTERVAL '-18 days',
      'none', NULL, NULL, 'CAT2H8'),
  (9, 'Evening Dog Enrichment',
      'Provide evening enrichment: puzzle feeders, gentle play and calm company to settle the dogs before night.',
      'Confident with dogs. Induction required.',
      'Main Kennels, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '5 days') + TIME '18:00:00'), ((CURRENT_DATE + INTERVAL '5 days') + TIME '19:30:00'), 2, 'open', 1, CURRENT_TIMESTAMP + INTERVAL '-16 days',
      'none', NULL, NULL, 'EVE9J4'),
  (10, 'Kennel Deep-Clean',
      'A thorough clean and disinfect of the kennel block to keep our animals healthy and comfortable.',
      'Happy with physical work and cleaning chemicals. PPE provided.',
      'Main Kennels, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '7 days') + TIME '13:00:00'), ((CURRENT_DATE + INTERVAL '7 days') + TIME '16:00:00'), 2, 'open', 1, CURRENT_TIMESTAMP + INTERVAL '-14 days',
      'none', NULL, NULL, 'KEN6K2'),
  (11, 'Fundraising Stall: Summer Fair',
      'Staff our stall at the community summer fair. Sell merchandise, share our story and sign up new supporters.',
      'Outgoing and reliable. Cash-handling done in pairs.',
      'St George''s Market, Belfast',
      ((CURRENT_DATE + INTERVAL '10 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '10 days') + TIME '12:00:00'), 8, 'open', 1, CURRENT_TIMESTAMP + INTERVAL '-12 days',
      'none', NULL, NULL, 'FAIR7L'),
  (12, 'Transport Run: Vet Appointments',
      'Drive animals to and from routine vet appointments. Mileage reimbursed.',
      'Full clean UK driving licence. Own car with valid insurance. Dog Handling qualification required.',
      'Depart from Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '12 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '12 days') + TIME '12:00:00'), 1, 'open', 1, CURRENT_TIMESTAMP + INTERVAL '-10 days',
      'none', NULL, NULL, 'VET8M3'),
  (13, 'Weekly Dog Walking',
      'Standing weekly walk for the kennel dogs. Same route, same crew, rain or shine.',
      'Comfortable with medium/large dogs. Sturdy footwear.',
      'Main Kennels, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '1 day') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '1 day') + TIME '12:00:00'), 4, 'open', 1, CURRENT_TIMESTAMP + INTERVAL '-8 days',
      'weekly', (CURRENT_DATE + INTERVAL '21 days'), NULL, 'WKLY9N'),
  (14, 'Weekly Dog Walking',
      'Standing weekly walk for the kennel dogs. Same route, same crew, rain or shine.',
      'Comfortable with medium/large dogs. Sturdy footwear.',
      'Main Kennels, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '8 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '8 days') + TIME '12:00:00'), 4, 'open', 1, CURRENT_TIMESTAMP + INTERVAL '-8 days',
      'none', NULL, 13, 'WKLY2P'),
  (15, 'Weekly Dog Walking',
      'Standing weekly walk for the kennel dogs. Same route, same crew, rain or shine.',
      'Comfortable with medium/large dogs. Sturdy footwear.',
      'Main Kennels, Assisi Animal Sanctuary',
      ((CURRENT_DATE + INTERVAL '15 days') + TIME '09:00:00'), ((CURRENT_DATE + INTERVAL '15 days') + TIME '12:00:00'), 4, 'open', 1, CURRENT_TIMESTAMP + INTERVAL '-8 days',
      'none', NULL, 13, 'WKLY5Q');

INSERT INTO opportunity_qualifications (opportunity_id, qualification_id) VALUES
  (12, 1);

-- ----------------------------------------------------------------------------
-- Applications
--   status: pending | accepted | approved | rejected | waitlisted
--   'accepted'/'approved' both count as a filled spot.
--   Opp 9 is genuinely full (2/2). Opp 10 is full with a waitlisted volunteer.
-- ----------------------------------------------------------------------------
INSERT INTO applications
  (application_id, user_id, opportunity_id, status, applied_at, rejection_reason) VALUES
  -- Past: Morning Dog Walking (1)
  (1,  2, 1,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-30 days', NULL),
  (2,  4, 1,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-29 days', NULL),
  -- Past: Cattery (2)
  (3,  3, 2,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-28 days', NULL),
  (4,  5, 2,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-27 days', NULL),
  -- Past: Kennel Deep-Clean (3)
  (5,  4, 3,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-22 days', NULL),
  -- Past: Evening enrichment (4)
  (6,  2, 4,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-20 days', NULL),
  (7,  4, 4,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-19 days', NULL),
  -- Past: Adoption morning (5)
  (8,  3, 5,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-12 days', NULL),
  (9,  2, 5,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-11 days', NULL),
  -- Cancelled transport (6)
  (10, 4, 6,  'rejected',   CURRENT_TIMESTAMP + INTERVAL '-44 days', 'Event cancelled: vet rescheduled in-house.'),
  -- Upcoming: Morning Dog Walking (7) - Alex will request a swap
  (11, 2, 7,  'accepted',   CURRENT_TIMESTAMP + INTERVAL '-15 days', NULL),
  (12, 4, 7,  'accepted',   CURRENT_TIMESTAMP + INTERVAL '-14 days', NULL),
  (13, 6, 7,  'pending',    CURRENT_TIMESTAMP + INTERVAL '-2 days', NULL),
  -- Upcoming: Cattery (8)
  (14, 3, 8,  'approved',   CURRENT_TIMESTAMP + INTERVAL '-13 days', NULL),
  (15, 5, 8,  'pending',    CURRENT_TIMESTAMP + INTERVAL '-1 days', NULL),
  -- Upcoming: Evening enrichment (9) - full: 2 accepted against max 2
  (16, 2, 9,  'accepted',   CURRENT_TIMESTAMP + INTERVAL '-12 days', NULL),
  (17, 4, 9,  'accepted',   CURRENT_TIMESTAMP + INTERVAL '-12 days', NULL),
  -- Upcoming: Kennel Deep-Clean (10) - full + waitlist
  (18, 3, 10, 'accepted',   CURRENT_TIMESTAMP + INTERVAL '-10 days', NULL),
  (19, 5, 10, 'accepted',   CURRENT_TIMESTAMP + INTERVAL '-9 days', NULL),
  (20, 6, 10, 'waitlisted', CURRENT_TIMESTAMP + INTERVAL '-3 days', NULL),
  -- Upcoming: Fundraising stall (11)
  (21, 5, 11, 'approved',   CURRENT_TIMESTAMP + INTERVAL '-8 days', NULL),
  -- Upcoming: Transport (12) - requires Dog Handling
  (22, 2, 12, 'accepted',   CURRENT_TIMESTAMP + INTERVAL '-6 days', NULL),
  -- Recurring parent (13)
  (23, 2, 13, 'accepted',   CURRENT_TIMESTAMP + INTERVAL '-5 days', NULL);

-- ----------------------------------------------------------------------------
-- Open swap on Alex's upcoming morning walk (application 11).
-- public_at is in the past so the 12-hour waitlist window has ended.
-- ----------------------------------------------------------------------------
INSERT INTO swap_requests
  (application_id, requested_at, status, public_at) VALUES
  (11, CURRENT_TIMESTAMP + INTERVAL '-14 hours', 'open', CURRENT_TIMESTAMP + INTERVAL '-2 hours');

-- ----------------------------------------------------------------------------
-- Feedback on a past shift (Alex, application 1) plus one flagged comment
-- ----------------------------------------------------------------------------
INSERT INTO shift_feedback
  (application_id, rating, comment, flag_concern, created_at) VALUES
  (1, 5, 'Lovely morning with the kennel dogs. The new puzzle feeders went down well.', 0, CURRENT_TIMESTAMP + INTERVAL '-17 days'),
  (3, 3, 'Cattery was short-staffed and two of the shy cats were quite stressed.', 1, CURRENT_TIMESTAMP + INTERVAL '-13 days');

-- ----------------------------------------------------------------------------
-- Pending group booking on the fundraising stall (does not count against capacity)
-- ----------------------------------------------------------------------------
INSERT INTO group_bookings
  (opportunity_id, group_name, contact_name, contact_email, size, status, notes, created_at) VALUES
  (11, 'Belfast Metropolitan College', 'Orla Magee', 'orla.magee@bmc.example.com', 6, 'pending',
   'Student volunteer group looking to help on the stall for the morning.', CURRENT_TIMESTAMP + INTERVAL '-4 days');

-- ----------------------------------------------------------------------------
-- Volunteer hours (approved ones count toward totals, badges, streaks and the chart)
-- ----------------------------------------------------------------------------
INSERT INTO volunteer_hours
  (user_id, opportunity_id, date, hours, approved, created_at) VALUES
  -- Alex (2): ~25.5 approved hours across three months -> Regular Volunteer badge + streak
  (2, 1,    CURRENT_DATE + INTERVAL '-18 days', 3.00, 1, CURRENT_TIMESTAMP + INTERVAL '-18 days'),
  (2, 4,    CURRENT_DATE + INTERVAL '-7 days', 1.50, 1, CURRENT_TIMESTAMP + INTERVAL '-7 days'),
  (2, 5,    CURRENT_DATE + INTERVAL '-3 days', 3.00, 1, CURRENT_TIMESTAMP + INTERVAL '-3 days'),
  (2, NULL, (CURRENT_DATE + INTERVAL '-35 days'),                             8.00, 1, CURRENT_TIMESTAMP + INTERVAL '-35 days'),
  (2, NULL, (CURRENT_DATE + INTERVAL '-65 days'),                             8.00, 1, CURRENT_TIMESTAMP + INTERVAL '-65 days'),
  (2, NULL, (CURRENT_DATE + INTERVAL '-5 days'),                             2.00, 0, CURRENT_TIMESTAMP + INTERVAL '-2 days'),
  -- Niamh (3)
  (3, 2,    CURRENT_DATE + INTERVAL '-14 days', 3.00, 1, CURRENT_TIMESTAMP + INTERVAL '-14 days'),
  (3, 5,    CURRENT_DATE + INTERVAL '-3 days', 3.00, 1, CURRENT_TIMESTAMP + INTERVAL '-3 days'),
  (3, NULL, (CURRENT_DATE + INTERVAL '-35 days'),                             4.00, 1, CURRENT_TIMESTAMP + INTERVAL '-35 days'),
  (3, NULL, CURRENT_DATE + INTERVAL '-1 days', 2.00, 0, CURRENT_TIMESTAMP + INTERVAL '-1 days'),
  -- Ciaran (4)
  (4, 1,    CURRENT_DATE + INTERVAL '-18 days', 3.00, 1, CURRENT_TIMESTAMP + INTERVAL '-18 days'),
  (4, 3,    CURRENT_DATE + INTERVAL '-10 days', 3.00, 1, CURRENT_TIMESTAMP + INTERVAL '-10 days'),
  (4, 4,    CURRENT_DATE + INTERVAL '-7 days', 1.50, 1, CURRENT_TIMESTAMP + INTERVAL '-7 days'),
  (4, NULL, (CURRENT_DATE + INTERVAL '-35 days'),                             3.00, 1, CURRENT_TIMESTAMP + INTERVAL '-35 days'),
  -- Siobhan (5)
  (5, 2,    CURRENT_DATE + INTERVAL '-14 days', 3.00, 1, CURRENT_TIMESTAMP + INTERVAL '-14 days'),
  (5, 11,   CURRENT_DATE + INTERVAL '-2 days', 4.00, 0, CURRENT_TIMESTAMP + INTERVAL '-2 days'),
  -- Eoin (6): community service progress toward 40 hours
  (6, NULL, (CURRENT_DATE + INTERVAL '-35 days'),                            6.00, 1, CURRENT_TIMESTAMP + INTERVAL '-35 days'),
  (6, NULL, (CURRENT_DATE + INTERVAL '-5 days'),                            6.00, 1, CURRENT_TIMESTAMP + INTERVAL '-5 days');

-- ----------------------------------------------------------------------------
-- Tags (ids come from schema.sql seed: 1 dogs, 2 cats, 4 cleaning, 5 events,
-- 6 admin, 7 transport, 9 fundraising)
-- ----------------------------------------------------------------------------
INSERT INTO volunteer_tags (user_id, tag_id) VALUES
  (2, 1), (2, 7),
  (3, 2), (3, 5),
  (4, 1), (4, 4),
  (5, 9), (5, 6),
  (6, 1);

INSERT INTO opportunity_tags (opportunity_id, tag_id) VALUES
  (1, 1), (2, 2), (3, 4), (4, 1), (5, 5), (6, 7),
  (7, 1), (8, 2), (9, 1), (10, 4), (11, 9), (11, 5), (12, 7),
  (13, 1), (14, 1), (15, 1);

-- ----------------------------------------------------------------------------
-- Animals (Assisi-style demo residents)
-- ----------------------------------------------------------------------------
INSERT INTO animals
  (id, name, species, breed, sex, arrival_date, status, kennel_ref, handling_notes, requires_qualification_id) VALUES
  (1, 'Bella', 'dog', 'Labrador cross', 'female', CURRENT_DATE + INTERVAL '-40 days', 'available', 'K3',
   'Harness preferred. Pulls left on the lead — walk with a second person if unsure.', 1),
  (2, 'Rex', 'dog', 'Staffordshire cross', 'male', CURRENT_DATE + INTERVAL '-20 days', 'available', 'K1',
   'Muzzle required on walks. No other dogs. Confident handlers only.', 1),
  (3, 'Miso', 'cat', 'Domestic short hair', 'female', CURRENT_DATE + INTERVAL '-15 days', 'available', 'C2',
   'Shy — sit quietly, do not force contact. Slow blinks welcome.', NULL),
  (4, 'Pip', 'small_animal', 'Rabbit', 'male', CURRENT_DATE + INTERVAL '-8 days', 'available', 'SA1',
   'Gentle handling only. Check water bottle before leaving.', NULL);

INSERT INTO opportunity_animals (opportunity_id, animal_id) VALUES
  (7, 1), (7, 2),
  (8, 3),
  (9, 1),
  (12, 2),
  (13, 1), (14, 1), (15, 1);

-- ----------------------------------------------------------------------------
-- Sample transport run (unclaimed relay legs)
-- ----------------------------------------------------------------------------
INSERT INTO transport_runs (id, animal_id, title, run_date, notes, status, created_by) VALUES
  (1, 2, 'Rex transfer to foster', CURRENT_DATE + INTERVAL '3 days',
   'Relay from Assisi to foster carer near Larne. Soft crate preferred.', 'open', 1);

INSERT INTO transport_legs
  (id, run_id, leg_order, from_location, to_location, depart_at, arrive_by, distance_miles) VALUES
  (1, 1, 1, 'Assisi Animal Sanctuary, Newtownards', 'Templepatrick park & ride',
   (CURRENT_DATE + INTERVAL '3 days') + TIME '09:00',
   (CURRENT_DATE + INTERVAL '3 days') + TIME '10:00', 22.5),
  (2, 1, 2, 'Templepatrick park & ride', 'Ballymena leisure centre car park',
   (CURRENT_DATE + INTERVAL '3 days') + TIME '10:15',
   (CURRENT_DATE + INTERVAL '3 days') + TIME '11:00', 18.0),
  (3, 1, 3, 'Ballymena leisure centre car park', 'Larne foster home (coordinate via shelter)',
   (CURRENT_DATE + INTERVAL '3 days') + TIME '11:15',
   (CURRENT_DATE + INTERVAL '3 days') + TIME '12:00', 16.5);

-- ----------------------------------------------------------------------------
-- Opportunity templates (common Assisi shift patterns)
-- ----------------------------------------------------------------------------
INSERT INTO opportunity_templates (id, name, payload_json, created_by) VALUES
  (1, 'Morning dog walking',
   '{"title":"Morning dog walking","description":"Walk sanctuary dogs on the morning loop. Harnesses and leads provided — follow kennel notes for each dog.","location":"Kennels / walking fields","requirements":"Confident on lead; dog-walking qualification preferred","max_volunteers":4,"cancellation_cutoff_hours":24,"qualification_ids":[],"tag_ids":[],"animal_ids":[],"required_background_check_type":null}',
   1),
  (2, 'Cattery care',
   '{"title":"Cattery care","description":"Clean pens, refresh water, and spend quiet social time with cats. Work calmly with shy residents.","location":"Cattery","requirements":"Gentle handling; no strong perfume","max_volunteers":3,"cancellation_cutoff_hours":24,"qualification_ids":[],"tag_ids":[],"animal_ids":[],"required_background_check_type":null}',
   1),
  (3, 'Kennel deep-clean',
   '{"title":"Kennel deep-clean","description":"Deep-clean empty kennels: scrub floors, disinfect beds, restock blankets. PPE provided.","location":"Kennel block","requirements":"Comfortable with cleaning chemicals; closed-toe shoes","max_volunteers":6,"cancellation_cutoff_hours":12,"qualification_ids":[],"tag_ids":[],"animal_ids":[],"required_background_check_type":null}',
   1);

-- Keep IDENTITY in sync with explicit ids from this seed.
SELECT setval(pg_get_serial_sequence('users', 'user_id'), COALESCE((SELECT MAX(user_id) FROM users), 1), (SELECT COUNT(*) > 0 FROM users));
SELECT setval(pg_get_serial_sequence('opportunities', 'opportunity_id'), COALESCE((SELECT MAX(opportunity_id) FROM opportunities), 1), (SELECT COUNT(*) > 0 FROM opportunities));
SELECT setval(pg_get_serial_sequence('applications', 'application_id'), COALESCE((SELECT MAX(application_id) FROM applications), 1), (SELECT COUNT(*) > 0 FROM applications));
SELECT setval(pg_get_serial_sequence('qualifications', 'id'), COALESCE((SELECT MAX(id) FROM qualifications), 1), (SELECT COUNT(*) > 0 FROM qualifications));
SELECT setval(pg_get_serial_sequence('volunteer_profiles', 'profile_id'), COALESCE((SELECT MAX(profile_id) FROM volunteer_profiles), 1), (SELECT COUNT(*) > 0 FROM volunteer_profiles));
SELECT setval(pg_get_serial_sequence('volunteer_hours', 'record_id'), COALESCE((SELECT MAX(record_id) FROM volunteer_hours), 1), (SELECT COUNT(*) > 0 FROM volunteer_hours));
SELECT setval(pg_get_serial_sequence('swap_requests', 'id'), COALESCE((SELECT MAX(id) FROM swap_requests), 1), (SELECT COUNT(*) > 0 FROM swap_requests));
SELECT setval(pg_get_serial_sequence('shift_feedback', 'id'), COALESCE((SELECT MAX(id) FROM shift_feedback), 1), (SELECT COUNT(*) > 0 FROM shift_feedback));
SELECT setval(pg_get_serial_sequence('group_bookings', 'id'), COALESCE((SELECT MAX(id) FROM group_bookings), 1), (SELECT COUNT(*) > 0 FROM group_bookings));
SELECT setval(pg_get_serial_sequence('volunteer_qualifications', 'id'), COALESCE((SELECT MAX(id) FROM volunteer_qualifications), 1), (SELECT COUNT(*) > 0 FROM volunteer_qualifications));
SELECT setval(pg_get_serial_sequence('tags', 'id'), COALESCE((SELECT MAX(id) FROM tags), 1), (SELECT COUNT(*) > 0 FROM tags));
SELECT setval(pg_get_serial_sequence('animals', 'id'), COALESCE((SELECT MAX(id) FROM animals), 1), (SELECT COUNT(*) > 0 FROM animals));
SELECT setval(pg_get_serial_sequence('transport_runs', 'id'), COALESCE((SELECT MAX(id) FROM transport_runs), 1), (SELECT COUNT(*) > 0 FROM transport_runs));
SELECT setval(pg_get_serial_sequence('transport_legs', 'id'), COALESCE((SELECT MAX(id) FROM transport_legs), 1), (SELECT COUNT(*) > 0 FROM transport_legs));
SELECT setval(pg_get_serial_sequence('opportunity_templates', 'id'), COALESCE((SELECT MAX(id) FROM opportunity_templates), 1), (SELECT COUNT(*) > 0 FROM opportunity_templates));
