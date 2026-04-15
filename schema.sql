-- ============================================================
--  FIFA WORLD CUP 2026 — Prediction Pool
--  Paste this ENTIRE file into Supabase SQL Editor → click RUN
-- ============================================================

-- 1. SETTINGS
CREATE TABLE tournament_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT
);
INSERT INTO tournament_settings VALUES
  ('group_phase_open',    'true',        'Allow group stage predictions'),
  ('knockout_phase_open', 'false',       'Allow knockout stage predictions'),
  ('awards_phase_open',   'true',        'Allow awards predictions'),
  ('admin_password',      'changeme123', 'Admin panel password — CHANGE THIS in Table Editor!');

CREATE TABLE scoring_settings (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  description_en TEXT,
  description_pt TEXT
);
INSERT INTO scoring_settings VALUES
  ('group_correct_result',    3, 'Correct W/D/L (group stage)',       'Resultado correto V/E/D (grupos)'),
  ('group_correct_goal_diff', 1, 'Correct goal difference (group)',   'Diferença de golos correta (grupos)'),
  ('group_exact_score',       1, 'Exact score bonus (group)',         'Resultado exato — bónus (grupos)'),
  ('ko_correct_result',       4, 'Correct W/D/L (knockout)',          'Resultado correto (eliminatórias)'),
  ('ko_correct_goal_diff',    1, 'Correct goal diff (knockout)',      'Diferença de golos (eliminatórias)'),
  ('ko_exact_score',          2, 'Exact score bonus (knockout)',      'Resultado exato bónus (eliminatórias)'),
  ('ko_correct_team',         0, 'Correct team in KO (disabled/0)',   'Equipa correta KO (desativado/0)'),
  ('award_winner',            5, 'Tournament winner correct',         'Campeão correto'),
  ('award_top_scorer',        5, 'Top scorer correct',                'Melhor marcador correto'),
  ('award_best_player',       5, 'Best player correct',               'Melhor jogador correto'),
  ('award_best_goalkeeper',   5, 'Best goalkeeper correct',           'Melhor guarda-redes correto'),
  ('award_best_young',        3, 'Best young player correct',         'Melhor jovem correto');

CREATE TABLE award_results (
  award_type TEXT PRIMARY KEY,
  result TEXT
);
INSERT INTO award_results (award_type, result) VALUES
  ('winner',NULL),('top_scorer',NULL),('best_player',NULL),
  ('best_goalkeeper',NULL),('best_young',NULL);

-- 2. TEAMS (48 teams — update TBD entries after March 31 via Admin → Teams)
CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_pt TEXT NOT NULL,
  group_name TEXT NOT NULL,
  flag TEXT DEFAULT '🏳️'
);
INSERT INTO teams (name_en, name_pt, group_name, flag) VALUES
-- Group A
  ('Mexico',          'México',          'A', '🇲🇽'),
  ('South Africa',    'África do Sul',   'A', '🇿🇦'),
  ('Senegal',         'Senegal',         'A', '🇸🇳'),
  ('TBD PO-2',        'TBD PO-2',        'A', '🏳️'),
-- Group B
  ('USA',             'EUA',             'B', '🇺🇸'),
  ('Panama',          'Panamá',          'B', '🇵🇦'),
  ('Uruguay',         'Uruguai',         'B', '🇺🇾'),
  ('TBD UEFA-PO-B',   'TBD UEFA-PO-B',   'B', '🏳️'),
-- Group C
  ('Canada',          'Canadá',          'C', '🇨🇦'),
  ('Honduras',        'Honduras',        'C', '🇭🇳'),
  ('Morocco',         'Marrocos',        'C', '🇲🇦'),
  ('TBD UEFA-PO-A',   'TBD UEFA-PO-A',   'C', '🏳️'),
-- Group D
  ('France',          'França',          'D', '🇫🇷'),
  ('Argentina',       'Argentina',       'D', '🇦🇷'),
  ('Saudi Arabia',    'Arábia Saudita',  'D', '🇸🇦'),
  ('New Zealand',     'Nova Zelândia',   'D', '🇳🇿'),
