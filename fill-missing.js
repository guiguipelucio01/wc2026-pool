// Fills missing group predictions with random scores for all validated participants.
// Runs automatically via GitHub Actions at 19:50 UTC on June 11, 2026 — 10 min before kickoff.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
  console.error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);

function randGoal() {
  // Max 2 goals: realistic low-scoring football results (2x0, 2x1, 2x2, 1x0, etc.)
  const pool = [0, 0, 0, 1, 1, 1, 2, 2];
  return pool[Math.floor(Math.random() * pool.length)];
}

async function run() {
  const [{ data: participants, error: pErr }, { data: matches, error: mErr }, { data: existing, error: eErr }] =
    await Promise.all([
      db.from("participants").select("id, name").eq("is_validated", true),
      db.from("matches").select("id").eq("round", "group"),
      db.from("group_predictions").select("participant_id, match_id"),
    ]);

  if (pErr || mErr || eErr) {
    console.error("DB error:", pErr?.message || mErr?.message || eErr?.message);
    process.exit(1);
  }

  console.log(`${participants.length} validated participants, ${matches.length} group matches`);

  const existingSet = new Set((existing || []).map(e => `${e.participant_id}_${e.match_id}`));

  const toInsert = [];
  for (const p of participants) {
    const missing = matches.filter(m => !existingSet.has(`${p.id}_${m.id}`));
    if (missing.length) {
      console.log(`  ${p.name}: filling ${missing.length} missing prediction(s)`);
      for (const m of missing) {
        toInsert.push({ participant_id: p.id, match_id: m.id, home_goals: randGoal(), away_goals: randGoal() });
      }
    }
  }

  if (!toInsert.length) {
    console.log("All participants already have predictions for every group match. Nothing to do.");
    return;
  }

  const { error } = await db.from("group_predictions").insert(toInsert);
  if (error) { console.error("Insert error:", error.message); process.exit(1); }
  console.log(`\nDone — filled ${toInsert.length} missing prediction(s).`);
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
