BEGIN;
CREATE SCHEMA IF NOT EXISTS demo;
CREATE TABLE IF NOT EXISTS demo.runs (
 id uuid PRIMARY KEY, idempotency_key text UNIQUE NOT NULL, requested_by text NOT NULL,
 scenario text NOT NULL CHECK(scenario IN ('valid','mixed','rejected','sequence')),
 file_count int NOT NULL CHECK(file_count BETWEEN 1 AND 100), detail_count int NOT NULL CHECK(detail_count BETWEEN 1 AND 1000),
 interval_seconds int NOT NULL CHECK(interval_seconds BETWEEN 1 AND 3600),
 generation_status text NOT NULL DEFAULT 'QUEUED', stop_requested boolean NOT NULL DEFAULT false,
 generated_count int NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), error text
);
CREATE UNIQUE INDEX IF NOT EXISTS one_generator ON demo.runs ((true)) WHERE generation_status IN ('QUEUED','RUNNING');
CREATE SEQUENCE IF NOT EXISTS demo.file_sequence;
CREATE TABLE IF NOT EXISTS demo.files (
 file_id text PRIMARY KEY, run_id uuid NOT NULL REFERENCES demo.runs ON DELETE CASCADE,
 ordinal int NOT NULL, source_file text UNIQUE NOT NULL, content text NOT NULL,
 expected jsonb NOT NULL, scenario text NOT NULL, generated_at timestamptz,
 processing_status text NOT NULL DEFAULT 'PROCESSING', delivery_status text NOT NULL DEFAULT 'DELIVERY_PENDING',
 pg_match boolean NOT NULL DEFAULT false, sftp_match boolean NOT NULL DEFAULT false,
 duplicates int NOT NULL DEFAULT 0, evidence jsonb NOT NULL DEFAULT '{}', checked_at timestamptz,
 UNIQUE(run_id,ordinal)
);
CREATE TABLE IF NOT EXISTS demo.events (
 id bigserial PRIMARY KEY, run_id uuid REFERENCES demo.runs ON DELETE CASCADE, file_id text,
 stage text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS demo.artifacts (
 path text PRIMARY KEY, size bigint NOT NULL, sha256 text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 previews jsonb NOT NULL, run_ids text[] NOT NULL DEFAULT '{}'
);
ALTER TABLE demo.artifacts ADD COLUMN IF NOT EXISTS modified_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS demo.approvals (
 nonce uuid PRIMARY KEY, session_id text NOT NULL, action jsonb NOT NULL, expires_at timestamptz NOT NULL,
 used_at timestamptz, result jsonb
);
CREATE TABLE IF NOT EXISTS demo.worker_status (name text PRIMARY KEY, heartbeat timestamptz NOT NULL DEFAULT now(), detail jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS public.bayno_processed_v2 (
 record_id text PRIMARY KEY, run_id text NOT NULL, file_id text NOT NULL, source_file text NOT NULL,
 line_number bigint, carr text, flt_nbr text, first_leg_flt_dt text, sched_dep_tm text, dep_airpt text,
 bay_no text, rec_src_sys text, file_sequence text, rec_ld_ts text
);
CREATE TABLE IF NOT EXISTS public.bayno_file_results_v2 (
 record_id text PRIMARY KEY, run_id text NOT NULL, file_id text NOT NULL, source_file text NOT NULL,
 status text, reason text, declared_count bigint, actual_count bigint, invalid_count bigint, error_percent text
);
CREATE TABLE IF NOT EXISTS public.bayno_exceptions_v2 (
 record_id text PRIMARY KEY, run_id text NOT NULL, file_id text NOT NULL, source_file text NOT NULL,
 line_number bigint, error_code text, explanation text
);
CREATE INDEX IF NOT EXISTS processed_run ON public.bayno_processed_v2(run_id);
CREATE INDEX IF NOT EXISTS results_run ON public.bayno_file_results_v2(run_id);
CREATE INDEX IF NOT EXISTS exceptions_run ON public.bayno_exceptions_v2(run_id);
-- Non-login group roles: deployment binds separate credentials to these roles.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='bayno_web') THEN CREATE ROLE bayno_web NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='bayno_sink') THEN CREATE ROLE bayno_sink NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='bayno_worker') THEN CREATE ROLE bayno_worker NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA demo, public TO bayno_web, bayno_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA demo TO bayno_web;
GRANT INSERT, UPDATE ON demo.runs, demo.approvals TO bayno_web;
GRANT INSERT ON demo.events TO bayno_web;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA demo TO bayno_web, bayno_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA demo TO bayno_worker;
GRANT SELECT ON public.bayno_processed_v2,public.bayno_file_results_v2,public.bayno_exceptions_v2 TO bayno_web,bayno_worker;
GRANT USAGE ON SCHEMA public TO bayno_sink;
GRANT SELECT,INSERT,UPDATE ON public.bayno_processed_v2,public.bayno_file_results_v2,public.bayno_exceptions_v2 TO bayno_sink;
COMMIT;
