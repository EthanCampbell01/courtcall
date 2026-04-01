import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import BackButton from '../components/BackButton';
import ReactionBar from '../components/ReactionBar';

export default function LeagueDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [league, setLeague] = useState(null);
  const [activity, setActivity] = useState([]);
  const [reactions, setReactions] = useState({});
  const [h2h, setH2h] = useState(null);
  const [h2hTarget, setH2hTarget] = useState(null);
  const [tab, setTab] = useState('leaderboard');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getLeague(id),
      fetch(`/api/leagues/${id}/activity`).then(r => r.json()),
    ]).then(([lg, act]) => {
      setLeague(lg);
      setActivity(act);
      // Load reactions for all activity predictions
      if (act.length > 0) {
        const predIds = act.map(a => a.id).filter(Boolean).join(',');
        if (predIds) {
          fetch(`/api/reactions/${predIds}`).then(r => r.json()).then(setReactions).catch(() => {});
        }
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const handleReact = async (predictionId, emoji) => {
    // Optimistic update
    const prev = reactions;
    setReactions(cur => {
      const updated = { ...cur };
      const existing = (updated[predictionId] || []).filter(r => r.user_id !== user.id);
      updated[predictionId] = [...existing, { user_id: user.id, emoji, display_name: user.display_name }];
      return updated;
    });
    try {
      await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: predictionId, user_id: user.id, emoji }),
      });
    } catch (e) {
      console.error(e);
      setReactions(prev); // revert on failure
    }
  };

  const handleRemoveReaction = async (predictionId) => {
    // Optimistic update
    const prev = reactions;
    setReactions(cur => {
      const updated = { ...cur };
      updated[predictionId] = (updated[predictionId] || []).filter(r => r.user_id !== user.id);
      return updated;
    });
    try {
      await fetch('/api/reactions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: predictionId, user_id: user.id }),
      });
    } catch (e) {
      console.error(e);
      setReactions(prev); // revert on failure
    }
  };

  // Load h2h when target selected
  useEffect(() => {
    if (!h2hTarget) { setH2h(null); return; }
    const tournamentParam = league?.tournament_id ? `?tournament=${league.tournament_id}` : '';
    fetch(`/api/h2h/${user.id}/${h2hTarget}${tournamentParam}`)
      .then(r => r.json())
      .then(setH2h)
      .catch(console.error);
  }, [h2hTarget, user.id, league?.tournament_id]);

  if (loading || !league) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>;

  const pot = league.buy_in * (league.members?.length || 0);
  const medals = ['🥇', '🥈', '🥉'];

  const tabStyle = (active) => ({
    padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent-glow)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-dim)',
    fontSize: 12, fontWeight: 600,
  });

  return (
    <div>
      <BackButton to="/leagues" label="Leagues" />

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{league.name}</h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {league.tournament_name || 'All tournaments'} · £{league.buy_in} buy-in · Pot: £{pot}
        </div>
      </div>

      {/* Invite code + share */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invite Code</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', letterSpacing: '3px', color: 'var(--accent)', marginTop: 4 }}>
              {league.invite_code}
            </div>
          </div>
          <button
            onClick={() => { navigator.clipboard?.writeText(league.invite_code); }}
            style={{
              background: 'var(--accent-glow)', border: 'none', borderRadius: 10, padding: '8px 12px',
              cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontWeight: 600,
            }}
          >
            📋 Copy
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              const msg = `🎾 Join my CourtCall league "${league.name}"!\n\nCode: ${league.invite_code}\nBuy-in: £${league.buy_in}\n\nDownload the app and enter the code to join.`;
              window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
            }}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: '#25D366', color: '#fff', fontSize: 13, fontWeight: 600,
            }}
          >
            📱 Share via WhatsApp
          </button>
          <button
            onClick={() => {
              const msg = `🎾 Join my CourtCall league "${league.name}"! Code: ${league.invite_code} (£${league.buy_in} buy-in)`;
              if (navigator.share) {
                navigator.share({ title: 'Join CourtCall', text: msg });
              } else {
                navigator.clipboard?.writeText(msg);
              }
            }}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--border)',
              background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
            }}
          >
            🔗 Share Link
          </button>
        </div>
      </div>

      {/* Prize pot */}
      {pot > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Prize Pot</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--orange)', marginTop: 2 }}>
                £{pot}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              🥇 £{Math.round(pot * 0.6)} (60%)<br />
              🥈 £{Math.round(pot * 0.3)} (30%)<br />
              🥉 £{Math.round(pot * 0.1)} (10%)
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {[
          { id: 'leaderboard', label: '🏆 Board' },
          { id: 'activity', label: '📢 Activity' },
          { id: 'h2h', label: '⚔️ Head-to-Head' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabStyle(tab === t.id)}>{t.label}</button>
        ))}
      </div>

      {/* Leaderboard */}
      {tab === 'leaderboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(league.members || []).map((m, i) => {
            const isYou = m.id === user.id;
            return (
              <div key={m.id} className="fade-in" style={{
                background: isYou ? 'var(--accent-glow)' : 'var(--card)',
                borderRadius: 14, padding: '12px 16px',
                border: `1px solid ${i === 0 && m.total_points > 0 ? 'rgba(0,232,123,0.25)' : isYou ? 'rgba(0,232,123,0.15)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                animationDelay: `${i * 0.05}s`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 20, width: 30, textAlign: 'center' }}>
                    {i < 3 ? medals[i] : <span style={{ fontSize: 14, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>{i + 1}</span>}
                  </span>
                  <span style={{ fontSize: 22 }}>{m.avatar}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {m.display_name} {isYou && <span style={{ fontSize: 10, color: 'var(--accent)' }}>(you)</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{m.predictions_made} predictions</div>
                  </div>
                </div>
                <div style={{
                  fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18,
                  color: m.total_points > 0 ? 'var(--accent)' : 'var(--text-dim)',
                }}>
                  {m.total_points}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Activity Feed */}
      {tab === 'activity' && (
        <div>
          {activity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📢</div>
              <div style={{ fontSize: 14 }}>No activity yet</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activity.map((a, i) => {
                const isYou = a.user_id === user.id;
                const won = a.is_scored && a.points_earned > 0;
                return (
                  <div key={a.id} className="fade-in" style={{
                    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                    padding: 12, animationDelay: `${i * 0.03}s`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 16 }}>{a.avatar}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: isYou ? 'var(--accent)' : 'var(--text)' }}>
                        {isYou ? 'You' : a.display_name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>predicted</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 24 }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{a.predicted_winner}</span>
                      {' '}to beat{' '}
                      {a.predicted_winner === a.player1_name ? a.player2_name : a.player1_name}
                      <span style={{ color: 'var(--text-dim)' }}> · {a.event_code} {a.round_name}</span>
                    </div>
                    {a.is_scored && (
                      <div style={{
                        fontSize: 11, marginTop: 4, marginLeft: 24, fontFamily: 'var(--mono)',
                        color: won ? 'var(--accent)' : 'var(--red)',
                      }}>
                        {won ? `✅ +${a.points_earned} pts` : '❌ Wrong'}
                      </div>
                    )}
                    <div style={{ marginLeft: 24 }}>
                      <ReactionBar
                        predictionId={a.id}
                        reactions={reactions[a.id] || []}
                        currentUserId={user.id}
                        onReact={handleReact}
                        onRemove={handleRemoveReaction}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Head-to-Head */}
      {tab === 'h2h' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Compare your predictions with:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(league.members || []).filter(m => m.id !== user.id).map(m => (
                <button key={m.id} onClick={() => setH2hTarget(m.id)} style={{
                  padding: '8px 14px', borderRadius: 10, cursor: 'pointer', border: 'none',
                  background: h2hTarget === m.id ? 'var(--accent-glow)' : 'var(--card)',
                  color: h2hTarget === m.id ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span>{m.avatar}</span> {m.display_name}
                </button>
              ))}
            </div>
          </div>

          {h2h && (
            <div>
              {/* Score summary */}
              <div style={{
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
                padding: 20, marginBottom: 16, textAlign: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 16 }}>{h2h.user1.avatar}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>You</div>
                    <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--accent)', marginTop: 4 }}>
                      {h2h.user1.totalPoints}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h2h.user1.matchesWon} wins</div>
                  </div>

                  <div style={{ fontSize: 20, color: 'var(--text-dim)', fontWeight: 700 }}>VS</div>

                  <div>
                    <div style={{ fontSize: 16 }}>{h2h.user2.avatar}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{h2h.user2.display_name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--blue)', marginTop: 4 }}>
                      {h2h.user2.totalPoints}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h2h.user2.matchesWon} wins</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>
                  {h2h.totalMatches} matches compared · {h2h.draws} draws
                </div>
              </div>

              {/* Match-by-match */}
              {h2h.matches.filter(m => m.match_status === 'completed').length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Match by Match</div>
                  {h2h.matches.filter(m => m.match_status === 'completed').map((m, i) => {
                    const u1Won = (m.user1_points || 0) > (m.user2_points || 0);
                    const u2Won = (m.user2_points || 0) > (m.user1_points || 0);
                    return (
                      <div key={m.match_id} className="fade-in" style={{
                        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
                        padding: 10, marginBottom: 4, fontSize: 12, animationDelay: `${i * 0.03}s`,
                      }}>
                        <div style={{ color: 'var(--text-dim)', fontSize: 10, marginBottom: 4 }}>
                          {m.event_code} {m.round_name} · {m.player1_name} vs {m.player2_name}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: u1Won ? 'var(--accent)' : 'var(--text-muted)', fontWeight: u1Won ? 700 : 400 }}>
                            You: {m.user1_pick?.split(' ').pop()} ({m.user1_points || 0}pts)
                          </span>
                          <span style={{ color: u2Won ? 'var(--blue)' : 'var(--text-muted)', fontWeight: u2Won ? 700 : 400 }}>
                            {h2h.user2.display_name}: {m.user2_pick?.split(' ').pop()} ({m.user2_points || 0}pts)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {h2h.totalMatches === 0 && (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-dim)', fontSize: 13 }}>
                  No shared predictions yet — you both need to predict the same matches.
                </div>
              )}
            </div>
          )}

          {!h2hTarget && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-dim)', fontSize: 13 }}>
              Select a league member above to compare predictions.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
