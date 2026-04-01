import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import Tag from '../components/Tag';

export default function Predictions() {
  const { user } = useAuth();
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUserPredictions(user.id).then(setPredictions).catch(console.error).finally(() => setLoading(false));
  }, [user.id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading...</div>;

  const totalPoints = predictions.filter(p => p.is_scored).reduce((a, p) => a + (p.points_earned || 0), 0);
  const scored = predictions.filter(p => p.is_scored);
  const pending = predictions.filter(p => !p.is_scored);

  if (predictions.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 50, marginBottom: 16 }}>🎯</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>No predictions yet</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>Head to Tournaments and start making your calls!</div>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 14 }}>Your Predictions</h2>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {[{ label: 'Total Pts', value: totalPoints, color: 'var(--accent)' }, { label: 'Scored', value: scored.length, color: 'var(--blue)' }, { label: 'Pending', value: pending.length, color: 'var(--orange)' }].map(s => (
          <div key={s.label} style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: 'var(--mono)' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {predictions.map((p, i) => (
          <div key={p.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, animation: `fadeIn 0.3s ease ${i * 0.04}s both` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.tournament_name || 'Unknown'} · {p.round_name}</span>
              {p.is_scored ? (
                <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)', background: p.points_earned > 0 ? 'var(--accent-glow)' : 'var(--red-glow)', color: p.points_earned > 0 ? 'var(--accent)' : 'var(--red)' }}>
                  {p.points_earned > 0 ? `+${p.points_earned}` : '0'} pts
                </span>
              ) : <Tag text="Pending" color="var(--orange)" />}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              <span style={{ color: p.predicted_winner === p.player1_name ? 'var(--accent)' : 'var(--text)' }}>{p.player1_name}</span>
              <span style={{ color: 'var(--text-dim)', margin: '0 6px', fontSize: 11 }}>vs</span>
              <span style={{ color: p.predicted_winner === p.player2_name ? 'var(--accent)' : 'var(--text)' }}>{p.player2_name}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Called: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{p.predicted_winner}</span>
              {p.predicted_sets && ` in ${p.predicted_sets} sets`}
              {p.predicted_score && ` · ${p.predicted_score}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
