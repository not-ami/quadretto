-- Quadretto — schema PostgreSQL (idempotente: si può rieseguire a ogni avvio)

CREATE TABLE IF NOT EXISTS notebooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  code        text        NOT NULL DEFAULT '',          -- sigla breve, es. "AM1"
  color       text        NOT NULL DEFAULT '#3657e8',
  year        smallint,                                  -- anno di corso (1-3), NULL = altro
  exam_date   date,
  position    integer     NOT NULL DEFAULT 0,
  archived    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id          uuid PRIMARY KEY,                          -- generato dal client (creazione offline)
  notebook_id uuid REFERENCES notebooks(id) ON DELETE SET NULL,
  title       text        NOT NULL DEFAULT '',
  blocks      jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- testo, scrittura a mano, foto
  plain       text        NOT NULL DEFAULT '',           -- testo estratto per ricerca e anteprima
  tags        text[]      NOT NULL DEFAULT '{}',
  pinned      boolean     NOT NULL DEFAULT false,
  paper       text        NOT NULL DEFAULT 'grid',
  has_ink     boolean     NOT NULL DEFAULT false,
  rev         integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  search      tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('italian', coalesce(title, '')), 'A') ||
                setweight(to_tsvector('italian', coalesce(plain, '')), 'B')
              ) STORED
);
CREATE INDEX IF NOT EXISTS notes_search_idx   ON notes USING gin (search);
CREATE INDEX IF NOT EXISTS notes_notebook_idx ON notes (notebook_id, updated_at DESC);

-- Cronologia: una copia al massimo ogni 10 minuti per appunto
CREATE TABLE IF NOT EXISTS note_versions (
  id        bigserial PRIMARY KEY,
  note_id   uuid        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  rev       integer     NOT NULL,
  title     text        NOT NULL,
  blocks    jsonb       NOT NULL,
  saved_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_versions_note_idx ON note_versions (note_id, saved_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id          uuid PRIMARY KEY,
  note_id     uuid,                                      -- nessun vincolo: la foto può arrivare prima dell'appunto
  mime        text        NOT NULL,
  bytes       bytea       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- --- Multiutente (2026.11.2) --------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username     text        NOT NULL UNIQUE,
  display_name text        NOT NULL DEFAULT '',
  pass_hash    text,                                     -- NULL = primo accesso: la password la sceglie l'utente
  is_owner     boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,                          -- sha256 del token nel cookie
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  user_agent  text        NOT NULL DEFAULT ''
);
ALTER TABLE notebooks   ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notes       ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS notebooks_user_idx   ON notebooks (user_id, position);
CREATE INDEX IF NOT EXISTS notes_user_idx       ON notes (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS attachments_user_idx ON attachments (user_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx    ON sessions (user_id);

-- --- 2026.11.3: colori con significato, impostazioni dell'utente, tempo di studio --------------
ALTER TABLE notebooks ADD COLUMN IF NOT EXISTS legend   jsonb NOT NULL DEFAULT '{}'::jsonb;  -- colore → significato
ALTER TABLE users     ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;  -- orario delle lezioni, …
CREATE TABLE IF NOT EXISTS study_time (
  user_id     uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notebook_id uuid    NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  day         date    NOT NULL,
  seconds     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, notebook_id, day)
);

-- --- 2026.11.4: quaderni smart e repository ---------------------------------------------------------
-- notebooks.kind: '' = rilevato dal nome, 'code' = quaderno di programmazione, 'plain' = quaderno classico
-- notes.kind: 'note' = appunto, 'repo' = repository di codice del quaderno (un blocco «code» con i file)
ALTER TABLE notebooks ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT '';
ALTER TABLE notes     ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'note';
