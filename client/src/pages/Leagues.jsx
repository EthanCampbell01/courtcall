import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';

export default function Leagues() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUserLeagues(user.id).then(setLeagues).catch(console.error).finally(() => setLoading(false));
  }, [user.id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>Your Leagues</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => navigate('/leagues/join')} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            Join
          </button>
          <button onClick={() => navigate('/leagues/create')} style={{ background: 'var(--accent-glow)', border: '1px solid rgba(0,232,123,0.2)', borderRadius: 10, padding: '8px 12px', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            + Create
          </button>
        </div>
      </div>

      {leagues.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 50, marginBottom: 16 }}>🏆</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No leagues yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>Create a league or join one with an invite code</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {leagues.map((lg, i) => (
            <button key={lg.id} onClick={() => navigate(`/leagues/${lg.id}`)} style={{
              width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16,
              cursor: 'pointer', textAlign: 'left', color: 'var(--text)', animation: `fadeIn 0.3s ease ${i * 0.04}s both`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{lg.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {lg.member_count} players · £{lg.buy_in} buy-in
                    {lg.tournament_name && ` · ${lg.tournament_name}`}
                  </div>
                </div>
                <span style={{ color: 'var(--text-dim)' }}>→</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