-- Group E
  ('Spain',           'Espanha',         'E', '🇪🇸'),
  ('Japan',           'Japão',           'E', '🇯🇵'),
  ('Ecuador',         'Equador',         'E', '🇪🇨'),
  ('TBD UEFA-PO-C',   'TBD UEFA-PO-C',   'E', '🏳️'),
-- Group F
  ('Germany',         'Alemanha',        'F', '🇩🇪'),
  ('Portugal',        'Portugal',        'F', '🇵🇹'),
  ('Colombia',        'Colômbia',        'F', '🇨🇴'),
  ('TBD PO-1',        'TBD PO-1',        'F', '🏳️'),
-- Group G
  ('Brazil',          'Brasil',          'G', '🇧🇷'),
  ('Netherlands',     'Países Baixos',   'G', '🇳🇱'),
  ('South Korea',     'Coreia do Sul',   'G', '🇰🇷'),
  ('DR Congo',        'RD Congo',        'G', '🇨🇩'),
-- Group H
  ('England',         'Inglaterra',      'H', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'),
  ('Australia',       'Austrália',       'H', '🇦🇺'),
  ('Iran',            'Irão',            'H', '🇮🇷'),
  ('TBD UEFA-PO-D',   'TBD UEFA-PO-D',   'H', '🏳️'),
-- Group I
  ('Croatia',         'Croácia',         'I', '🇭🇷'),
  ('Serbia',          'Sérvia',          'I', '🇷🇸'),
  ('Nigeria',         'Nigéria',         'I', '🇳🇬'),
  ('Chile',           'Chile',           'I', '🇨🇱'),
-- Group J
  ('Belgium',         'Bélgica',         'J', '🇧🇪'),
  ('Qatar',           'Qatar',           'J', '🇶🇦'),
  ('Egypt',           'Egito',           'J', '🇪🇬'),
  ('TBD-J4',          'TBD-J4',          'J', '🏳️'),
-- Group K
  ('Switzerland',     'Suíça',           'K', '🇨🇭'),
  ('Algeria',         'Argélia',         'K', '🇩🇿'),
  ('Venezuela',       'Venezuela',       'K', '🇻🇪'),
  ('Slovenia',        'Eslovénia',       'K', '🇸🇮'),
-- Group L
  ('Turkey',          'Turquia',         'L', '🇹🇷'),
  ('Bolivia',         'Bolívia',         'L', '🇧🇴'),
  ('Cameroon',        'Camarões',        'L', '🇨🇲'),
  ('TBD-L4',          'TBD-L4',          'L', '🏳️');

-- ⚠️  Groups above follow the December 2025 FIFA draw as best known.
--     Use Admin Panel → 🌍 Teams to fix any errors or update TBD teams.

-- 3. MATCHES
CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  round TEXT NOT NULL,
  group_name TEXT,
  match_date TIMESTAMPTZ,
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_goals INTEGER,
  away_goals INTEGER,
  home_penalties INTEGER,
  away_penalties INTEGER,
  status TEXT DEFAULT 'scheduled'
);

