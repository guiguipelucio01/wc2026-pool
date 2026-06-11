// ============================================================
// WC 2026 — Auto Results Fetcher (API-Football)
// Runs via GitHub Actions every 15 minutes during the tournament.
// Free tier: 100 req/day — every-15-min cron uses 96/day.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
const API_KEY          = process.env.APIFOOTBALL_KEY;

if (!SUPABASE_URL || !SUPABASE_SVC_KEY || !API_KEY) {
  console.error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, APIFOOTBALL_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);

// API-Football league ID for FIFA World Cup
const WC_LEAGUE_ID = 1;

// Maps API-Football team names (lowercased, accent-stripped) → our DB name_en (lowercased)
const NAME_MAP = {
  "united states":                    "usa",
  "korea republic":                   "south korea",
  "republic of korea":                "south korea",
  "ir iran":                          "iran",
  "turkiye":                          "turkey",
  "cote d'ivoire":                    "ivory coast",
  "ivory coast":                      "ivory coast",
  "czechia":                          "czech republic",
  "dr congo":                         "dr congo",
  "congo dr":                         "dr congo",
  "democratic republic of the congo": "dr congo",
  "bosnia and herzegovina":           "bosnia & herzegovina",
  "bosnia & herzegovina":             "bosnia & herzegovina",
};

function norm(name = "") {
  const stripped = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const n = stripped.toLowerCase().trim().replace(/\s+/g, " ");
  return NAME_MAP[n] || n;
}

