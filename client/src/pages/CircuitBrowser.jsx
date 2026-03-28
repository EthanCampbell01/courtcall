import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';

export default function CircuitBrowser() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [circuits, setCircuits] = useState([]);
  const [myCircuits, setMyCircuits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.getCircuits(),
      api.getUserCircuits(user.id),
    ]).then(([all, mine]) => {
      setCircuits(all);
      setMyCircuits(mine.map(c => c.id));
    }).catch(console.error).finally(() => setLoading(false));
  }, [user.id]);

  const handleJoin = async (circuitId) => {
    setJoining(circuitId);
    setError('');
    try {
      await api.joinCircuit(circuitId, user.id);
      setMyCircuits(prev => [...prev, circuitId]);
    } catch (err) {
      setError(err.message || 'Failed to join circuit');
    }
    setJoining(null);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading circuits...</div>;

  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Tennis Circuits</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
        Join a circuit to see tournaments and make predictions
      </p>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--red-glow)', color: 'var(--red)', fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {circuits.map((c, i) => {
          const isMember = myCircuits.includes(c.id);
          return (
            <div key={c.id} className="fade-in" style={{
              background: 'var(--card)', border: `1px solid ${isMember ? 'rgba(0,232,123,0.2)' : 'var(--border)'}`,
              borderRadius: 16, padding: 16, animationDelay: `${i * 0.05}s`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 24 }}>{c.logo_emoji}</span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{c.country}</div>
                    </div>
                  </div>
                  {c.description && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                      {c.description}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-dim)' }}>
                    <span>👥 {c.member_count} members</span>
                    <span>🏆 {c.tournament_count} tournaments</span>
                    <span>📡 {c.data_source === 'tournamentsoftware' ? 'Auto-sync' : c.data_source === 'playwaze' ? 'Auto-sync' : c.data_source === 'manual' ? 'Manual entry' : c.data_source}</span>
                  </div>
                </div>

                <div style={{ marginLeft: 12, flexShrink: 0 }}>
                  {isMember ? (
                    <button onClick={() => navigate('/')} style={{
                      padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'var(--accent-glow)', color: 'var(--accent)', fontSize: 12, fontWeight: 600,
                    }}>
                      ✓ View
                    </button>
                  ) : (
                    <button onClick={() => handleJoin(c.id)} disabled={joining === c.id} style={{
                      padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
                      color: 'var(--bg)', fontSize: 12, fontWeight: 700,
                      opacity: joining === c.id ? 0.6 : 1,
                    }}>
                      {joining === c.id ? '...' : 'Join'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {circuits.length === 0 && (
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 50, marginBottom: 16 }}>🌍</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No circuits yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>Be the first to create one!</div>
        </div>
      )}
    </div>
  );
}