-- Group stage 72 matches (teams 1-48, 6 matches per group)
INSERT INTO matches(id,round,group_name,match_date,home_team_id,away_team_id) VALUES
(1,'group','A','2026-06-11 20:00+00',1,2),(2,'group','A','2026-06-12 23:00+00',3,4),
(3,'group','A','2026-06-16 20:00+00',1,3),(4,'group','A','2026-06-16 23:00+00',2,4),
(5,'group','A','2026-06-21 20:00+00',4,1),(6,'group','A','2026-06-21 20:00+00',2,3),
(7,'group','B','2026-06-12 20:00+00',5,6),(8,'group','B','2026-06-12 23:00+00',7,8),
(9,'group','B','2026-06-17 20:00+00',5,7),(10,'group','B','2026-06-17 23:00+00',6,8),
(11,'group','B','2026-06-22 20:00+00',8,5),(12,'group','B','2026-06-22 20:00+00',6,7),
(13,'group','C','2026-06-13 20:00+00',9,10),(14,'group','C','2026-06-13 23:00+00',11,12),
(15,'group','C','2026-06-18 20:00+00',9,11),(16,'group','C','2026-06-18 23:00+00',10,12),
(17,'group','C','2026-06-23 20:00+00',12,9),(18,'group','C','2026-06-23 20:00+00',10,11),
(19,'group','D','2026-06-13 20:00+00',13,14),(20,'group','D','2026-06-14 23:00+00',15,16),
(21,'group','D','2026-06-18 20:00+00',13,15),(22,'group','D','2026-06-19 23:00+00',14,16),
(23,'group','D','2026-06-23 20:00+00',16,13),(24,'group','D','2026-06-23 20:00+00',14,15),
(25,'group','E','2026-06-14 20:00+00',17,18),(26,'group','E','2026-06-14 23:00+00',19,20),
(27,'group','E','2026-06-19 20:00+00',17,19),(28,'group','E','2026-06-19 23:00+00',18,20),
(29,'group','E','2026-06-24 20:00+00',20,17),(30,'group','E','2026-06-24 20:00+00',18,19),
(31,'group','F','2026-06-15 20:00+00',21,22),(32,'group','F','2026-06-15 23:00+00',23,24),
(33,'group','F','2026-06-20 20:00+00',21,23),(34,'group','F','2026-06-20 23:00+00',22,24),
(35,'group','F','2026-06-24 20:00+00',24,21),(36,'group','F','2026-06-24 20:00+00',22,23),
(37,'group','G','2026-06-15 20:00+00',25,26),(38,'group','G','2026-06-16 23:00+00',27,28),
(39,'group','G','2026-06-20 20:00+00',25,27),(40,'group','G','2026-06-20 23:00+00',26,28),
(41,'group','G','2026-06-25 20:00+00',28,25),(42,'group','G','2026-06-25 20:00+00',26,27),
(43,'group','H','2026-06-16 20:00+00',29,30),(44,'group','H','2026-06-17 23:00+00',31,32),
(45,'group','H','2026-06-21 20:00+00',29,31),(46,'group','H','2026-06-21 23:00+00',30,32),
(47,'group','H','2026-06-26 20:00+00',32,29),(48,'group','H','2026-06-26 20:00+00',30,31),
(49,'group','I','2026-06-17 20:00+00',33,34),(50,'group','I','2026-06-17 23:00+00',35,36),
(51,'group','I','2026-06-22 20:00+00',33,35),(52,'group','I','2026-06-22 23:00+00',34,36),
(53,'group','I','2026-06-27 20:00+00',36,33),(54,'group','I','2026-06-27 20:00+00',34,35),
(55,'group','J','2026-06-18 20:00+00',37,38),(56,'group','J','2026-06-18 23:00+00',39,40),
(57,'group','J','2026-06-23 20:00+00',37,39),(58,'group','J','2026-06-23 23:00+00',38,40),
(59,'group','J','2026-06-28 20:00+00',40,37),(60,'group','J','2026-06-28 20:00+00',38,39),
(61,'group','K','2026-06-19 20:00+00',41,42),(62,'group','K','2026-06-19 23:00+00',43,44),
(63,'group','K','2026-06-24 20:00+00',41,43),(64,'group','K','2026-06-24 23:00+00',42,44),
(65,'group','K','2026-06-29 20:00+00',44,41),(66,'group','K','2026-06-29 20:00+00',42,43),
(67,'group','L','2026-06-20 20:00+00',45,46),(68,'group','L','2026-06-20 23:00+00',47,48),
(69,'group','L','2026-06-25 20:00+00',45,47),(70,'group','L','2026-06-25 23:00+00',46,48),
(71,'group','L','2026-06-30 20:00+00',48,45),(72,'group','L','2026-06-30 20:00+00',46,47);

