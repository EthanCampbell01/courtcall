import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import BackButton from '../components/BackButton';

export default function CreateLeague({ showToast }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [buyIn, setBuyIn] = useState('10');
  const [tournamentId, setTournamentId] = useState('');
  const [tournaments, setTournaments] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getTournaments().then(t => { setTournaments(t); }).catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const league = await api.createLeague({ name: name.trim(), buy_in: parseFloat(buyIn) || 0, tournament_id: tournamentId || null, user_id: user.id });
      showToast('League created! 🏆');
      navigate(`/leagues/${league.id}`);
    } catch (err) { showToast('Error: ' + err.message); }
    setSaving(false);
  };

  const inputStyle = { width: '100%', padding: '14px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 15, outline: 'none', marginTop: 8 };

  return (
    <div>
      <BackButton to="/leagues" label="Leagues" />
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 24px' }}>Create a League</h2>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>League Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="The Ballycastle Bandits" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Buy-in (£)</label>
        <input type="number" value={buyIn} onChange={e => setBuyIn(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 28 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tournament</label>
        <select value={tournamentId} onChange={e => setTournamentId(e.target.value)} style={{ ...inputStyle, appearance: 'auto' }}>
          <option value="">None (general league)</option>
          {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <button onClick={handleCreate} disabled={!name.trim() || saving} style={{
        width: '100%', padding: 16, borderRadius: 14, border: 'none', cursor: name.trim() ? 'pointer' : 'default',
        background: name.trim() ? 'linear-gradient(135deg, var(--accent), var(--accent-dim))' : 'var(--border)',
        color: name.trim() ? 'var(--bg)' : 'var(--text-dim)', fontSize: 15, fontWeight: 700, opacity: saving ? 0.6 : 1,
      }}>
        Create League 🏆
      </button>
    </div>
  );
}
