-- 018: Composite indexes matched to the app's hottest query shapes.
-- Grounded in the actual SQL in models/ and jobs/:
--
--   1. Every opportunity list/detail runs a correlated capacity subquery:
--        applications WHERE opportunity_id = ? AND status IN ('accepted','approved')
--        group_bookings WHERE opportunity_id = ? AND status = 'confirmed'
--      Composite (opportunity_id, status) serves both from the index alone.
--
--   2. Hours totals (badges, stats, dashboards):
--        volunteer_hours WHERE user_id = ? AND approved = 1
--      and the admin pending list:
--        volunteer_hours WHERE approved = 0 ORDER BY date
--
--   3. Browse/public/urgent shift queries:
--        opportunities WHERE status = 'open' AND start_date >= ?
--
--   4. The reminder job candidate filter:
--        applications WHERE status IN (...) AND reminder_sent_at IS NULL
--
-- Redundant single-column indexes are dropped only where the new composite
-- starts with the same column (so FK constraints stay backed by an index).
-- Add composites FIRST, then drop, so FKs are never left uncovered.

-- applications ---------------------------------------------------------------
ALTER TABLE `applications`
  ADD KEY `idx_applications_opportunity_status` (`opportunity_id`, `status`),
  ADD KEY `idx_applications_status_reminder` (`status`, `reminder_sent_at`);

ALTER TABLE `applications`
  DROP KEY `fk_applications_opportunity`;

-- group_bookings -------------------------------------------------------------
ALTER TABLE `group_bookings`
  ADD KEY `idx_group_bookings_opportunity_status` (`opportunity_id`, `status`);

ALTER TABLE `group_bookings`
  DROP KEY `fk_group_bookings_opportunity`;

-- volunteer_hours ------------------------------------------------------------
ALTER TABLE `volunteer_hours`
  ADD KEY `idx_hours_user_approved` (`user_id`, `approved`),
  ADD KEY `idx_hours_approved_date` (`approved`, `date`);

ALTER TABLE `volunteer_hours`
  DROP KEY `idx_hours_user`,
  DROP KEY `idx_hours_approved`;

-- opportunities --------------------------------------------------------------
-- Keep idx_opportunities_start_date: pure date-range queries (day sheet)
-- don't filter by status.
ALTER TABLE `opportunities`
  ADD KEY `idx_opportunities_status_start` (`status`, `start_date`);

ALTER TABLE `opportunities`
  DROP KEY `idx_opportunities_status`;
