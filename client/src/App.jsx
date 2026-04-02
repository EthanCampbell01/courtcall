import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import AuthScreen from './pages/AuthScreen';
import Tournaments from './pages/Tournaments';
import TournamentDetail from './pages/TournamentDetail';
import PredictionForm from './pages/PredictionForm';
import Predictions from './pages/Predictions';
import Leagues from './pages/Leagues';
import LeagueDetail from './pages/LeagueDetail';
import CreateLeague from './pages/CreateLeague';
import JoinLeague from './pages/JoinLeague';
import AdminPanel from './pages/AdminPanel';
import Stats from './pages/Stats';
import CircuitBrowser from './pages/CircuitBrowser';
import Onboarding from './pages/Onboarding';
import ScoringModal from './components/ScoringModal';
import Toast from './components/Toast';
import { useState, useCallback, useEffect, useRef } from 'react';

export default function App() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [toast, setToast] = useState(null);
  const [showScoring, setShowScoring] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // Check if user needs onboarding (no circuits joined)
  useEffect(() => {
    if (!user) { setCheckingOnboarding(false); setNeedsOnboarding(false); return; }
    setCheckingOnboarding(true);
    fetch(`/api/circuits/user/${user.id}`)
      .then(r => r.json())
      .then(circuits => {
        setNeedsOnboarding(!circuits || circuits.length === 0);
        setCheckingOnboarding(false);
      })
      .catch(() => setCheckingOnboarding(false));
  }, [user?.id]);

  if (!user) return <AuthScreen />;
  if (checkingOnboarding) return null;
  if (needsOnboarding) return <Onboarding onComplete={() => setNeedsOnboarding(false)} />;

  const tab = location.pathname.startsWith('/circuits') ? 'circuits'
    : location.pathname.startsWith('/admin') ? 'circuits'
    : location.pathname.startsWith('/stats') ? 'stats'
    : location.pathname.startsWith('/leagues') ? 'leagues'
    : location.pathname.startsWith('/predictions') ? 'predictions'
    : 'tournaments';

  const showNav = ['/', '/predictions', '/leagues', '/stats', '/circuits', '/admin'].includes(location.pathname);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', position: 'relative' }}>
      {/* Ambient glow */}
      <div style={{ position: 'fixed', top: -200, right: -150, width: 400, height: 400, background: 'radial-gradient(circle, var(--accent-glow2), transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: -200, left: -150, width: 350, height: 350, background: 'radial-gradient(circle, rgba(77,163,255,0.04), transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />

      <header style={{ padding: '16px 20px 12px', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => navigate('/')}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 2px 12px var(--accent-glow)' }}>
              🎾
            </div>
            <div>
              <h1 className="gradient-text" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px', lineHeight: 1 }}>
                CourtCall
              </h1>
              <p style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 2 }}>
                Tennis Predictions
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setShowScoring(true)} style={{
              background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '5px 10px', color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer',
              transition: 'all 0.2s',
            }}>
              ℹ️
            </button>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowUserMenu(!showUserMenu)} style={{
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 12px',
                transition: 'all 0.2s',
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{user.display_name}</span>
                <span style={{ fontSize: 18, lineHeight: 1 }}>{user.avatar || '🎾'}</span>
              </button>
              {showUserMenu && (
                <>
                  <div onClick={() => setShowUserMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
                  <div className="fade-in-scale" style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 6,
                    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
                    padding: 6, minWidth: 160, zIndex: 21,
                    boxShadow: '0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)',
                  }}>
                    <button onClick={() => { setShowUserMenu(false); navigate('/admin'); }} style={{
                      width: '100%', padding: '10px 12px', background: 'none', border: 'none',
                      color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      textAlign: 'left', borderRadius: 10, transition: 'background 0.15s',
                    }}>
                      ⚙️ Admin Panel
                    </button>
                    <div style={{ height: 1, background: 'var(--border)', margin: '2px 8px' }} />
                    <button onClick={() => { setShowUserMenu(false); logout(); }} style={{
                      width: '100%', padding: '10px 12px', background: 'none', border: 'none',
                      color: 'var(--red)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      textAlign: 'left', borderRadius: 10, transition: 'background 0.15s',
                    }}>
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main style={{ padding: '0 20px 100px', position: 'relative', zIndex: 1 }}>
        <Routes>
          <Route path="/" element={<Tournaments />} />
          <Route path="/tournament/:id" element={<TournamentDetail showToast={showToast} />} />
          <Route path="/predict/:tournamentId/:matchId" element={<PredictionForm showToast={showToast} />} />
          <Route path="/predictions" element={<Predictions />} />
          <Route path="/leagues" element={<Leagues />} />
          <Route path="/leagues/create" element={<CreateLeague showToast={showToast} />} />
          <Route path="/leagues/join" element={<JoinLeague showToast={showToast} />} />
          <Route path="/leagues/:id" element={<LeagueDetail />} />
          <Route path="/admin" element={<AdminPanel showToast={showToast} />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/circuits" element={<CircuitBrowser />} />
        </Routes>
      </main>

      {showNav && (
        <nav style={{
          position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: 480,
          background: 'rgba(8,11,16,0.88)', backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          borderTop: '1px solid rgba(28,37,53,0.6)', display: 'flex', zIndex: 10,
          padding: '4px 4px env(safe-area-inset-bottom, 6px)',
        }}>
          {[
            { id: 'tournaments', path: '/', icon: '📅', label: 'Draws' },
            { id: 'predictions', path: '/predictions', icon: '🎯', label: 'Picks' },
            { id: 'leagues', path: '/leagues', icon: '🏆', label: 'Leagues' },
            { id: 'stats', path: '/stats', icon: '📊', label: 'Stats' },
            { id: 'circuits', path: '/circuits', icon: '🌍', label: 'Circuits' },
          ].map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => navigate(t.path)} style={{
                flex: 1, background: active ? 'var(--accent-glow)' : 'none',
                border: 'none', borderRadius: 12,
                padding: '8px 0 5px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                color: active ? 'var(--accent)' : 'var(--text-dim)', transition: 'all 0.2s',
              }}>
                <span style={{ fontSize: 18, filter: active ? 'none' : 'grayscale(0.8) opacity(0.5)' }}>{t.icon}</span>
                <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, letterSpacing: '0.3px' }}>{t.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {showScoring && <ScoringModal onClose={() => setShowScoring(false)} />}
      {toast && <Toast message={toast} />}
    </div>
  );
}
