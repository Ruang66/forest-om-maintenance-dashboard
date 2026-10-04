-- Multi-year support.
-- Migrations run on every boot, so every statement here must be idempotent.
-- Existing schedules and done ticks all belong to 2026 (the only year the app supported).

-- One-off safety snapshots of the pre-migration data. IF NOT EXISTS means they are
-- created on the first boot after this migration ships and never overwritten.
CREATE TABLE IF NOT EXISTS backup_003_sites AS SELECT * FROM sites;
CREATE TABLE IF NOT EXISTS backup_003_done_records AS SELECT * FROM done_records;

-- done_records: add year to the key
ALTER TABLE done_records ADD COLUMN IF NOT EXISTS year int;
UPDATE done_records SET year = 2026 WHERE year IS NULL;
ALTER TABLE done_records ALTER COLUMN year SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
    WHERE c.relname = 'done_records' AND i.indisprimary AND a.attname = 'year'
  ) THEN
    ALTER TABLE done_records DROP CONSTRAINT IF EXISTS done_records_pkey;
    ALTER TABLE done_records ADD PRIMARY KEY (site_id, year, month_idx, component);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'done_records_year_check') THEN
    ALTER TABLE done_records ADD CONSTRAINT done_records_year_check CHECK (year BETWEEN 2020 AND 2100);
  END IF;
END $$;

-- sites.data: move the single-year "months" object into "schedules" keyed by year
UPDATE sites
SET data = (data - 'months') || jsonb_build_object('schedules', jsonb_build_object('2026', data->'months'))
WHERE data ? 'months' AND NOT data ? 'schedules';
