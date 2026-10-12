-- SumoShares schema (Cloudflare D1 / SQLite)
-- Ledger rule: balances are computed from securities + transactions. Corrections are new transactions.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS stakeholders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  relationship TEXT,              -- Employee, Ex-Employee, Consultant, Ex-Consultant, Investor, Advisor, Founder
  termination_date TEXT,          -- YYYY-MM-DD
  address TEXT,
  external_id TEXT,               -- id from Carta / OCF import
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stakeholders_email ON stakeholders(lower(email));

CREATE TABLE IF NOT EXISTS stock_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,      -- Common, Series A Preferred
  prefix TEXT,                    -- CS, PA
  authorized INTEGER,
  is_preferred INTEGER DEFAULT 0,
  conversion_ratio REAL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  reserved INTEGER NOT NULL,      -- total shares reserved for the plan
  class_id INTEGER REFERENCES stock_classes(id),
  board_approval_date TEXT,
  expiration_date TEXT
);

-- One row per certificate (kind=share) or grant (kind=option)
CREATE TABLE IF NOT EXISTS securities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,     -- CS-51, PA-1, ES-123
  kind TEXT NOT NULL CHECK (kind IN ('share','option')),
  stakeholder_id INTEGER NOT NULL REFERENCES stakeholders(id),
  class_id INTEGER REFERENCES stock_classes(id),   -- shares
  plan_id INTEGER REFERENCES plans(id),            -- options
  quantity INTEGER NOT NULL,      -- shares issued / options granted
  price REAL,                     -- price paid per share (shares)
  issue_date TEXT NOT NULL,       -- issue / grant date
  option_type TEXT,               -- ISO, NSO
  exercise_price REAL,
  expiration_date TEXT,           -- 10-year term
  exercise_deadline TEXT,         -- post-termination deadline if set (overrides expiration when earlier)
  vest_months INTEGER,            -- total months, e.g. 48
  cliff_months INTEGER DEFAULT 0,
  vest_start TEXT,
  vest_override_vested INTEGER,   -- imported vested count when schedule is custom
  status TEXT DEFAULT 'outstanding', -- shares: outstanding|canceled|repurchased|transferred ; options derive from transactions
  source_security_id INTEGER REFERENCES securities(id), -- share issued from an exercise / transfer
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_securities_holder ON securities(stakeholder_id);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  security_id INTEGER NOT NULL REFERENCES securities(id),
  type TEXT NOT NULL,             -- issue, exercise, forfeit, expire, cancel, repurchase, transfer
  quantity INTEGER NOT NULL,
  price REAL,
  fmv REAL,                       -- FMV per share on the effective date (exercises)
  effective_date TEXT NOT NULL,
  resulting_security_id INTEGER REFERENCES securities(id),
  note TEXT,
  actor TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_security ON transactions(security_id);

CREATE TABLE IF NOT EXISTS exercise_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE, -- EX-2026-0001, used on wires
  security_id INTEGER NOT NULL REFERENCES securities(id),
  stakeholder_id INTEGER NOT NULL REFERENCES stakeholders(id),
  quantity INTEGER NOT NULL,
  exercise_price REAL NOT NULL,
  fmv REAL,
  cost REAL NOT NULL,
  method TEXT DEFAULT 'wire',     -- wire | online | check
  status TEXT DEFAULT 'requested',-- requested | paid | approved | canceled
  signed_name TEXT,
  signed_at TEXT,
  stripe_session_id TEXT,
  paid_at TEXT,
  approved_at TEXT,
  approved_by TEXT,
  certificate_security_id INTEGER REFERENCES securities(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_date TEXT NOT NULL,
  fmv REAL NOT NULL,
  provider TEXT,
  expires_on TEXT,                -- usually effective_date + 12 months
  document_id INTEGER REFERENCES documents(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL,       -- company | stakeholder | security | valuation | exercise
  owner_id INTEGER,
  kind TEXT,                      -- grant agreement, certificate, 409A, board consent, exercise agreement, other
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reminders_sent (
  key TEXT PRIMARY KEY,
  sent_at TEXT DEFAULT (datetime('now'))
);

-- Append-only audit log: block edits and deletes
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS tx_no_delete BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT, 'transactions are append-only'); END;
