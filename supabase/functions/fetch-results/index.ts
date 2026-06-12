// WC 2026 — Auto Results Fetcher (Supabase Edge Function, Deno runtime)
// Scheduled via pg_cron every 2 minutes for reliable live + finished score updates.
// GitHub Actions (fetch-results.js) runs every 5 min as a fallback.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const db = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);

const NAME_MAP: Record<string, string> = {
  "united states":                    "usa",
  "usa":                              "usa",
  "korea republic":                   "south korea",
  "republic of korea":                "south korea",
  "ir iran":                          "iran",
  "turkiye":                          "turkey",
  "cote d'ivoire":                    "ivory coast",
  "czechia":                          "czech republic",
  "dr congo":                         "dr congo",
  "congo dr":                         "dr congo",
  "democratic republic of the congo": "dr congo",
  "bosnia and herzegovina":           "bosnia & herzegovina",
  "bosnia-herzegovina":               "bosnia & herzegovina",
  "bosnia & herzegovina":             "bosnia & herzegovina",
};

function norm(name = "") {
  const stripped = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const n = stripped.toLowerCase().trim().replace(/\s+/g, " ");
  return NAME_MAP[n] || n;
}

const FINISHED_STATUSES = new Set([
  "STATUS_FULL_TIME", "STATUS_FINAL", "STATUS_FULL_PEN",
  "STATUS_FT", "STATUS_FINAL_AET", "STATUS_FINAL_PEN",
]);
const LIVE_STATUSES = new Set([
  "STATUS_IN_PROGRESS", "STATUS_HALF_TIME", "STATUS_EXTRA_TIME",
  "STATUS_FIRST_HALF", "STATUS_SECOND_HALF", "STATUS_OVERTIME",
  "STATUS_SHOOTOUT",
]);

async function fetchWithRetry(url: string, retries = 3, delayMs = 2000): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url);
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  Attempt ${attempt} failed, retrying in ${delayMs / 1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
  throw new Error("unreachable");
}

// deno-lint-ignore no-explicit-any
async function fetchScoreboardForDate(dateStr: string): Promise<any[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) { console.log(`  ESPN ${dateStr}: HTTP ${res.status}`); return []; }
  const json = await res.json();
  return json.events || [];
}

