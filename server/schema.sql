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

-- --- Live tra dispositivi (CRDT Yjs, punto 7 del piano del 2026-11-24) ---------------------------------------
-- Lo stato Yjs dell'appunto: note_ydoc tiene lo stato compattato, note_yupdates gli aggiornamenti arrivati dopo.
-- Da questo stato il server ricava blocks/plain/has_ink/title di notes: ricerca, cronologia, cestino ed esportazioni
-- restano come prima. Un appunto senza riga in note_ydoc è «vecchio»: si converte la prima volta che qualcuno lo apre.
CREATE TABLE IF NOT EXISTS note_ydoc (
  note_id    uuid PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  state      bytea       NOT NULL,
  seq        bigint      NOT NULL DEFAULT 0,            -- ultimo aggiornamento già compreso nello stato
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- gen: «generazione» del documento; se cambia (database ripristinato) i dispositivi buttano il loro stato invece di fonderlo
ALTER TABLE note_ydoc ADD COLUMN IF NOT EXISTS gen uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE IF NOT EXISTS note_yupdates (
  seq      bigserial PRIMARY KEY,
  note_id  uuid        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  update   bytea       NOT NULL,
  user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_yupdates_note_idx ON note_yupdates (note_id, seq);
-- la cronologia ora dice anche chi ha scritto
ALTER TABLE note_versions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- --- Condivisione sullo stesso server (punto 9) ------------------------------------------------------------
-- kind: 'notebook' (vale anche per gli appunti aggiunti dopo), 'note', 'repo' (un repository è un appunto di tipo repo)
CREATE TABLE IF NOT EXISTS shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('notebook', 'note', 'repo')),
  target_id  uuid        NOT NULL,
  grantee_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('read', 'edit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, target_id, grantee_id)
);
CREATE INDEX IF NOT EXISTS shares_grantee_idx ON shares (grantee_id);
CREATE INDEX IF NOT EXISTS shares_target_idx  ON shares (target_id);
-- Link in sola lettura: nel database c'è solo lo sha256 del token; scadenza obbligatoria
CREATE TABLE IF NOT EXISTS links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text        NOT NULL UNIQUE,
  kind        text        NOT NULL CHECK (kind IN ('notebook', 'note')),
  target_id   uuid        NOT NULL,
  created_by  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX IF NOT EXISTS links_target_idx ON links (target_id);

-- Il controllo unico dei permessi: ruolo dell'utente su un appunto o su un quaderno
-- ('owner' | 'edit' | 'read' | NULL). Lo usa can() in server.js per tutte le API e per il WebSocket.
-- Una condivisione vale solo se chi l'ha fatta è ancora il proprietario (owner_id = user_id della risorsa).
CREATE OR REPLACE FUNCTION note_role(uid uuid, nid uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN n.user_id = uid THEN 'owner' ELSE (
    SELECT CASE WHEN bool_or(s.role = 'edit') THEN 'edit' WHEN count(*) > 0 THEN 'read' END FROM shares s
     WHERE s.grantee_id = uid AND s.owner_id = n.user_id
       AND ((s.kind IN ('note', 'repo') AND s.target_id = n.id) OR (s.kind = 'notebook' AND s.target_id = n.notebook_id))) END
  FROM notes n WHERE n.id = nid
$$;
CREATE OR REPLACE FUNCTION notebook_role(uid uuid, nbid uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN b.user_id = uid THEN 'owner' ELSE (
    SELECT CASE WHEN bool_or(s.role = 'edit') THEN 'edit' WHEN count(*) > 0 THEN 'read' END FROM shares s
     WHERE s.grantee_id = uid AND s.owner_id = b.user_id AND s.kind = 'notebook' AND s.target_id = b.id) END
  FROM notebooks b WHERE b.id = nbid
$$;
-- Gli appunti che un utente può leggere, con il ruolo (per elenchi e ricerca)
CREATE OR REPLACE FUNCTION readable_notes(uid uuid) RETURNS TABLE (id uuid, role text) LANGUAGE sql STABLE AS $$
  SELECT x.id, CASE WHEN bool_or(x.r = 'owner') THEN 'owner' WHEN bool_or(x.r = 'edit') THEN 'edit' ELSE 'read' END
  FROM (
    SELECT n.id, 'owner' AS r FROM notes n WHERE n.user_id = uid
    UNION ALL
    SELECT n.id, s.role FROM shares s JOIN notes n ON n.user_id = s.owner_id
      AND ((s.kind IN ('note', 'repo') AND s.target_id = n.id) OR (s.kind = 'notebook' AND s.target_id = n.notebook_id))
     WHERE s.grantee_id = uid
  ) x GROUP BY x.id
$$;

-- --- Federazione tra server Quadretto (punto 10, PROTOTIPO: attiva solo con FEDERATION_NAME nel .env) ---------
CREATE TABLE IF NOT EXISTS fed_keys (
  id   smallint PRIMARY KEY CHECK (id = 1),
  pub  text NOT NULL,                                    -- chiave pubblica Ed25519 (SPKI, base64), a /.well-known/quadretto
  priv text NOT NULL                                     -- chiave privata (PEM): non esce mai dal server
);
-- inviti mandati da qui a un account di un altro server (il token delegato è salvato come sha256)
CREATE TABLE IF NOT EXISTS fed_shares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text        NOT NULL,
  target_id     uuid        NOT NULL,
  remote_user   text        NOT NULL,
  remote_server text        NOT NULL,
  role          text        NOT NULL DEFAULT 'read',
  token_hash    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
-- inviti ricevuti da altri server per gli account di qui
CREATE TABLE IF NOT EXISTS fed_inbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_addr  text        NOT NULL,
  server     text        NOT NULL,
  kind       text        NOT NULL,
  target_id  uuid        NOT NULL,
  title      text        NOT NULL DEFAULT '',
  role       text        NOT NULL DEFAULT 'read',
  token      text        NOT NULL,                       -- il permesso delegato, da presentare al server del proprietario
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id, server, target_id)
);
