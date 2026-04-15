import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import BackButton from '../components/BackButton';
import Tag from '../components/Tag';

const SCORING = { correctWinner: 10, correctSets: 5, correctScore: 15, upsetBonus: 8, perfectMatch: 10 };

export default function PredictionForm({ showToast }) {
  const { tournamentId, matchId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [winner, setWinner] = useState(null);
  const [sets, setSets] = useState(2);
  const [scores, setScores] = useState([['', ''], ['', ''], ['', '']]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isEdit, setIsEdit] = useState(false);

  useEffect(() => {
    api.getTournament(tournamentId).then(t => {
      for (const ev of t.events) {
        for (const rd of ev.rounds) {
          const m = rd.matches.find(m => m.id === matchId);
          if (m) { setMatch(m); break; }
        }
      }
    }).catch(console.error).finally(() => setLoading(false));

    // Load existing prediction
    api.getTournamentPredictions(user.id, tournamentId).then(preds => {
      const existing = preds.find(p => p.match_id === matchId);
      if (existing) {
        setIsEdit(true);
        setWinner(existing.predicted_winner);
        setSets(existing.predicted_sets || 2);
        if (existing.predicted_score) {
          const parts = existing.predicted_score.trim().split(/\s+/);
          const newScores = [['', ''], ['', ''], ['', '']];
          parts.forEach((setScore, i) => {
            if (i < 3) {
              // Strip tiebreak parens before splitting: "7-6(5)" -> "7-6"
              const clean = setScore.replace(/\(\d+\)/g, '');
              const halves = clean.split('-');
              if (halves.length === 2) {
                newScores[i] = [halves[0], halves[1]];
              }
            }
          });
          setScores(newScores);
        }
      }
    }).catch(console.error);
  }, [tournamentId, matchId, user.id]);

  const scoreString = useMemo(() => {
    const parts = [];
    for (let i = 0; i < sets; i++) {
      if (scores[i][0] !== '' && scores[i][1] !== '') {
        parts.push(`${scores[i][0]}-${scores[i][1]}`);
      }
    }
    return parts.join(' ');
  }, [scores, sets]);

  const isUpset = match && (
    (winner === match.player2_name && match.player1_seed && (!match.player2_seed || match.player2_seed > match.player1_seed)) ||
    (winner === match.player1_name && match.player2_seed && (!match.player1_seed || match.player1_seed > match.player2_seed))
  );

  const maxPoints = SCORING.correctWinner + SCORING.correctSets + (scoreString ? SCORING.correctScore + SCORING.perfectMatch : 0) + (isUpset ? SCORING.upsetBonus : 0);

  const handleSave = async () => {
    if (!winner) return;

    // Validate scores if entered
    if (scoreString) {
      const setScores = scoreString.trim().split(/\s+/);
      for (const s of setScores) {
        // Strip tiebreak marker e.g. 7-6(5) → 7-6
        const clean = s.replace(/\(\d+\)$/, '');
        const parts = clean.split('-');
        if (parts.length !== 2) {
          showToast('Invalid score format — use e.g. 6-3 6-4 or 7-6(5) 6-3');
          setShowConfirm(false);
          return;
        }
        const [a, b] = parts.map(Number);
        if (isNaN(a) || isNaN(b) || a < 0 || b < 0 || a > 7 || b > 7) {
          showToast('Invalid score — games must be 0-7');
          setShowConfirm(false);
          return;
        }
        // At least one player must have 6+ games, and scores like 7-7 are impossible
        const maxGames = Math.max(a, b);
        const minGames = Math.min(a, b);
        if (maxGames < 6) {
          showToast('Invalid score — winner needs at least 6 games per set');
          setShowConfirm(false);
          return;
        }
        if (a === 7 && b === 7) {
          showToast('Invalid score — 7-7 is not a valid set score');
          setShowConfirm(false);
          return;
        }
        // If winner has exactly 6, loser must have 4 or fewer (not 5, 6)
        // Exception: 7-5, 7-6 are valid
        if (maxGames === 6 && minGames > 4) {
          showToast('Invalid score — if winner has 6, loser must have 4 or fewer (use 7-5 or 7-6 otherwise)');
          setShowConfirm(false);
          return;
        }
      }
    }

    setSaving(true);
    try {
      await api.submitPrediction({
        user_id: user.id,
        match_id: matchId,
        predicted_winner: winner,
        predicted_sets: sets,
        predicted_score: scoreString || null,
      });
      showToast(isEdit ? 'Prediction updated! 🎾' : 'Prediction locked in! 🎾');
      setShowConfirm(false);
      navigate(`/tournament/${tournamentId}`);
    } catch (err) {
      setShowConfirm(false);
      showToast('Error: ' + err.message);
    }
    setSaving(false);
  };

  const updateScore = (setIdx, playerIdx, val) => {
    const newScores = scores.map(s => [...s]);
    newScores[setIdx][playerIdx] = val;
    setScores(newScores);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading...</div>;
  if (!match) return <div>Match not found</div>;

  if (match.player1_name === 'TBD' || match.player2_name === 'TBD') {
    return (
      <div>
        <BackButton to={`/tournament/${tournamentId}`} label="Back to draw" />
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 50, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Match not ready yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
            Both players need to be confirmed before you can predict.
          </div>
        </div>
      </div>
    );
  }

  if (match.status !== 'upcoming') {
    return (
      <div>
        <BackButton to={`/tournament/${tournamentId}`} label="Back to draw" />
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 50, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Match already {match.status}</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
            Predictions are no longer accepted for this match.
          </div>
        </div>
      </div>
    );
  }

  const inputStyle = {
    width: 48, height: 48, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)',
    color: 'var(--text)', fontSize: 18, fontWeight: 700, textAlign: 'center', fontFamily: 'var(--mono)', outline: 'none',
  };

  return (
    <div>
      <BackButton to={`/tournament/${tournamentId}`} label="Back to draw" />
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 8px' }}>Make Your Call</h2>

      {match.scheduled_time && (() => {
        const d = new Date(match.scheduled_time);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
            🕐 {days[d.getDay()]} {d.getDate()} {months[d.getMonth()]} · {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
          </div>
        );
      })()}

      {/* Winner */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'block' }}>
          Who wins? <span style={{ color: 'var(--accent)' }}>+{SCORING.correctWinner} pts</span>
        </label>
        {[{ name: match.player1_name, seed: match.player1_seed }, { name: match.player2_name, seed: match.player2_seed }].map(p => {
          const selected = winner === p.name;
          return (
            <button key={p.name} onClick={() => setWinner(p.name)} style={{
              width: '100%', padding: 16, marginBottom: 8, borderRadius: 14, cursor: 'pointer',
              background: selected ? 'var(--accent-glow)' : 'var(--card)',
              border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
              color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'all 0.2s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 24, height: 24, borderRadius: 12, border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {selected && <div style={{ width: 12, height: 12, borderRadius: 6, background: 'var(--accent)' }} />}
                </div>
                <span style={{ fontSize: 15, fontWeight: selected ? 700 : 500 }}>{p.name}</span>
                {p.seed && <span style={{ fontSize: 11, color: 'var(--orange)', fontFamily: 'var(--mono)', fontWeight: 700 }}>[{p.seed}]</span>}
              </div>
              {selected && isUpset && <Tag text="UPSET!" color="var(--red)" />}
            </button>
          );
        })}
        {isUpset && <div style={{ fontSize: 12, color: 'var(--orange)', marginTop: 4 }}>🔥 Upset bonus: +{SCORING.upsetBonus} pts if correct</div>}
      </div>

      {/* Sets */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'block' }}>
          Sets <span style={{ color: 'var(--accent)' }}>+{SCORING.correctSets} pts</span>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {[2, 3].map(n => (
            <button key={n} onClick={() => setSets(n)} style={{
              flex: 1, padding: '12px 0', borderRadius: 12, cursor: 'pointer',
              background: sets === n ? 'var(--accent-glow)' : 'var(--card)',
              border: `2px solid ${sets === n ? 'var(--accent)' : 'var(--border)'}`,
              color: sets === n ? 'var(--accent)' : 'var(--text-muted)', fontSize: 14, fontWeight: 700, fontFamily: 'var(--mono)',
            }}>
              {n === 2 ? 'Straight Sets' : '3 Sets'}
            </button>
          ))}
        </div>
      </div>

      {/* Score */}
      <div style={{ marginBottom: 28 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'block' }}>
          Score (optional) <span style={{ color: 'var(--accent)' }}>+{SCORING.correctScore} pts</span>
        </label>
        <div style={{ background: 'var(--card)', borderRadius: 14, padding: 16, border: '1px solid var(--border)' }}>
          {[match.player1_name, match.player2_name].map((pName, pIdx) => (
            <div key={pName} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: pIdx === 0 ? 8 : 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, width: 85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pName.split(' ').pop()}
              </span>
              {Array.from({ length: sets }).map((_, sIdx) => (
                <span key={sIdx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {sIdx > 0 && <span style={{ color: 'var(--text-dim)', width: 8 }}>–</span>}
                  <input
                    type="number" min="0" max="7" inputMode="numeric"
                    value={scores[sIdx][pIdx]}
                    onChange={e => updateScore(sIdx, pIdx, e.target.value)}
                    style={inputStyle} placeholder="-"
                  />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      {winner && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Your prediction</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{winner} wins</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>in {sets} sets {scoreString && `· ${scoreString}`}</div>
          <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 6, fontFamily: 'var(--mono)' }}>Max pts: {maxPoints}</div>
        </div>
      )}

      <button onClick={() => setShowConfirm(true)} disabled={!winner || saving} style={{
        width: '100%', padding: 16, borderRadius: 14, border: 'none', cursor: winner ? 'pointer' : 'default',
        background: winner ? 'linear-gradient(135deg, var(--accent), var(--accent-dim))' : 'var(--border)',
        color: winner ? 'var(--bg)' : 'var(--text-dim)', fontSize: 15, fontWeight: 700,
        boxShadow: winner ? '0 4px 20px var(--accent-glow)' : 'none', opacity: saving ? 0.6 : 1,
      }}>
        {saving ? 'Saving...' : isEdit ? 'Update Prediction 🎾' : 'Lock It In 🎾'}
      </button>

      {/* Confirmation overlay */}
      {showConfirm && (
        <div onClick={() => setShowConfirm(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20,
            padding: 24, width: '100%', maxWidth: 340, animation: 'fadeIn 0.2s ease',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🎾</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{isEdit ? 'Update Your Call' : 'Confirm Your Call'}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{winner}</span> to win
                {scoreString ? ` ${scoreString}` : ` in ${sets} sets`}
              </div>
              {isUpset && <div style={{ fontSize: 12, color: 'var(--orange)', marginTop: 4 }}>🔥 Upset call!</div>}
            </div>

            <button onClick={handleSave} disabled={saving} style={{
              width: '100%', padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
              color: 'var(--bg)', fontSize: 15, fontWeight: 700, marginBottom: 8,
              opacity: saving ? 0.6 : 1,
            }}>
              {saving ? 'Locking in...' : isEdit ? '✅ Update Prediction' : '✅ Confirm & Lock In'}
            </button>

            <button onClick={() => setShowConfirm(false)} style={{
              width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer',
            }}>
              Go Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