async function run(): Promise<string> {
  console.log("Fetching live + finished WC 2026 matches from ESPN...");

  const now = new Date();
  const today     = now.toISOString().slice(0, 10).replace(/-/g, "");
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10).replace(/-/g, "");

  const [todayEvts, yestEvts] = await Promise.all([
    fetchScoreboardForDate(today),
    fetchScoreboardForDate(yesterday),
  ]);

  const seen = new Set<string>();
  // deno-lint-ignore no-explicit-any
  const allEvents: any[] = [];
  for (const ev of [...todayEvts, ...yestEvts]) {
    if (!seen.has(ev.id)) { seen.add(ev.id); allEvents.push(ev); }
  }

  const relevant = allEvents.filter(ev => {
    const st = ev.status?.type?.name;
    return FINISHED_STATUSES.has(st) || LIVE_STATUSES.has(st);
  });

  console.log(`ESPN: ${allEvents.length} total event(s), ${relevant.length} live/finished`);
  if (!relevant.length) { console.log("Nothing to update."); return "Nothing to update."; }

  const { data: ourMatches, error: mErr } = await db
    .from("matches")
    .select("id, match_date, home_goals, status, round, home_team_id, away_team_id, home:teams!home_team_id(name_en), away:teams!away_team_id(name_en)");
  if (mErr) throw new Error(`DB error: ${mErr.message}`);

  let updated = 0;

  for (const ev of relevant) {
    const statusName = ev.status?.type?.name;
    const isFinished = FINISHED_STATUSES.has(statusName);
    const isLive     = LIVE_STATUSES.has(statusName);
    const comp = ev.competitions?.[0];
    if (!comp) continue;

    const homeComp = comp.competitors?.find((c: { homeAway: string }) => c.homeAway === "home");
    const awayComp = comp.competitors?.find((c: { homeAway: string }) => c.homeAway === "away");
    if (!homeComp || !awayComp) continue;

    const hg = homeComp.score != null ? parseInt(homeComp.score, 10) : null;
    const ag = awayComp.score != null ? parseInt(awayComp.score, 10) : null;

    if (hg == null || ag == null || isNaN(hg) || isNaN(ag)) {
      if (isFinished) console.log(`  ⏳ FINISHED but score null: ${homeComp.team?.displayName} vs ${awayComp.team?.displayName}`);
      continue;
    }

    const apiHomeNorm = norm(homeComp.team?.displayName);
    const apiAwayNorm = norm(awayComp.team?.displayName);
    const apiDate     = comp.date?.substring(0, 10);

    // deno-lint-ignore no-explicit-any
    const our = (ourMatches as any[])?.find(m => {
      if (m.status === "finished") return false;
      if (!m.match_date) return false;
      const ourDate     = m.match_date.substring(0, 10);
      const ourHomeNorm = norm(m.home?.name_en);
      const ourAwayNorm = norm(m.away?.name_en);
      return ourDate === apiDate && ourHomeNorm === apiHomeNorm && ourAwayNorm === apiAwayNorm;
    });

    if (!our) {
      console.log(`  No DB match for: ${apiHomeNorm} vs ${apiAwayNorm} on ${apiDate} (${statusName})`);
      continue;
    }

    if (isFinished) {
      const hp = statusName === "STATUS_FULL_PEN" ? (comp.shootoutScores?.home ?? null) : null;
      const ap = statusName === "STATUS_FULL_PEN" ? (comp.shootoutScores?.away ?? null) : null;

      const { error } = await db.from("matches").update({
        home_goals: hg, away_goals: ag,
        home_penalties: hp, away_penalties: ap,
        status: "finished",
      }).eq("id", our.id);
      if (error) console.error(`  Error #${our.id}:`, error.message);
      else { console.log(`  ✅ Final #${our.id}: ${apiHomeNorm} ${hg}-${ag} ${apiAwayNorm}`); updated++; }
    } else if (isLive) {
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
  return `${updated} finished match(es) updated. ${relevant.length} live/finished in ESPN feed.`;
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

  const sc: Record<string, number> = {};
  scR.data?.forEach((s: { key: string; value: string }) => { sc[s.key] = parseFloat(s.value); });
  const awards: Record<string, string | null> = {};
  arR.data?.forEach((a: { award_type: string; result?: string }) => {
    awards[a.award_type] = a.result?.toLowerCase().trim() || null;
  });
  // deno-lint-ignore no-explicit-any
  const mm: Record<string, any> = {};
  mR.data?.forEach((m: { id: string }) => { mm[m.id] = m; });

  const res = (h: number, a: number) => h > a ? "H" : h < a ? "A" : "D";

  // deno-lint-ignore no-explicit-any
  const scores = (pR.data || []).map((p: any) => {
    let g = 0, k = 0, aw = 0;

    // deno-lint-ignore no-explicit-any
    for (const pr of (gR.data || []).filter((x: any) => x.participant_id === p.id)) {
      const m = mm[pr.match_id]; if (!m || m.home_goals == null) continue;
      if (res(pr.home_goals, pr.away_goals) === res(m.home_goals, m.away_goals)) g += (sc.group_correct_result    || 3);
      if (pr.home_goals - pr.away_goals === m.home_goals - m.away_goals)          g += (sc.group_correct_goal_diff || 1);
      if (pr.home_goals === m.home_goals && pr.away_goals === m.away_goals)        g += (sc.group_exact_score       || 1);
    }

    // deno-lint-ignore no-explicit-any
    for (const pr of (kR.data || []).filter((x: any) => x.participant_id === p.id)) {
      const m = mm[pr.match_id]; if (!m || m.home_goals == null) continue;
      if (res(pr.home_goals, pr.away_goals) === res(m.home_goals, m.away_goals)) k += (sc.ko_correct_result    || 4);
      if (pr.home_goals - pr.away_goals === m.home_goals - m.away_goals)          k += (sc.ko_correct_goal_diff || 1);
      if (pr.home_goals === m.home_goals && pr.away_goals === m.away_goals)        k += (sc.ko_exact_score       || 2);
    }

    // deno-lint-ignore no-explicit-any
    for (const pr of (aR.data || []).filter((x: any) => x.participant_id === p.id)) {
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

Deno.serve(async () => {
  try {
    const result = await run();
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Fatal:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
