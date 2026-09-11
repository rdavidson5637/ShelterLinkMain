-- 020: Urgent cover flag on opportunities

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS is_urgent SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS urgent_flagged_at TIMESTAMP DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_urgent
  ON opportunities (is_urgent, start_date)
  WHERE is_urgent = 1;
