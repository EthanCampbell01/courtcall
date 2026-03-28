import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import Tag from '../components/Tag';
import Countdown from '../components/Countdown';
import RefreshButton from '../components/RefreshButton';

export default function Tournaments() {
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState([]);
  const [myCircuits, setMyCircuits] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadData = async () => {
    try {
      const [circs, allTournaments] = await Promise.all([
        api.getUserCircuits(user.id),
        api.getTournaments(),
      ]);
      setMyCircuits(circs);
      const myCircuitIds = new Set(circs.map(c => c.id));
      const filtered = allTournaments.filter(t => !t.circuit_id || myCircuitIds.has(t.circuit_id));
      setTournaments(filtered);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [user.id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading tournaments...</div>;

  const urgentTournament = tournaments.find(t => {
    if (!t.next_deadline) return false;
    const diff = new Date(t.next_deadline) - new Date();
    return diff > 0 && diff < 24 * 60 * 60 * 1000;
  });

  const upcoming = tournaments.filter(t => t.status === 'upcoming' || t.status === 'active');
  const completed = tournaments.filter(t => t.status === 'completed');

  return (
    <div>
      {urgentTournament && (
        <div onClick={() => navigate(`/tournament/${urgentTournament.id}`)} style={{ cursor: 'pointer', marginBottom: 14 }}>
          <Countdown deadline={urgentTournament.next_deadline} label={`⚠️ ${urgentTournament.name} — lock your picks!`} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>Tournaments</h2>
        <RefreshButton onRefresh={loadData} />
      </div>

      {myCircuits.length === 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>Join a circuit to see tournaments</div>
          <button onClick={() => navigate('/circuits')} style={{
            padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: 'var(--bg)', fontSize: 13, fontWeight: 600,
          }}>Browse Circuits 🌍</button>
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {upcoming.map((t, i) => (
            <button key={t.id} onClick={() => navigate(`/tournament/${t.id}`)} style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16,
              cursor: 'pointer', textAlign: 'left', width: '100%', color: 'var(--text)',
              animation: `fadeIn 0.3s ease ${i * 0.04}s both`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    📍 {t.club}{t.circuit_name ? ` · ${t.circuit_name}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Tag text={t.dates} color="var(--accent)" />
                    <Tag text={t.surface} color="var(--blue)" />
                    {t.status === 'active' && <Tag text="LIVE" color="var(--red)" />}
                    {t.event_count > 0 && <Tag text={`${t.event_count} events`} color="var(--purple)" />}
                    {t.match_count > 0 && <Tag text={`${t.match_count} matches`} color="var(--orange)" />}
                  </div>
                </div>
                <span style={{ color: 'var(--text-dim)', fontSize: 18 }}>→</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Completed</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {completed.map((t, i) => (
              <button key={t.id} onClick={() => navigate(`/tournament/${t.id}`)} style={{
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 14,
                cursor: 'pointer', textAlign: 'left', width: '100%', color: 'var(--text)', opacity: 0.6,
              }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{t.club} · {t.dates}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {tournaments.length === 0 && myCircuits.length > 0 && (
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 50, marginBottom: 16 }}>📅</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No tournaments yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>Tournaments will appear when draws are published for your circuits</div>
        </div>
      )}
    </div>
  );
}
