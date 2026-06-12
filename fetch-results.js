// ============================================================
// WC 2026 — Auto Results Fetcher (ESPN public API — no key needed)
// Runs via Supabase Edge Function every 2 min; GitHub Actions every 5 min as fallback.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
  console.error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);

// Maps ESPN team names (lowercased, accent-stripped) → our DB name_en (lowercased)
const NAME_MAP = {
  // USA
  "united states":                    "usa",
  "usa":                              "usa",
  "u.s.a.":                           "usa",
  // South Korea
  "korea republic":                   "south korea",
  "republic of korea":                "south korea",
  // Iran
  "ir iran":                          "iran",
  "islamic republic of iran":         "iran",
  // Turkey
  "turkiye":                          "turkey",
  "turkey":                           "turkey",
  // Ivory Coast
  "cote d'ivoire":                    "ivory coast",
  "ivory coast":                      "ivory coast",
  // Czech Republic
  "czechia":                          "czech republic",
  "czech republic":                   "czech republic",
  // DR Congo
  "dr congo":                         "dr congo",
  "congo dr":                         "dr congo",
  "democratic republic of the congo": "dr congo",
  "congo, dem. rep.":                 "dr congo",
  // Bosnia
  "bosnia and herzegovina":           "bosnia & herzegovina",
  "bosnia-herzegovina":               "bosnia & herzegovina",
  "bosnia & herzegovina":             "bosnia & herzegovina",
  "bih":                              "bosnia & herzegovina",
  // Netherlands
  "holland":                          "netherlands",
  // Cape Verde
  "cabo verde":                       "cape verde",
  // Saudi Arabia
  "ksa":                              "saudi arabia",
  // New Zealand
  "new zealand":                      "new zealand",
  "nzl":                              "new zealand",
};

function norm(name = "") {
  const stripped = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const n = stripped.toLowerCase().trim().replace(/\s+/g, " ");
  return NAME_MAP[n] || n;
}

// ESPN statuses that mean the match is finished
const FINISHED_STATUSES = new Set([
  "STATUS_FULL_TIME", "STATUS_FINAL", "STATUS_FULL_PEN",
  "STATUS_FT", "STATUS_FINAL_AET", "STATUS_FINAL_PEN",
]);
// ESPN statuses that mean the match is in progress
const LIVE_STATUSES = new Set([
  "STATUS_IN_PROGRESS", "STATUS_HALF_TIME", "STATUS_EXTRA_TIME",
  "STATUS_FIRST_HALF", "STATUS_SECOND_HALF", "STATUS_OVERTIME",
  "STATUS_SHOOTOUT",
]);

async function fetchWithRetry(url, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url);
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  Attempt ${attempt} failed (${err.cause?.code || err.message}), retrying in ${delayMs / 1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
}

async function fetchScoreboardForDate(dateStr) {
  // dateStr: "YYYYMMDD"
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) { console.log(`  ESPN ${dateStr}: HTTP ${res.status}`); return []; }
  const json = await res.json();
  return json.events || [];
}

async function run() {
  console.log("Fetching live + finished WC 2026 matches from ESPN...");

  // Fetch today and yesterday (covers matches that finished just after midnight UTC)
  const now = new Date();
  const today = now.toISOString().slice(0, 10).replace(/-/g, "");
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10).replace(/-/g, "");

  const [todayEvts, yestEvts] = await Promise.all([
    fetchScoreboardForDate(today),
    fetchScoreboardForDate(yesterday),
  ]);

  // Deduplicate by event ID
  const seen = new Set();
  const allEvents = [];
  for (const ev of [...todayEvts, ...yestEvts]) {
    if (!seen.has(ev.id)) { seen.add(ev.id); allEvents.push(ev); }
  }

  const relevant = allEvents.filter(ev => {
    const st = ev.status?.type?.name;
    return FINISHED_STATUSES.has(st) || LIVE_STATUSES.has(st);
  });

  console.log(`ESPN: ${allEvents.length} total event(s), ${relevant.length} live/finished`);
  if (!relevant.length) { console.log("Nothing to update."); return; }

  const ev0 = relevant[0];
  const comp0 = ev0.competitions?.[0];
  const home0 = comp0?.competitors?.find(c => c.homeAway === "home");
  const away0 = comp0?.competitors?.find(c => c.homeAway === "away");
  console.log(`  [dbg] First: ${home0?.team?.displayName} vs ${away0?.team?.displayName}, status=${ev0.status?.type?.name}, score=${home0?.score}-${away0?.score}`);

  const { data: ourMatches, error: mErr } = await db
    .from("matches")
    .select("id, match_date, home_goals, status, round, home_team_id, away_team_id, home:teams!home_team_id(name_en), away:teams!away_team_id(name_en)");
  if (mErr) { console.error("DB error:", mErr.message); process.exit(1); }

  let updated = 0;

  for (const ev of relevant) {
    const statusName = ev.status?.type?.name;
    const isFinished = FINISHED_STATUSES.has(statusName);
    const isLive     = LIVE_STATUSES.has(statusName);
    const comp = ev.competitions?.[0];
    if (!comp) continue;

    const homeComp = comp.competitors?.find(c => c.homeAway === "home");
    const awayComp = comp.competitors?.find(c => c.homeAway === "away");
    if (!homeComp || !awayComp) continue;

    const hg = homeComp.score != null ? parseInt(homeComp.score, 10) : null;
    const ag = awayComp.score != null ? parseInt(awayComp.score, 10) : null;

    if (hg == null || ag == null || isNaN(hg) || isNaN(ag)) {
      if (isFinished) console.log(`  ⏳ FINISHED but score null: ${homeComp.team?.displayName} vs ${awayComp.team?.displayName}`);
      continue;
    }

    const apiHomeNorm = norm(homeComp.team?.displayName);
    const apiAwayNorm = norm(awayComp.team?.displayName);
    const apiDate     = comp.date?.substring(0, 10); // "2026-06-11"

    const apiDateMs = new Date(apiDate + "T00:00:00Z").getTime();
    const our = ourMatches?.find(m => {
      if (m.status === "finished") return false;
      if (!m.match_date) return false;
      const ourHomeNorm = norm(m.home?.name_en);
      const ourAwayNorm = norm(m.away?.name_en);
      if (ourHomeNorm !== apiHomeNorm || ourAwayNorm !== apiAwayNorm) return false;
      // Allow ±1 day: times stored with local tz offset (e.g. 23:00-04 EDT) roll
      // into the next UTC date, so ESPN's date and the DB's UTC date can differ by 1.
      const ourDateMs = new Date(m.match_date.substring(0, 10) + "T00:00:00Z").getTime();
      return Math.abs(ourDateMs - apiDateMs) <= 86400000;
    });

    if (!our) {
      console.log(`  No DB match for: ${apiHomeNorm} vs ${apiAwayNorm} on ${apiDate} (${statusName})`);
      continue;
    }

    if (isFinished) {
      // Check for penalty shootout scores
      const hp = isFinished && statusName === "STATUS_FULL_PEN"
        ? (comp.shootoutScores?.home ?? null) : null;
      const ap = isFinished && statusName === "STATUS_FULL_PEN"
        ? (comp.shootoutScores?.away ?? null) : null;

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
