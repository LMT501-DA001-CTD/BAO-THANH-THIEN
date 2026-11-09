-- SkyRescue target relational model.
-- 15 domain tables + infrastructure tables (sessions, media_uploads, ml_results, app_meta).
-- SQLite dialect. `payload_json` columns keep the demo's projection fields while the
-- normalized columns remain the query surface for AHP, joins and reporting.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    user_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_code           TEXT NOT NULL UNIQUE,
    username            TEXT NOT NULL UNIQUE,
    password_hash       TEXT,
    full_name           TEXT NOT NULL,
    role                TEXT NOT NULL CHECK (role IN ('reporter', 'dispatch_admin')),
    portal              TEXT NOT NULL CHECK (portal IN ('reporter', 'dispatch')),
    trust_tier          TEXT,
    verified            INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
    phone               TEXT,
    created_at          TEXT NOT NULL,
    record_json         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS uavs (
    uav_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    uav_code            TEXT NOT NULL UNIQUE,
    serial_number       TEXT NOT NULL UNIQUE,
    make_model          TEXT,
    make                TEXT,
    owner_user_id       INTEGER REFERENCES users(user_id),
    status              TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'inactive')),
    registered_at       TEXT,
    payload_json         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS locations (
    location_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    location_code       TEXT NOT NULL UNIQUE,
    area_name           TEXT NOT NULL,
    center_lat          REAL NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
    center_lng          REAL NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
    radius_km           REAL NOT NULL DEFAULT 2.0 CHECK (radius_km > 0),
    province            TEXT,
    region_code         TEXT,
    created_at          TEXT NOT NULL,
    payload_json         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS rescue_teams (
    team_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    team_code           TEXT NOT NULL UNIQUE,
    team_name           TEXT NOT NULL,
    leader_name         TEXT,
    team_lat            REAL NOT NULL CHECK (team_lat BETWEEN -90 AND 90),
    team_lng            REAL NOT NULL CHECK (team_lng BETWEEN -180 AND 180),
    status              TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'busy', 'offline', 'on_mission', 'on mission')),
    specialty           TEXT NOT NULL CHECK (specialty IN ('water_rescue', 'fire', 'urban_sar', 'traffic_rescue')),
    capacity            INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
    equipment           TEXT,
    updated_at          TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    payload_json         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS team_coverage (
    team_id             INTEGER NOT NULL REFERENCES rescue_teams(team_id) ON DELETE CASCADE,
    location_id         INTEGER NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, location_id)
);