async function fetchWithRetry(url, options, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  Attempt ${attempt} failed (${err.cause?.code || err.message}), retrying in ${delayMs / 1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
}

async function run() {
  console.log("Fetching live + finished WC 2026 matches from API-Football...");

  // FT/AET/PEN = finished; 1H/HT/2H/ET/BT/P = in progress
  const statuses = "FT-AET-PEN-1H-HT-2H-ET-BT-P";
  const res = await fetchWithRetry(
    `https://v3.football.api-sports.io/fixtures?league=${WC_LEAGUE_ID}&season=2026&status=${statuses}`,
    { headers: { "x-apisports-key": API_KEY } }
  );

  if (!res.ok) {
    const body = await res.text();
    console.log(`API returned ${res.status}. Body: ${body.slice(0, 300)}`);
    return;
  }

  const json = await res.json();
  const fixtures = json.response || [];
  console.log(`API returned ${fixtures.length} fixture(s)`);

  if (!fixtures.length) { console.log("Nothing to update."); return; }

  const f0 = fixtures[0];
  console.log(`  [dbg] First: ${f0.teams?.home?.name} vs ${f0.teams?.away?.name}, status=${f0.fixture?.status?.short}, goals=${JSON.stringify(f0.goals)}`);

  const { data: ourMatches, error: mErr } = await db
    .from("matches")
    .select("id, match_date, home_goals, status, round, home_team_id, away_team_id, home:teams!home_team_id(name_en), away:teams!away_team_id(name_en)");
  if (mErr) { console.error("DB error:", mErr.message); process.exit(1); }

  let updated = 0;

  for (const fix of fixtures) {
    const st = fix.fixture?.status?.short;
    const isFinished = ["FT", "AET", "PEN"].includes(st);
    const isLive     = ["1H", "HT", "2H", "ET", "BT", "P"].includes(st);

    const hg = fix.goals?.home ?? null;
    const ag = fix.goals?.away ?? null;

    if (hg == null || ag == null) {
      if (isFinished) console.log(`  ⏳ FINISHED but goals null: ${fix.teams?.home?.name} vs ${fix.teams?.away?.name}`);
      continue;
    }

    const apiHomeNorm = norm(fix.teams?.home?.name);
    const apiAwayNorm = norm(fix.teams?.away?.name);
    const apiDate     = fix.fixture?.date?.substring(0, 10);

    const our = ourMatches?.find(m => {
      if (m.status === "finished") return false;
      if (!m.match_date) return false;
      const ourDate     = m.match_date.substring(0, 10);
      const ourHomeNorm = norm(m.home?.name_en);
      const ourAwayNorm = norm(m.away?.name_en);
      return ourDate === apiDate && ourHomeNorm === apiHomeNorm && ourAwayNorm === apiAwayNorm;
    });

    if (!our) {
      console.log(`  No DB match for: ${apiHomeNorm} vs ${apiAwayNorm} on ${apiDate} (${st})`);
      continue;
    }

    if (isFinished) {
      const hp = fix.score?.penalty?.home ?? null;
      const ap = fix.score?.penalty?.away ?? null;
      const { error } = await db.from("matches").update({
        home_goals: hg, away_goals: ag,
        home_penalties: hp, away_penalties: ap,
        status: "finished",
      }).eq("id", our.id);
      if (error) console.error(`  Error #${our.id}:`, error.message);
      else { console.log(`  ✅ Final #${our.id}: ${apiHomeNorm} ${hg}-${ag} ${apiAwayNorm}`); updated++; }
    } else {
      const { error } = await db.from("matches").update({
        home_goals: hg, away_goals: ag, status: "in_play",
      }).eq("id", our.id);
      if (error) console.error(`  Error live #${our.id}:`, error.message);
      else console.log(`  🔴 Live  #${our.id}: ${apiHomeNorm} ${hg}-${ag} ${apiAwayNorm}`);
    }
  }

  console.log(`\n${updated} finished match(es) updated.`);
  if (updated > 0) { console.log("Recalculating scores..."); await recalc(); }
  console.log("Done.");
}

async function recalc() {
  const [pR, gR, kR, aR, mR, arR, scR] = await Promise.all([
    db.from("participants").select("id,name"),
    db.from("group_predictions").select("*"),
    db.from("knockout_predictions").select("*"),
    db.from("award_predictions").select("*"),
    db.from("matches").select("*"),
    db.from("award_results").select("*"),
    db.from("scoring_settings").select("*"),
  ]);

  const sc = {};  scR.data?.forEach(s => { sc[s.key] = parseFloat(s.value); });
  const awards = {}; arR.data?.forEach(a => { awards[a.award_type] = a.result?.toLowerCase().trim() || null; });
  const mm = {};  mR.data?.forEach(m => { mm[m.id] = m; });

  const res = (h, a) => h > a ? "H" : h < a ? "A" : "D";

  const scores = (pR.data || []).map(p => {
    let g = 0, k = 0, aw = 0;

    for (const pr of (gR.data || []).filter(x => x.participant_id === p.id)) {
      const m = mm[pr.match_id]; if (!m || m.home_goals == null) continue;
      if (res(pr.home_goals, pr.away_goals) === res(m.home_goals, m.away_goals)) g += (sc.group_correct_result    || 3);
      if (pr.home_goals - pr.away_goals === m.home_goals - m.away_goals)          g += (sc.group_correct_goal_diff || 1);
      if (pr.home_goals === m.home_goals && pr.away_goals === m.away_goals)        g += (sc.group_exact_score       || 1);
    }

    for (const pr of (kR.data || []).filter(x => x.participant_id === p.id)) {
      const m = mm[pr.match_id]; if (!m || m.home_goals == null) continue;
      if (res(pr.home_goals, pr.away_goals) === res(m.home_goals, m.away_goals)) k += (sc.ko_correct_result    || 4);
      if (pr.home_goals - pr.away_goals === m.home_goals - m.away_goals)          k += (sc.ko_correct_goal_diff || 1);
      if (pr.home_goals === m.home_goals && pr.away_goals === m.away_goals)        k += (sc.ko_exact_score       || 2);
    }

    for (const pr of (aR.data || []).filter(x => x.participant_id === p.id)) {
      const actual = awards[pr.award_type];
      if (actual && pr.prediction && actual === pr.prediction.toLowerCase().trim())
        aw += (sc[`award_${pr.award_type}`] || 5);
    }

    return { participant_id: p.id, group_points: g, ko_points: k, award_points: aw,
             total_points: g + k + aw, last_updated: new Date().toISOString() };
  });

  const { error } = await db.from("scores").upsert(scores, { onConflict: "participant_id" });
  if (error) console.error("Score upsert error:", error.message);
  else       console.log(`Scores updated for ${scores.length} participants.`);
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