-- Knockout (73-104) — team assignments filled by admin after group stage
INSERT INTO matches(id,round) VALUES
(73,'r32'),(74,'r32'),(75,'r32'),(76,'r32'),(77,'r32'),(78,'r32'),(79,'r32'),(80,'r32'),
(81,'r32'),(82,'r32'),(83,'r32'),(84,'r32'),(85,'r32'),(86,'r32'),(87,'r32'),(88,'r32'),
(89,'r16'),(90,'r16'),(91,'r16'),(92,'r16'),(93,'r16'),(94,'r16'),(95,'r16'),(96,'r16'),
(97,'qf'),(98,'qf'),(99,'qf'),(100,'qf'),
(101,'sf'),(102,'sf'),(103,'third'),(104,'final');

-- 4. PARTICIPANTS & PREDICTIONS
CREATE TABLE participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE group_predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  match_id INTEGER REFERENCES matches(id),
  home_goals INTEGER NOT NULL CHECK (home_goals >= 0),
  away_goals INTEGER NOT NULL CHECK (away_goals >= 0),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(participant_id, match_id)
);
CREATE TABLE knockout_predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  match_id INTEGER REFERENCES matches(id),
  home_goals INTEGER CHECK (home_goals >= 0),
  away_goals INTEGER CHECK (away_goals >= 0),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(participant_id, match_id)
);
CREATE TABLE award_predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  award_type TEXT NOT NULL,
  prediction TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(participant_id, award_type)
);
CREATE TABLE scores (
  participant_id UUID REFERENCES participants(id) PRIMARY KEY,
  group_points NUMERIC DEFAULT 0,
  ko_points NUMERIC DEFAULT 0,
  award_points NUMERIC DEFAULT 0,
  total_points NUMERIC DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ROW LEVEL SECURITY
-- Public: read all tables (for transparency/auditability).
-- Public: write participants + predictions only.
-- Admin tables (matches, teams, settings, award_results): READ-ONLY for anon key.
-- The service_role key (admin.html) bypasses RLS automatically — no write policies needed.

ALTER TABLE participants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_predictions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE knockout_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_predictions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores               ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams                ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_results        ENABLE ROW LEVEL SECURITY;

-- Public read on everything
CREATE POLICY "pub_read" ON participants         FOR SELECT USING (true);
CREATE POLICY "pub_read" ON matches              FOR SELECT USING (true);
CREATE POLICY "pub_read" ON teams                FOR SELECT USING (true);
CREATE POLICY "pub_read" ON scores               FOR SELECT USING (true);
CREATE POLICY "pub_read" ON scoring_settings     FOR SELECT USING (true);
CREATE POLICY "pub_read" ON tournament_settings  FOR SELECT USING (true);
CREATE POLICY "pub_read" ON award_results        FOR SELECT USING (true);
CREATE POLICY "pub_read" ON group_predictions    FOR SELECT USING (true);
CREATE POLICY "pub_read" ON knockout_predictions FOR SELECT USING (true);
CREATE POLICY "pub_read" ON award_predictions    FOR SELECT USING (true);

-- Public write: participants + predictions only
CREATE POLICY "pub_insert_participants" ON participants         FOR INSERT WITH CHECK (true);
CREATE POLICY "pub_insert_group_preds"  ON group_predictions    FOR INSERT WITH CHECK (true);
CREATE POLICY "pub_update_group_preds"  ON group_predictions    FOR UPDATE USING (true);
CREATE POLICY "pub_insert_ko_preds"     ON knockout_predictions FOR INSERT WITH CHECK (true);
CREATE POLICY "pub_update_ko_preds"     ON knockout_predictions FOR UPDATE USING (true);
CREATE POLICY "pub_insert_award_preds"  ON award_predictions    FOR INSERT WITH CHECK (true);
CREATE POLICY "pub_update_award_preds"  ON award_predictions    FOR UPDATE USING (true);
CREATE POLICY "pub_insert_scores"       ON scores               FOR INSERT WITH CHECK (true);

-- NO write policies on: matches, teams, scoring_settings, tournament_settings, award_results
-- These are admin-only — service_role key handles writes automatically (bypasses RLS).
