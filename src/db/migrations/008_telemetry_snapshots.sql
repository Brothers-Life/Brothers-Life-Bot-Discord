-- bl_telemetry 1.6: the periodic readings of the game (every 5 minutes by default).
-- "latest" tables hold the last reading (live display), the others its history (curves).

-- Companies: one row per job, replaced at each reading
CREATE TABLE IF NOT EXISTS tel_business_latest (
	job TEXT PRIMARY KEY,
	ts TIMESTAMPTZ NOT NULL,
	label TEXT,
	type TEXT,
	-- NULL: the company has no open/closed state
	open BOOLEAN,
	online INT NOT NULL DEFAULT 0,
	on_duty INT NOT NULL DEFAULT 0,
	employees INT NOT NULL DEFAULT 0,
	balance BIGINT,
	level INT,
	xp BIGINT,
	week_duty_s BIGINT
);

CREATE TABLE IF NOT EXISTS tel_business_history (
	ts TIMESTAMPTZ NOT NULL,
	job TEXT NOT NULL,
	open BOOLEAN,
	online INT,
	on_duty INT,
	employees INT,
	balance BIGINT
);
CREATE INDEX IF NOT EXISTS idx_tel_business_history_job_ts ON tel_business_history (job, ts DESC);
CREATE INDEX IF NOT EXISTS idx_tel_business_history_ts ON tel_business_history (ts);

-- Totals of each reading (companies open, people on duty, safes)
CREATE TABLE IF NOT EXISTS tel_business_totals (
	ts TIMESTAMPTZ NOT NULL,
	jobs INT,
	open INT,
	on_duty INT,
	online INT,
	safes BIGINT,
	duty_by_type JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_tel_business_totals_ts ON tel_business_totals (ts);

CREATE TABLE IF NOT EXISTS tel_gang_latest (
	gang TEXT PRIMARY KEY,
	ts TIMESTAMPTZ NOT NULL,
	label TEXT,
	online INT NOT NULL DEFAULT 0,
	members INT NOT NULL DEFAULT 0,
	xp BIGINT,
	category TEXT,
	max_members INT,
	territories INT
);

-- Money in and out by reason, one row per reason and reading
CREATE TABLE IF NOT EXISTS tel_money_flows (
	ts TIMESTAMPTZ NOT NULL,
	window_s INT,
	money_type TEXT NOT NULL,
	action TEXT NOT NULL,
	reason TEXT NOT NULL,
	total BIGINT NOT NULL DEFAULT 0,
	n INT NOT NULL DEFAULT 0,
	max BIGINT
);
CREATE INDEX IF NOT EXISTS idx_tel_money_flows_ts ON tel_money_flows (ts);

-- Server health: the figures drawn as curves in columns, the lists (slow queries, errors, drops…) in data
CREATE TABLE IF NOT EXISTS tel_health (
	ts TIMESTAMPTZ NOT NULL,
	window_s INT,
	players INT,
	max_players INT,
	staff_on_duty INT,
	ping_avg INT,
	ping_max INT,
	hitches INT,
	hitch_max_ms INT,
	queue INT,
	data JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_tel_health_ts ON tel_health (ts);

-- Events of a company (duty, business_open, job_change): found by data.job
CREATE INDEX IF NOT EXISTS idx_tel_events_job ON tel_events ((data->>'job'), ts DESC) WHERE subtype IN ('duty', 'business_open', 'job_change');
