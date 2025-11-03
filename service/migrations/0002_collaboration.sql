CREATE TABLE IF NOT EXISTS slide_collaborators (
  slide_id UUID NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  invited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (slide_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_slide_collaborators_user ON slide_collaborators(user_id);

CREATE TABLE IF NOT EXISTS slide_presence_snapshots (
  slide_id UUID NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  cursor_x DOUBLE PRECISION NULL,
  cursor_y DOUBLE PRECISION NULL,
  color TEXT NULL,
  display_name TEXT NULL,
  note TEXT NULL,
  PRIMARY KEY (slide_id, user_id)
);
