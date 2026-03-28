import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import BackButton from '../components/BackButton';
import Tag from '../components/Tag';
import Countdown from '../components/Countdown';
import BracketView from '../components/BracketView';

export default function TournamentDetail({ showToast }) {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tournament, setTournament] = useState(null);
  const [predictions, setPredictions] = useState({});
  const [activeEvent, setActiveEvent] = useState(0);
  const [activeRound, setActiveRound] = useState(0);
  const [viewMode, setViewMode] = useState('list');
  const [loading, setLoading] = useState(true);

  // Re-fetch whenever we navigate to this page (location.key changes on every navigation)
  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getTournament(id),
      api.getTournamentPredictions(user.id, id),
    ]).then(([t, preds]) => {
      setTournament(t);
      const predMap = {};
      preds.forEach(p => { predMap[p.match_id] = p; });
      setPredictions(predMap);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id, user.id, location.key]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading draw...</div>;
  if (!tournament) return <div>Tournament not found</div>;

  const events = tournament.events || [];
  const currentEvent = events[activeEvent];
  const rounds = currentEvent?.rounds || [];
  const currentRound = rounds[activeRound];
  const matches = currentRound?.matches || [];

  const deadlinePassed = currentRound && currentRound.prediction_deadline && new Date() > new Date(currentRound.prediction_deadline);

  // Calculate prediction progress across all rounds
  const allMatches = rounds.flatMap(r => r.matches);
  const predictableMatches = allMatches.filter(m => m.player1_name !== 'TBD' && m.player2_name !== 'TBD');
  const predictedCount = predictableMatches.filter(m => predictions[m.id]).length;
  const progressPct = predictableMatches.length > 0 ? Math.round((predictedCount / predictableMatches.length) * 100) : 0;

  return (
    <div>
      <BackButton to="/" label="Tournaments" />

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{tournament.name}</h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tournament.club} · {tournament.dates}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Tag text={tournament.surface} color="var(--blue)" />
          <Tag text={tournament.province} color="var(--purple)" />
        </div>
      </div>

      {/* Prediction progress */}
      {predictableMatches.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {predictedCount === predictableMatches.length ? '✅ All predictions made!' : `${predictedCount}/${predictableMatches.length} matches predicted`}
            </span>
            <span style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, color: progressPct === 100 ? 'var(--accent)' : 'var(--orange)' }}>
              {progressPct}%
            </span>
          </div>
          <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, transition: 'width 0.5s ease',
              width: `${progressPct}%`,
              background: progressPct === 100 ? 'var(--accent)' : 'linear-gradient(90deg, var(--orange), var(--accent))',
            }} />
          </div>
        </div>
      )}

      {/* Event tabs */}
      {events.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
          {events.map((e, i) => (
            <button key={e.id} onClick={() => { setActiveEvent(i); setActiveRound(0); }} style={{
              padding: '7px 14px', borderRadius: 10,
              border: `1px solid ${activeEvent === i ? 'var(--accent)' : 'var(--border)'}`,
              background: activeEvent === i ? 'var(--accent-glow)' : 'transparent',
              color: activeEvent === i ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              {e.code}
            </button>
          ))}
        </div>
      )}

      {/* Round tabs */}
      {rounds.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
            {rounds.map((r, i) => (
              <button key={r.id} onClick={() => setActiveRound(i)} style={{
                padding: '7px 14px', borderRadius: 10,
                border: `1px solid ${activeRound === i ? 'var(--accent)' : 'var(--border)'}`,
                background: activeRound === i ? 'var(--accent-glow)' : 'transparent',
                color: activeRound === i ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
                {r.name}
              </button>
            ))}
          </div>

          {/* Deadline countdown */}
          {currentRound && currentRound.prediction_deadline && !deadlinePassed && (
            <Countdown deadline={currentRound.prediction_deadline} />
          )}
          {currentRound && deadlinePassed && (
            <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              🔒 Predictions locked for this round
            </div>
          )}

          {/* View toggle */}
          {rounds.length > 1 && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--card)', borderRadius: 8, padding: 3, width: 'fit-content' }}>
              {[{ id: 'list', label: '📋 List' }, { id: 'bracket', label: '🏆 Bracket' }].map(v => (
                <button key={v.id} onClick={() => setViewMode(v.id)} style={{
                  padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: viewMode === v.id ? 'var(--accent-glow)' : 'transparent',
                  color: viewMode === v.id ? 'var(--accent)' : 'var(--text-dim)',
                  fontSize: 11, fontWeight: 600,
                }}>
                  {v.label}
                </button>
              ))}
            </div>
          )}

          {/* Bracket View */}
          {viewMode === 'bracket' && rounds.length > 1 ? (
            <BracketView
              rounds={rounds}
              predictions={predictions}
              onSelectMatch={(match) => {
                const isPlayable = match.status === 'upcoming' && match.player1_name !== 'TBD' && !deadlinePassed;
                if (isPlayable) navigate(`/predict/${id}/${match.id}`);
              }}
            />
          ) : (
          <>
          {/* List View — Matches */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matches.map((match, i) => {
              const pred = predictions[match.id];
              const isLocked = match.status !== 'upcoming' || deadlinePassed;
              const isCompleted = match.status === 'completed';

              return (
                <button
                  key={match.id}
                  onClick={() => !isLocked && navigate(`/predict/${id}/${match.id}`)}
                  disabled={isLocked && !isCompleted}
                  style={{
                    background: 'var(--card)', border: `1px solid ${pred ? 'rgba(0,232,123,0.2)' : 'var(--border)'}`,
                    borderRadius: 14, padding: 14, cursor: isLocked ? 'default' : 'pointer',
                    width: '100%', textAlign: 'left', color: 'var(--text)',
                    opacity: isLocked && !isCompleted && !pred ? 0.5 : 1,
                    transition: 'all 0.2s', animation: `fadeIn 0.3s ease ${i * 0.04}s both`,
                    position: 'relative', overflow: 'hidden',
                  }}
                >
                  {pred && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, var(--accent), transparent)` }} />}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <PlayerLine name={match.player1_name} seed={match.player1_seed} isWinner={isCompleted && match.winner_name === match.player1_name} isPick={pred?.predicted_winner === match.player1_name} />
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', margin: '3px 0', letterSpacing: 1 }}>VS</div>
                      <PlayerLine name={match.player2_name} seed={match.player2_seed} isWinner={isCompleted && match.winner_name === match.player2_name} isPick={pred?.predicted_winner === match.player2_name} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 70 }}>
                      {isCompleted ? (
                        <>
                          <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>{match.score}</div>
                          {pred && (
                            <div style={{
                              padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)',
                              background: pred.points_earned > 0 ? 'var(--accent-glow)' : 'var(--red-glow)',
                              color: pred.points_earned > 0 ? 'var(--accent)' : 'var(--red)',
                            }}>
                              {pred.points_earned > 0 ? `+${pred.points_earned}` : '0'} pts
                            </div>
                          )}
                        </>
                      ) : pred ? (
                        <div style={{ background: 'var(--accent-glow)', borderRadius: 8, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>✓ Called</span>
                        </div>
                      ) : !isLocked ? (
                        <div style={{ background: 'var(--orange-glow)', borderRadius: 8, padding: '4px 10px' }}>
                          <span style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 600 }}>Predict</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>🔒</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {matches.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 14 }}>No matches in this round yet</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Admin will add matches when the draw is published</div>
            </div>
          )}
          </>
          )}
        </>
      )}

      {events.length === 0 && (
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14 }}>Draw not yet released</div>
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-dim)' }}>Check back closer to the tournament</div>
        </div>
      )}
    </div>
  );
}

function PlayerLine({ name, seed, isWinner, isPick }) {
  const highlight = isWinner || isPick;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {isPick && <span style={{ fontSize: 10 }}>⭐</span>}
      {isWinner && <span style={{ fontSize: 10 }}>✅</span>}
      <span style={{ fontSize: 14, fontWeight: highlight ? 700 : 500, color: isWinner ? 'var(--accent)' : isPick ? 'var(--blue)' : 'var(--text)' }}>
        {name}
      </span>
      {seed && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--orange)', fontFamily: 'var(--mono)' }}>[{seed}]</span>}
    </div>
  );
}