CREATE TABLE IF NOT EXISTS reports (
    report_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    report_code         TEXT NOT NULL UNIQUE,
    reporter_id         INTEGER REFERENCES users(user_id),
    location_id         INTEGER REFERENCES locations(location_id),
    uav_id              INTEGER REFERENCES uavs(uav_id),
    img_path            TEXT,
    img_source          TEXT CHECK (img_source IN ('AIDER_demo', 'live_upload', 'seeded_sample')),
    gps_lat             REAL CHECK (gps_lat BETWEEN -90 AND 90),
    gps_lng             REAL CHECK (gps_lng BETWEEN -180 AND 180),
    captured_at         TEXT,
    status              TEXT NOT NULL DEFAULT 'Unverified'
                        CHECK (status IN ('Unverified', 'Matching Team', 'In Progress', 'Resolved')),
    verified_by_user_id INTEGER REFERENCES users(user_id),
    verified_at         TEXT,
    created_at          TEXT NOT NULL,
    original_type       TEXT,
    reviewed_type       TEXT,
    severity_score      REAL,
    ai_severity_score   REAL,
    ai_confidence       REAL,
    detected_people_count INTEGER,
    ai_detected_people_count INTEGER,
    non_upright_count   INTEGER,
    pose_confidence     REAL,
    verification_status TEXT,
    upload_status       TEXT,
    processing_status   TEXT,
    image_url           TEXT,
    metadata_source     TEXT,
    fingerprint         TEXT,
    report_json         TEXT NOT NULL DEFAULT '{}',
    incident_json       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS predictions (
    prediction_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id           INTEGER NOT NULL UNIQUE REFERENCES reports(report_id) ON DELETE CASCADE,
    ai_incident_type    TEXT,
    final_incident_type TEXT,
    incident_confidence REAL,
    ai_severity_score   REAL,
    final_severity_score REAL,
    ai_severity_label   TEXT,
    final_severity_label TEXT,
    needs_review        INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
    ai_people_count     INTEGER NOT NULL DEFAULT 0 CHECK (ai_people_count >= 0),
    final_people_count  INTEGER,
    nearest_team_id     INTEGER REFERENCES rescue_teams(team_id),
    distance_to_nearest_team_km REAL,
    free_teams          INTEGER NOT NULL DEFAULT 0 CHECK (free_teams >= 0),
    priority_score      REAL NOT NULL DEFAULT 0 CHECK (priority_score BETWEEN 0 AND 1),
    priority_computed_at TEXT,
    no_team_flag        INTEGER NOT NULL DEFAULT 0 CHECK (no_team_flag IN (0, 1)),
    model1_version      TEXT,
    model2_version      TEXT,
    predicted_at        TEXT,
    payload_json        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS person_detections (
    detection_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id       INTEGER NOT NULL REFERENCES predictions(prediction_id) ON DELETE CASCADE,
    detection_code      TEXT,
    bbox_x1             INTEGER NOT NULL CHECK (bbox_x1 >= 0),
    bbox_y1             INTEGER NOT NULL CHECK (bbox_y1 >= 0),
    bbox_x2             INTEGER NOT NULL CHECK (bbox_x2 > bbox_x1),
    bbox_y2             INTEGER NOT NULL CHECK (bbox_y2 > bbox_y1),
    pose                TEXT CHECK (pose IN ('Upright', 'Other', 'Non-Upright')),
    confidence_score    REAL CHECK (confidence_score BETWEEN 0 AND 1),
    payload_json        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS dispatches (
    dispatch_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    dispatch_code       TEXT NOT NULL UNIQUE,
    report_id           INTEGER NOT NULL UNIQUE REFERENCES reports(report_id) ON DELETE CASCADE,
    team_id             INTEGER NOT NULL REFERENCES rescue_teams(team_id),
    confirmed_by_user_id INTEGER REFERENCES users(user_id),
    dispatch_status     TEXT NOT NULL DEFAULT 'confirmed'
                        CHECK (dispatch_status IN ('pending_confirmation', 'confirmed', 'completed', 'cancelled')),
    match_score         REAL CHECK (match_score BETWEEN 0 AND 100),
    dispatched_at       TEXT NOT NULL,
    confirmed_at        TEXT,
    completed_at        TEXT,
    override_reason     TEXT,
    override_by_user_id INTEGER REFERENCES users(user_id),
    priority_snapshot_json TEXT NOT NULL DEFAULT '{}',
    rule_evaluation_json TEXT NOT NULL DEFAULT '{}',
    payload_json        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS rules (
    rule_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_code           TEXT NOT NULL UNIQUE,
    rule_name           TEXT NOT NULL UNIQUE,
    description         TEXT,
    rule_type           TEXT NOT NULL CHECK (rule_type IN ('hard', 'soft')),
    rule_origin         TEXT NOT NULL CHECK (rule_origin IN ('system', 'custom')),
    condition_summary   TEXT,
    target_entity_type  TEXT CHECK (target_entity_type IN ('Report', 'Location', 'RescueTeam')),
    custom_tag_key      TEXT,
    expected_value      TEXT,
    weight_delta        INTEGER CHECK (weight_delta BETWEEN -30 AND 30),
    context_weights     TEXT,
    reason_text         TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    payload_json        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tags (
    tag_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_key             TEXT NOT NULL UNIQUE,
    tag_name            TEXT NOT NULL UNIQUE,
    value_type          TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean')),
    color               TEXT,
    created_at          TEXT NOT NULL,
    payload_json        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS entity_tags (
    entity_tag_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id              INTEGER NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    entity_type         TEXT NOT NULL CHECK (entity_type IN ('Report', 'Location', 'RescueTeam')),
    entity_id           INTEGER NOT NULL,
    tag_value           TEXT,
    tagged_at           TEXT NOT NULL,
    UNIQUE (tag_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS system_config (
    config_key          TEXT PRIMARY KEY,
    config_value        TEXT NOT NULL,
    description         TEXT,
    updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    log_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER REFERENCES users(user_id),
    action              TEXT NOT NULL,
    entity_type         TEXT NOT NULL,
    entity_id           TEXT NOT NULL,
    old_value           TEXT,
    new_value           TEXT,
    created_at          TEXT NOT NULL,
    detail              TEXT,
    changes_json        TEXT NOT NULL DEFAULT '[]',
    payload_json        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS upload_attempts (
    attempt_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_code        TEXT NOT NULL UNIQUE,
    user_id             INTEGER REFERENCES users(user_id),
    uav_id              INTEGER REFERENCES uavs(uav_id) ON DELETE SET NULL,
    report_id           INTEGER UNIQUE REFERENCES reports(report_id) ON DELETE CASCADE,
    file_name           TEXT NOT NULL,
    result              TEXT NOT NULL CHECK (result IN ('success', 'failed')),
    error_code          TEXT,
    attempted_at        TEXT NOT NULL,
    upload_token        TEXT UNIQUE,
    media_name          TEXT,
    fingerprint         TEXT,
    metadata_json       TEXT NOT NULL DEFAULT '{}',
    metadata_source     TEXT,
    payload_json        TEXT NOT NULL DEFAULT '{}',
    CHECK ((result = 'failed') = (error_code IS NOT NULL))
);

-- Infrastructure tables: not part of the 15-table domain model.
CREATE TABLE IF NOT EXISTS sessions (
    token               TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    portal              TEXT NOT NULL,
    created             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_uploads (
    token               TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    fingerprint         TEXT NOT NULL,
    media               TEXT NOT NULL,
    metadata            TEXT NOT NULL,
    metadata_source     TEXT NOT NULL,
    report_id           TEXT,
    created             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ml_results (
    token               TEXT PRIMARY KEY,
    status              TEXT NOT NULL,
    ai_result           TEXT,
    updated             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
    key                 TEXT PRIMARY KEY,
    value               TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_predictions_report ON predictions(report_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_report ON dispatches(report_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(log_id);
