-- knowledge assets
CREATE TABLE IF NOT EXISTS knowledge_assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  expires_at TEXT,
  ontology_class TEXT NOT NULL,
  source_terminal TEXT NOT NULL,
  source_session_id TEXT,
  source_raw_path TEXT NOT NULL,
  body TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  related_json TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ka_type ON knowledge_assets(type);
CREATE INDEX IF NOT EXISTS idx_ka_project ON knowledge_assets(project);
CREATE INDEX IF NOT EXISTS idx_ka_status ON knowledge_assets(status);
CREATE INDEX IF NOT EXISTS idx_ka_timestamp ON knowledge_assets(timestamp DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  tags,
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_id) REFERENCES knowledge_assets(id) ON DELETE CASCADE,
  FOREIGN KEY (to_id) REFERENCES knowledge_assets(id) ON DELETE CASCADE,
  UNIQUE(from_id, to_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_rel_from ON relations(from_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relations(to_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relations(relation_type);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entity_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entity_type ON entities(type);

CREATE TABLE IF NOT EXISTS knowledge_entities (
  knowledge_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (knowledge_id, entity_id),
  FOREIGN KEY (knowledge_id) REFERENCES knowledge_assets(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

-- Vector storage (simple BLOB; adaptive brute/HNSW at query layer)
CREATE TABLE IF NOT EXISTS knowledge_vectors (
  id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  dimension INTEGER NOT NULL DEFAULT 384
);

CREATE TABLE IF NOT EXISTS raw_hashes (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  compiled_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  asset_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_ka_raw_path ON knowledge_assets(source_raw_path);

CREATE TABLE IF NOT EXISTS compile_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_phase TEXT NOT NULL,
  last_raw_path TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ontology_proposals (
  id TEXT PRIMARY KEY,
  proposal_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS phase_latency (
  phase TEXT PRIMARY KEY,
  samples_json TEXT NOT NULL DEFAULT '[]'
);
