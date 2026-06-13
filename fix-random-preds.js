// Fixes all group predictions with goals > 2 (old random algorithm allowed up to 5).
// Also resets all scores to 0.
// After running: open admin.html → click "Recalculate All Scores Now".

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL     = 'https://wyfomomcjevtjwqffbix.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rBtDmIo-1BlQDhncJpQefw_c5beVSjR';

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function randGoal() {
  const pool = [0, 0, 0, 1, 1, 1, 2, 2];
  return pool[Math.floor(Math.random() * pool.length)];
}

async function run() {
  // 1. Find all predictions where any goal > 2
  console.log('Loading group predictions with goals > 2…');
  const { data: preds, error: pErr } = await db
    .from('group_predictions')
    .select('participant_id,match_id,home_goals,away_goals')
    .or('home_goals.gt.2,away_goals.gt.2');

  if (pErr) { console.error('Error:', pErr.message); process.exit(1); }
  console.log(`Found ${preds.length} predictions to fix.`);

  if (preds.length > 0) {
    // Load participant names for logging
    const { data: parts } = await db.from('participants').select('id,name');
    const nameMap = {};
    (parts || []).forEach(p => { nameMap[p.id] = p.name; });

    const updates = preds.map(p => {
      const hg = p.home_goals > 2 ? randGoal() : p.home_goals;
      const ag = p.away_goals > 2 ? randGoal() : p.away_goals;
      console.log(`  [${nameMap[p.participant_id] || p.participant_id}] match ${p.match_id}: ${p.home_goals}:${p.away_goals} → ${hg}:${ag}`);
      return { participant_id: p.participant_id, match_id: p.match_id, home_goals: hg, away_goals: ag };
    });

    const { error: uErr } = await db
      .from('group_predictions')
      .upsert(updates, { onConflict: 'participant_id,match_id' });

    if (uErr) { console.error('Upsert error:', uErr.message); process.exit(1); }
    console.log(`✅ Fixed ${updates.length} predictions.\n`);
  }

  // 2. Reset all scores to 0
  console.log('Loading participants to reset scores…');
  const { data: participants, error: partErr } = await db
    .from('participants')
    .select('id,name');

  if (partErr) { console.error('Error:', partErr.message); process.exit(1); }

  const zeroScores = participants.map(p => ({
    participant_id: p.id,
    group_points: 0,
    ko_points: 0,
    award_points: 0,
    total_points: 0,
    last_updated: new Date().toISOString(),
  }));

  const { error: sErr } = await db
    .from('scores')
    .upsert(zeroScores, { onConflict: 'participant_id' });

  if (sErr) { console.error('Score reset error:', sErr.message); process.exit(1); }
  console.log(`✅ Reset scores to 0 for ${participants.length} participants.\n`);

  console.log('All done! Now open admin.html → Recalculate → click "Recalculate All Scores Now".');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
