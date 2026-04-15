import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import BackButton from '../components/BackButton';
import Tag from '../components/Tag';
import Countdown from '../components/Countdown';
import BracketView from '../components/BracketView';

export default function TournamentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tournament, setTournament] = useState(null);
  const [predictions, setPredictions] = useState({});
  const [activeEvent, setActiveEvent] = useState(0);
  const [activeRound, setActiveRound] = useState(0);
  const [viewMode, setViewMode] = useState('list');
  const [drawPickerOpen, setDrawPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Re-fetch whenever we navigate to this page (location.key changes on every navigation)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getTournament(id),
      api.getTournamentPredictions(user.id, id),
    ]).then(([t, preds]) => {
      if (cancelled) return;
      setTournament(t);
      const predMap = {};
      preds.forEach(p => { predMap[p.match_id] = p; });
      setPredictions(predMap);
    }).catch(err => { if (!cancelled) console.error(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, user.id, location.key]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading draw...</div>;
  if (!tournament) return <div>Tournament not found</div>;

  const events = tournament.events || [];
  const currentEvent = events[activeEvent];
  const rounds = currentEvent?.rounds || [];
  const currentRound = rounds[activeRound];
  const matches = currentRound?.matches || [];

  // No deadline = open forever; deadline set and in past = locked
  const deadlinePassed = !!(currentRound?.prediction_deadline && new Date() > new Date(currentRound.prediction_deadline));

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

      {/* Draw picker — tap to open sheet showing all draws */}
      {events.length > 1 && (
        <>
          <button
            onClick={() => setDrawPickerOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '10px 14px', borderRadius: 12, marginBottom: 12,
              border: '1px solid var(--accent)', background: 'var(--accent-glow)',
              color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span>🎾 {currentEvent?.code || currentEvent?.name || 'Select Draw'}</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>{activeEvent + 1} / {events.length} ▾</span>
          </button>

          {/* Full-screen draw picker sheet */}
          {drawPickerOpen && (
            <div
              onClick={() => setDrawPickerOpen(false)}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                zIndex: 1000, display: 'flex', alignItems: 'flex-end',
              }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  background: 'var(--card)', borderRadius: '20px 20px 0 0',
                  padding: '8px 0 32px', width: '100%',
                  maxHeight: '75vh', overflowY: 'auto',
                  border: '1px solid var(--border)',
                }}
              >
                {/* Handle bar */}
                <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '8px auto 16px' }} />
                <div style={{ padding: '0 16px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Select Draw
                </div>
                {events.map((e, i) => (
                  <button
                    key={e.id}
                    onClick={() => { setActiveEvent(i); setActiveRound(0); setDrawPickerOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '14px 16px',
                      background: i === activeEvent ? 'var(--accent-glow)' : 'transparent',
                      border: 'none', borderBottom: '1px solid var(--border)',
                      color: i === activeEvent ? 'var(--accent)' : 'var(--text)',
                      fontSize: 14, fontWeight: i === activeEvent ? 600 : 400,
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span>{e.code || e.name}</span>
                    {i === activeEvent && <span style={{ fontSize: 16 }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
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
              const p1Won = isCompleted && match.winner_name === match.player1_name;
              const p2Won = isCompleted && match.winner_name === match.player2_name;
              const predCorrect = isCompleted && pred && pred.points_earned > 0;
              const predWrong = isCompleted && pred && pred.points_earned === 0;

              // Border: result outcome > prediction state > open/locked
              const borderColor = isCompleted
                ? predCorrect ? 'rgba(0,232,123,0.45)'
                  : predWrong ? 'rgba(255,71,87,0.35)'
                  : 'var(--border)'
                : pred ? 'rgba(0,232,123,0.2)'
                : !isLocked ? 'rgba(255,159,28,0.2)'
                : 'var(--border)';

              // Top accent stripe color
              const stripeColor = isCompleted
                ? predCorrect ? 'var(--accent)' : predWrong ? 'var(--red)' : null
                : pred ? 'var(--accent)' : null;

              // Scheduled time formatting
              let scheduleLabel = null;
              if (!isCompleted && match.scheduled_time) {
                const d = new Date(match.scheduled_time);
                const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                scheduleLabel = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              }

              return (
                <button
                  key={match.id}
                  onClick={() => !isLocked && navigate(`/predict/${id}/${match.id}`)}
                  disabled={isLocked && !isCompleted}
                  style={{
                    background: 'var(--card)', border: `1px solid ${borderColor}`,
                    borderRadius: 14, padding: 14, cursor: isLocked ? 'default' : 'pointer',
                    width: '100%', textAlign: 'left', color: 'var(--text)',
                    opacity: isLocked && !isCompleted && !pred ? 0.5 : 1,
                    transition: 'border-color 0.2s', animation: `fadeIn 0.3s ease ${i * 0.04}s both`,
                    position: 'relative', overflow: 'hidden',
                  }}
                >
                  {stripeColor && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${stripeColor}, transparent)` }} />}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <PlayerLine name={match.player1_name} seed={match.player1_seed} isWinner={p1Won} isLoser={isCompleted && !p1Won} isPick={pred?.predicted_winner === match.player1_name} />
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', margin: '3px 0', letterSpacing: 1 }}>VS</div>
                      <PlayerLine name={match.player2_name} seed={match.player2_seed} isWinner={p2Won} isLoser={isCompleted && !p2Won} isPick={pred?.predicted_winner === match.player2_name} />
                      {scheduleLabel && (
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>🕐</span>{scheduleLabel}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 70, paddingLeft: 8 }}>
                      {isCompleted ? (
                        <>
                          {match.score && (
                            <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-muted)', textAlign: 'right' }}>{match.score}</div>
                          )}
                          {pred ? (
                            <div style={{
                              padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)',
                              background: predCorrect ? 'var(--accent-glow)' : 'var(--red-glow)',
                              color: predCorrect ? 'var(--accent)' : 'var(--red)',
                            }}>
                              {predCorrect ? `+${pred.points_earned}` : '0'} pts
                            </div>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>No pick</span>
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

PlayerLine.propTypes = {
  name: PropTypes.string.isRequired,
  seed: PropTypes.number,
  isWinner: PropTypes.bool,
  isLoser: PropTypes.bool,
  isPick: PropTypes.bool,
};

function PlayerLine({ name, seed, isWinner, isLoser, isPick }) {
  const color = isWinner ? 'var(--accent)' : isLoser ? 'var(--text-dim)' : isPick ? 'var(--blue)' : 'var(--text)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isLoser ? 0.55 : 1 }}>
      {isWinner && <span style={{ fontSize: 10 }}>✅</span>}
      {!isWinner && isPick && <span style={{ fontSize: 10 }}>⭐</span>}
      <span style={{ fontSize: 14, fontWeight: isWinner ? 700 : 500, color }}>
        {name}
      </span>
      {seed && <span style={{ fontSize: 10, fontWeight: 700, color: isLoser ? 'var(--text-dim)' : 'var(--orange)', fontFamily: 'var(--mono)', opacity: isLoser ? 0.55 : 1 }}>[{seed}]</span>}
    </div>
  );
}
