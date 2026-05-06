-- Forest Energy O&M Dashboard - initial schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text,
  role text NOT NULL CHECK (role IN ('admin','editor','viewer')),
  invite_token text,
  invite_expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  sla_filename text,
  sla_size int,
  sla_uploaded_at timestamptz,
  sla_mime text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS done_records (
  site_id text REFERENCES sites(id) ON DELETE CASCADE,
  month_idx int NOT NULL CHECK (month_idx BETWEEN 0 AND 11),
  component text NOT NULL CHECK (component IN ('cln','insp')),
  done_at timestamptz NOT NULL DEFAULT now(),
  done_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (site_id, month_idx, component)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id);
