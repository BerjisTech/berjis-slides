CREATE TABLE IF NOT EXISTS presentations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presentation_shares (
  presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('viewer','commenter','editor')),
  invited_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (presentation_id, user_id)
);

CREATE TABLE IF NOT EXISTS presentation_slides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  layout TEXT NOT NULL DEFAULT 'blank',
  background TEXT NOT NULL DEFAULT '#ffffff',
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presentation_slides_presentation ON presentation_slides(presentation_id, position);

CREATE TABLE IF NOT EXISTS slide_elements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slide_id UUID NOT NULL REFERENCES presentation_slides(id) ON DELETE CASCADE,
  element_type TEXT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  width DOUBLE PRECISION NOT NULL,
  height DOUBLE PRECISION NOT NULL,
  rotation DOUBLE PRECISION NOT NULL DEFAULT 0,
  z_index INT NOT NULL DEFAULT 0,
  locked BOOLEAN NOT NULL DEFAULT false,
  hidden BOOLEAN NOT NULL DEFAULT false,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slide_elements_slide ON slide_elements(slide_id, z_index);
