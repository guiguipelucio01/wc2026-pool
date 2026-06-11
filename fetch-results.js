// ============================================================
// WC 2026 — Auto Results Fetcher
// Runs via GitHub Actions every 5 minutes during the tournament.
// Node 22+ has built-in fetch and WebSocket — no extra packages needed beyond @supabase/supabase-js.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
const API_KEY          = process.env.FOOTBALL_DATA_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SVC_KEY || !API_KEY) {
  console.error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, FOOTBALL_DATA_API_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);

// football-data.org competition ID for FIFA World Cup.
// Verify at: https://api.football-data.org/v4/competitions (once 2026 season is live)
const WC_COMPETITION_ID = 2000;

// Name normalisation map — add entries as needed when the 2026 API goes live.
// Maps football-data.org team names → our team names (both lowercased).
const NAME_MAP = {
  "united states":       "usa",
  "korea republic":      "south korea",
  "republic of ireland": "ireland",
  "iran (islamic republic of)": "iran",
  "turkiye":             "turkey",
  "türkiye":             "turkey",
  "cote d'ivoire":       "ivory coast",
  "côte d'ivoire":       "ivory coast",
  "czechia":             "czech republic",
};

function norm(name = "") {
  const n = name.toLowerCase().trim().replace(/\s+/g, " ");
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
  console.log("Fetching live + finished WC 2026 matches from football-data.org...");

  const res = await fetchWithRetry(
    `https://api.football-data.org/v4/competitions/${WC_COMPETITION_ID}/matches?status=IN_PLAY,PAUSED,FINISHED`,
    { headers: { "X-Auth-Token": API_KEY } }
  );

  if (!res.ok) {
    const body = await res.text();
    console.log(`API returned ${res.status} — competition data not available yet. Nothing to update.`);
    console.log(body.slice(0, 300));
    return; // exit 0 — not our fault, just no data yet
  }

  const { matches: apiMatches = [] } = await res.json();
  console.log(`API returned ${apiMatches.length} finished matches`);
  if (!apiMatches.length) { console.log("Nothing to update."); return; }

  // Load our matches WITH team names via join
  const { data: ourMatches, error: mErr } = await db
    .from("matches")
    .select("id, match_date, home_goals, round, home_team_id, away_team_id, home:teams!home_team_id(name_en), away:teams!away_team_id(name_en)");
  if (mErr) { console.error("DB error loading matches:", mErr.message); process.exit(1); }

  let updated = 0;

  for (const api of apiMatches) {
    const isFinished = api.status === "FINISHED";
    const isLive     = ["IN_PLAY", "PAUSED", "HALFTIME"].includes(api.status);

    const hg = api.score?.fullTime?.home ?? (isLive ? (api.score?.halfTime?.home ?? 0) : null);
    const ag = api.score?.fullTime?.away ?? (isLive ? (api.score?.halfTime?.away ?? 0) : null);
    if (hg == null || ag == null) continue;

    const apiHomeNorm = norm(api.homeTeam?.name);
    const apiAwayNorm = norm(api.awayTeam?.name);
    const apiDate     = api.utcDate?.substring(0, 10);

    const our = ourMatches?.find(m => {
      if (m.status === "finished") return false; // never overwrite a finalised result
      if (!m.match_date) return false;
      const ourDate     = m.match_date.substring(0, 10);
      const ourHomeNorm = norm(m.home?.name_en);
      const ourAwayNorm = norm(m.away?.name_en);
      return ourDate === apiDate && ourHomeNorm === apiHomeNorm && ourAwayNorm === apiAwayNorm;
    });

    if (!our) {
      if (isFinished) console.log(`  No match found for: ${apiHomeNorm} vs ${apiAwayNorm} on ${apiDate}`);
      continue;
    }

    if (isFinished) {
      const hp = api.score?.penalties?.home ?? null;
      const ap = api.score?.penalties?.away ?? null;
      const { error } = await db.from("matches").update({
        home_goals: hg, away_goals: ag,
        home_penalties: hp, away_penalties: ap,
        status: "finished",
      }).eq("id", our.id);
      if (error) console.error(`  Error match #${our.id}:`, error.message);
      else { console.log(`  ✅ Final #${our.id}: ${apiHomeNorm} ${hg}-${ag} ${apiAwayNorm}`); updated++; }
    } else {
      const { error } = await db.from("matches").update({
        home_goals: hg, away_goals: ag, status: "in_play",
      }).eq("id", our.id);
      if (error) console.error(`  Error live match #${our.id}:`, error.message);
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
