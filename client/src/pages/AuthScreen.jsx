import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';

const AVATARS = ['🎾', '🏆', '🔥', '⭐', '💪', '🎯', '👑', '🦁', '🐉', '☘️', '🍀', '⚡'];

export default function AuthScreen() {
  const { login } = useAuth();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [avatar, setAvatar] = useState('🎾');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      let user;
      if (mode === 'login') {
        user = await api.login(username, pin);
      } else {
        user = await api.register(username, displayName, pin, avatar);
      }
      login(user);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const inputStyle = {
    width: '100%', padding: '14px 16px', borderRadius: 12,
    border: '1px solid var(--border)', background: 'var(--bg)',
    color: 'var(--text)', fontSize: 15, outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: '0 24px', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      {/* Ambient background glow */}
      <div style={{ position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)', width: 500, height: 500, background: 'radial-gradient(circle, var(--accent-glow2), transparent 60%)', pointerEvents: 'none', zIndex: 0 }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, margin: '0 auto 16px',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36,
            boxShadow: '0 8px 32px var(--accent-glow), 0 2px 8px rgba(0,0,0,0.3)',
          }}>
            🎾
          </div>
          <h1 className="gradient-text" style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-1px' }}>
            CourtCall
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 6 }}>Predict. Compete. Win.</p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 24,
          boxShadow: '0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)',
        }}>
          {/* Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: 12, padding: 3, marginBottom: 24 }}>
            {['login', 'register'].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); }} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: mode === m ? 'var(--border)' : 'transparent',
                color: mode === m ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
              }}>
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block', fontWeight: 600 }}>Username</label>
              <input value={username} onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20).toLowerCase())} placeholder="e.g. ciaran_tennis" style={inputStyle} autoCapitalize="off" autoCorrect="off" autoComplete="username" />
              {mode === 'register' && username.length > 0 && username.length < 3 && (
                <div style={{ fontSize: 11, color: 'var(--orange)', marginTop: 4 }}>Min 3 characters</div>
              )}
            </div>

            {mode === 'register' && (
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block', fontWeight: 600 }}>Display Name</label>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Ciaran" style={inputStyle} />
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block', fontWeight: 600 }}>Choose Your Avatar</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {AVATARS.map(e => (
                    <button key={e} onClick={() => setAvatar(e)} type="button" style={{
                      width: 42, height: 42, borderRadius: 12,
                      border: `2px solid ${avatar === e ? 'var(--accent)' : 'var(--border)'}`,
                      background: avatar === e ? 'var(--accent-glow)' : 'var(--bg)',
                      fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                      transform: avatar === e ? 'scale(1.1)' : 'scale(1)',
                    }}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'block', fontWeight: 600 }}>PIN (4+ digits)</label>
              <input type="password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="••••" style={{ ...inputStyle, letterSpacing: 8, textAlign: 'center', fontSize: 22, fontFamily: 'var(--mono)' }} maxLength={8} inputMode="numeric" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </div>
          </div>

          {error && (
            <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, background: 'var(--red-glow)', color: 'var(--red)', fontSize: 13, fontWeight: 500 }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading || !username || pin.length < 4 || (mode === 'register' && (!displayName || username.length < 3))} style={{
            width: '100%', padding: 16, borderRadius: 14, border: 'none', marginTop: 20, cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
            color: 'var(--bg)', fontSize: 15, fontWeight: 700,
            opacity: loading || !username || pin.length < 4 ? 0.5 : 1,
            boxShadow: '0 4px 20px var(--accent-glow)',
            transition: 'all 0.2s',
          }}>
            {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-dim)' }}>
          No email needed — just a username and PIN
        </p>
      </div>
    </div>
  );
}
