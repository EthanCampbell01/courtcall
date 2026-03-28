import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import BackButton from '../components/BackButton';

export default function JoinLeague({ showToast }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  const handleJoin = async () => {
    if (code.length < 4) return;
    setSaving(true);
    try {
      const result = await api.joinLeague(code, user.id);
      showToast('Joined league! 🎉');
      navigate(`/leagues/${result.league.id}`);
    } catch (err) { showToast(err.message); }
    setSaving(false);
  };

  return (
    <div>
      <BackButton to="/leagues" label="Leagues" />
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 24px' }}>Join a League</h2>
      <div style={{ marginBottom: 28 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invite Code</label>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. ABC123" maxLength={8}
          style={{ width: '100%', padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--accent)', fontSize: 24, fontWeight: 700, fontFamily: 'var(--mono)', textAlign: 'center', letterSpacing: 4, outline: 'none', marginTop: 8 }}
        />
      </div>
      <button onClick={handleJoin} disabled={code.length < 4 || saving} style={{
        width: '100%', padding: 16, borderRadius: 14, border: 'none', cursor: code.length >= 4 ? 'pointer' : 'default',
        background: code.length >= 4 ? 'linear-gradient(135deg, var(--accent), var(--accent-dim))' : 'var(--border)',
        color: code.length >= 4 ? 'var(--bg)' : 'var(--text-dim)', fontSize: 15, fontWeight: 700, opacity: saving ? 0.6 : 1,
      }}>
        Join League 🎉
      </button>
    </div>
  );
}
