import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';

/**
 * Onboarding screen shown after first registration.
 * Guides user to: pick their circuits, then join or create a league.
 */
export default function Onboarding({ onComplete }) {
  const { user, logout } = useAuth();
  const [step, setStep] = useState(1);
  const [circuits, setCircuits] = useState([]);
  const [joined, setJoined] = useState([]);
  const [leagueCode, setLeagueCode] = useState('');
  const [leagueError, setLeagueError] = useState('');
  const [joinError, setJoinError] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    api.getCircuits()
      .then(setCircuits)
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleJoinCircuit = async (circuitId) => {
    setJoinError('');
    try {
      await api.joinCircuit(circuitId, user.id);
      setJoined(prev => prev.includes(circuitId) ? prev : [...prev, circuitId]);
    } catch (e) {
      setJoinError(e.message || 'Failed to join circuit');
    }
  };

  const handleJoinLeague = async () => {
    if (leagueCode.length < 4) return;
    setLeagueError('');
    try {
      await api.joinLeague(leagueCode, user.id);
      setStep(3);
    } catch (err) { setLeagueError(err.message); }
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--card)' }} className="pulse" />
    </div>
  );

  const steps = [
    { num: 1, label: 'Circuits' },
    { num: 2, label: 'League' },
    { num: 3, label: 'Ready' },
  ];

  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '32px 24px', minHeight: '100vh', position: 'relative' }}>
      {/* Ambient glow */}
      <div style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', width: 500, height: 500, background: 'radial-gradient(circle, var(--accent-glow2), transparent 60%)', pointerEvents: 'none', zIndex: 0 }} />

      {/* User chip + sign out */}
      <div style={{ position: 'absolute', top: 16, right: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 500 }}>{user.display_name}</span>
        <button onClick={logout} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--text-dim)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          padding: '5px 10px', transition: 'all 0.2s',
        }}>
          Sign out
        </button>
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Progress bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 36 }}>
          {steps.map((s, i) => (
            <div key={s.num} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < steps.length - 1 ? 1 : 0 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, fontSize: 12, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: step >= s.num ? 'var(--accent)' : 'var(--card)',
                color: step >= s.num ? 'var(--bg)' : 'var(--text-dim)',
                border: `1px solid ${step >= s.num ? 'var(--accent)' : 'var(--border)'}`,
                transition: 'all 0.3s',
              }}>
                {step > s.num ? '✓' : s.num}
              </div>
              {i < steps.length - 1 && (
                <div style={{ flex: 1, height: 2, borderRadius: 1, background: step > s.num ? 'var(--accent)' : 'var(--border)', transition: 'all 0.3s' }} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Join circuits */}
        {step === 1 && (
          <div className="fade-in">
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Pick your circuits</h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Which tennis communities do you want to predict?
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
              {fetchError && (
                <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--red-glow)', border: '1px solid rgba(255,71,87,0.2)', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 500 }}>Failed to load circuits — check your server is running</div>
                </div>
              )}
              {joinError && (
                <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--red-glow)', border: '1px solid rgba(255,71,87,0.2)', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 500 }}>{joinError}</div>
                </div>
              )}
              {!fetchError && circuits.length === 0 && !loading && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No circuits available yet</div>
              )}
              {circuits.map((c, i) => {
                const isJoined = joined.includes(c.id);
                return (
                  <button key={c.id} onClick={() => handleJoinCircuit(c.id)} className="fade-in" style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                    background: isJoined ? 'var(--accent-glow)' : 'var(--card)',
                    border: `1px solid ${isJoined ? 'rgba(0,232,123,0.3)' : 'var(--border)'}`,
                    borderRadius: 16, cursor: 'pointer', width: '100%', textAlign: 'left',
                    color: 'var(--text)', transition: 'all 0.2s',
                    animationDelay: `${i * 0.06}s`,
                  }}>
                    <span style={{ fontSize: 30, flexShrink: 0 }}>{c.logo_emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        {c.member_count} members · {c.tournament_count} tournaments
                      </div>
                    </div>
                    {isJoined && (
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bg)', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>✓</div>
                    )}
                  </button>
                );
              })}
            </div>

            <button onClick={() => setStep(2)} disabled={joined.length === 0} style={{
              width: '100%', padding: 16, borderRadius: 14, border: 'none', cursor: 'pointer',
              background: joined.length > 0 ? 'linear-gradient(135deg, var(--accent), var(--accent-dim))' : 'var(--border)',
              color: joined.length > 0 ? 'var(--bg)' : 'var(--text-dim)',
              fontSize: 15, fontWeight: 700, transition: 'all 0.2s',
              boxShadow: joined.length > 0 ? '0 4px 20px var(--accent-glow)' : 'none',
            }}>
              Continue →
            </button>
          </div>
        )}

        {/* Step 2: Join a league */}
        {step === 2 && (
          <div className="fade-in">
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Join a league</h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Got an invite code from a mate? Or skip and create your own later.
              </p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <input
                value={leagueCode}
                onChange={e => setLeagueCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="INVITE CODE"
                maxLength={8}
                style={{
                  width: '100%', padding: 20, borderRadius: 16,
                  border: '1px solid var(--border)', background: 'var(--card)',
                  color: 'var(--accent)', fontSize: 28, fontWeight: 700,
                  fontFamily: 'var(--mono)', textAlign: 'center', letterSpacing: 6,
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
              />
            </div>

            {leagueError && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--red-glow)', color: 'var(--red)', fontSize: 13, marginBottom: 14, fontWeight: 500 }}>
                {leagueError}
              </div>
            )}

            <button onClick={handleJoinLeague} disabled={leagueCode.length < 4} style={{
              width: '100%', padding: 16, borderRadius: 14, border: 'none', cursor: 'pointer',
              background: leagueCode.length >= 4 ? 'linear-gradient(135deg, var(--accent), var(--accent-dim))' : 'var(--border)',
              color: leagueCode.length >= 4 ? 'var(--bg)' : 'var(--text-dim)',
              fontSize: 15, fontWeight: 700, marginBottom: 10, transition: 'all 0.2s',
              boxShadow: leagueCode.length >= 4 ? '0 4px 20px var(--accent-glow)' : 'none',
            }}>
              Join League
            </button>

            <button onClick={() => setStep(3)} style={{
              width: '100%', padding: 14, borderRadius: 14,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer', transition: 'all 0.2s',
            }}>
              Skip for now
            </button>
          </div>
        )}

        {/* Step 3: Ready */}
        {step === 3 && (
          <div className="fade-in" style={{ textAlign: 'center', paddingTop: 40 }}>
            <div style={{
              width: 80, height: 80, borderRadius: 24, margin: '0 auto 24px',
              background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40,
              boxShadow: '0 8px 32px var(--accent-glow)',
              animation: 'glow 2s ease-in-out infinite',
            }}>
              🎾
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>You're in!</h2>
            <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 36, maxWidth: 300, margin: '0 auto 36px' }}>
              Head to the draws, pick your winners, and see if you can out-predict your mates.
            </p>

            <button onClick={onComplete} style={{
              width: '100%', padding: 18, borderRadius: 16, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
              color: 'var(--bg)', fontSize: 16, fontWeight: 700,
              boxShadow: '0 4px 24px var(--accent-glow)',
              transition: 'all 0.2s',
            }}>
              Let's Go 🎾
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
