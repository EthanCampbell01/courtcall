import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import Tag from '../components/Tag';

/**
 * Stats page — shows your prediction stats, streaks, h2h with friends,
 * and overall accuracy breakdown.
 */
export default function Stats() {
  const { user } = useAuth();
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUserPredictions(user.id)
      .then(setPredictions)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user.id]);

  if (loading) return <LoadingPlaceholder />;

  const scored = predictions.filter(p => p.is_scored);
  const correct = scored.filter(p => p.points_earned > 0);
  const totalPoints = scored.reduce((a, p) => a + p.points_earned, 0);
  const winRate = scored.length > 0 ? Math.round((correct.length / scored.length) * 100) : 0;

  // Calculate current streak
  const sortedScored = [...scored].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  let streak = 0;
  let streakType = null;
  for (const p of sortedScored) {
    const won = p.points_earned > 0;
    if (streakType === null) streakType = won ? 'W' : 'L';
    if ((streakType === 'W' && won) || (streakType === 'L' && !won)) {
      streak++;
    } else {
      break;
    }
  }

  // Best predictions (highest scoring)
  const bestPredictions = [...scored]
    .sort((a, b) => b.points_earned - a.points_earned)
    .slice(0, 3);

  // Upset calls
  const upsetCalls = scored.filter(p => {
    const winnerSeed = p.predicted_winner === p.player1_name ? p.player1_seed : p.player2_seed;
    const loserSeed = p.predicted_winner === p.player1_name ? p.player2_seed : p.player1_seed;
    return loserSeed && (!winnerSeed || winnerSeed > loserSeed) && p.predicted_winner === p.winner_name;
  });

  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '8px 0 14px' }}>Your Stats</h2>

      {scored.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 50, marginBottom: 16 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No scored predictions yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Stats will appear once match results come in</div>
        </div>
      ) : (
        <>
          {/* Overview cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
            <StatCard label="Win Rate" value={`${winRate}%`} color="var(--accent)" icon="🎯" />
            <StatCard label="Total Points" value={totalPoints} color="var(--orange)" icon="⭐" />
            <StatCard label="Current Streak" value={`${streak}${streakType || ''}`} color={streakType === 'W' ? 'var(--accent)' : 'var(--red)'} icon={streakType === 'W' ? '🔥' : '❄️'} />
            <StatCard label="Upset Calls" value={upsetCalls.length} color="var(--purple)" icon="💥" />
          </div>

          {/* Accuracy breakdown */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Accuracy Breakdown</div>
            <AccuracyBar label="Correct Winner" correct={correct.length} total={scored.length} color="var(--accent)" />
            <AccuracyBar
              label="Correct Sets"
              correct={scored.filter(p => p.predicted_sets != null && p.sets_played != null && p.predicted_sets == p.sets_played).length}
              total={scored.filter(p => p.predicted_sets != null).length}
              color="var(--blue)"
            />
            <AccuracyBar
              label="Correct Score"
              correct={scored.filter(p => p.predicted_score && p.actual_score && normalizeScore(p.predicted_score) === normalizeScore(p.actual_score)).length}
              total={scored.filter(p => p.predicted_score).length}
              color="var(--purple)"
            />
          </div>

          {/* Best predictions */}
          {bestPredictions.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
                Best Predictions
              </div>
              {bestPredictions.map((p, i) => (
                <div key={p.id} className="fade-in" style={{
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                  padding: 12, marginBottom: 6, display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', animationDelay: `${i * 0.1}s`,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {p.player1_name} vs {p.player2_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {p.tournament_name} · {p.round_name}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>
                    +{p.points_earned}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent form */}
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              Recent Form
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {sortedScored.slice(0, 20).map((p, i) => {
                const won = p.points_earned > 0;
                return (
                  <div key={p.id} title={`${p.player1_name} vs ${p.player2_name}: ${won ? 'Correct' : 'Wrong'}`} style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: won ? 'var(--accent-glow)' : 'var(--red-glow)',
                    border: `1px solid ${won ? 'var(--accent)' : 'var(--red)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: won ? 'var(--accent)' : 'var(--red)',
                  }}>
                    {won ? '✓' : '✗'}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '14px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function AccuracyBar({ label, correct, total, color }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color }}>{correct}/{total} ({pct}%)</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

function LoadingPlaceholder() {
  return (
    <div style={{ padding: '40px 0' }}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{ background: 'var(--card)', borderRadius: 14, height: 70, marginBottom: 10, opacity: 0.3 }} />
      ))}
    </div>
  );
}

function normalizeScore(score) {
  if (!score) return '';
  return score.replace(/,/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
