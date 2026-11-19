CREATE TABLE users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
 deletion_requested_at INTEGER
) STRICT;
CREATE TABLE user_settings (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL DEFAULT '', timezone TEXT NOT NULL DEFAULT 'UTC',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE login_challenges (
 id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hmac TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 used_at INTEGER, state TEXT NOT NULL CHECK(state IN ('pending','sent','failed','superseded'))
) STRICT;
CREATE INDEX challenge_email ON login_challenges(email,created_at);
CREATE TABLE auth_rate_events (
 id INTEGER PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX rate_subject_time ON auth_rate_events(subject,kind,created_at);
CREATE TABLE auth_sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 last_seen_at INTEGER NOT NULL, revoked_at INTEGER
) STRICT;
CREATE INDEX session_user ON auth_sessions(user_id);
-- Private, owner-scoped foundations for the next synchronization stage.
-- No public training write API is exposed in this release.
CREATE TABLE exercises (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120), instruction TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 PRIMARY KEY(user_id,id)
) STRICT;
CREATE TABLE programs (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, slot TEXT NOT NULL CHECK(slot IN ('A','B','C')),
 name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 PRIMARY KEY(user_id,id)
) STRICT;
CREATE UNIQUE INDEX active_program_slot ON programs(user_id,slot) WHERE deleted_at IS NULL;
CREATE TABLE program_items (
 user_id TEXT NOT NULL, id TEXT NOT NULL, program_id TEXT NOT NULL, exercise_id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,program_id) REFERENCES programs(user_id,id), FOREIGN KEY(user_id,exercise_id) REFERENCES exercises(user_id,id)
) STRICT;
CREATE TABLE program_sets (
 user_id TEXT NOT NULL, id TEXT NOT NULL, item_id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0),
 weight_g INTEGER NOT NULL CHECK(weight_g BETWEEN 500 AND 200000 AND weight_g%500=0), reps INTEGER NOT NULL CHECK(reps BETWEEN 1 AND 1000), bells INTEGER NOT NULL CHECK(bells IN (1,2)),
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,item_id) REFERENCES program_items(user_id,id)
) STRICT;
CREATE TABLE workouts (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, local_date TEXT NOT NULL, timezone TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','in_progress','completed')), source_program_id TEXT, plan_snapshot TEXT CHECK(plan_snapshot IS NULL OR json_valid(plan_snapshot)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,source_program_id) REFERENCES programs(user_id,id)
) STRICT;
CREATE INDEX workout_history ON workouts(user_id,local_date,created_at,id);
CREATE TABLE workout_sets (
 user_id TEXT NOT NULL, id TEXT NOT NULL, workout_id TEXT NOT NULL, exercise_id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0), name_snapshot TEXT NOT NULL,
 plan TEXT CHECK(plan IS NULL OR json_valid(plan)), weight_g INTEGER NOT NULL CHECK(weight_g BETWEEN 500 AND 200000 AND weight_g%500=0),
 reps INTEGER NOT NULL CHECK(reps BETWEEN 1 AND 1000), bells INTEGER NOT NULL CHECK(bells IN (1,2)), done INTEGER NOT NULL CHECK(done IN (0,1)), effort INTEGER CHECK(effort BETWEEN 1 AND 10),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,workout_id) REFERENCES workouts(user_id,id), FOREIGN KEY(user_id,exercise_id) REFERENCES exercises(user_id,id)
) STRICT;
CREATE TABLE measurements (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, local_date TEXT NOT NULL,
 weight_g INTEGER CHECK(weight_g BETWEEN 1000 AND 500000 AND weight_g%100=0), waist_mm INTEGER CHECK(waist_mm BETWEEN 10 AND 5000 AND waist_mm%1=0),
 chest_mm INTEGER CHECK(chest_mm BETWEEN 10 AND 5000), hips_mm INTEGER CHECK(hips_mm BETWEEN 10 AND 5000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 PRIMARY KEY(user_id,id)
) STRICT;
CREATE UNIQUE INDEX measurement_date ON measurements(user_id,local_date) WHERE deleted_at IS NULL;
