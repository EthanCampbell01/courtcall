const SCORING = [
  { label: 'Correct Winner', pts: 10, icon: '🎯', color: 'var(--accent)', desc: 'Pick the right player to win the match' },
  { label: 'Correct Sets', pts: 5, icon: '📊', color: 'var(--blue)', desc: 'Predict straight sets or 3 sets correctly' },
  { label: 'Correct Score', pts: 15, icon: '🔢', color: 'var(--purple)', desc: 'Nail the exact scoreline (requires correct winner)' },
  { label: 'Upset Bonus', pts: 8, icon: '🔥', color: 'var(--orange)', desc: 'Correctly predict a lower seed winning' },
  { label: 'Perfect Match', pts: 10, icon: '⭐', color: 'var(--gold)', desc: 'Winner + sets + score all correct' },
];

export default function ScoringModal({ onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="slide-up" style={{
        width: '100%', maxWidth: 480, background: 'var(--card)', borderRadius: '24px 24px 0 0',
        padding: '20px 24px 40px', maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-light)', margin: '0 auto 20px' }} />

        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>
          How Scoring Works
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginBottom: 20 }}>
          Points are awarded when match results come in
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SCORING.map((s, i) => (
            <div key={s.label} className="fade-in" style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 16px', borderRadius: 14,
              background: 'var(--bg)', border: '1px solid var(--border)',
              animationDelay: `${i * 0.05}s`,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'var(--card)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                flexShrink: 0,
              }}>
                {s.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{s.desc}</div>
              </div>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: s.color,
                background: 'var(--card)', padding: '6px 10px', borderRadius: 8,
                border: '1px solid var(--border)', flexShrink: 0,
              }}>
                +{s.pts}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 16, padding: '16px 20px', borderRadius: 14, textAlign: 'center',
          background: 'var(--accent-glow)', border: '1px solid rgba(0,232,123,0.15)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>
            Maximum per match
          </div>
          <span style={{ fontSize: 36, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>48</span>
          <span style={{ fontSize: 14, color: 'var(--text-dim)', marginLeft: 4 }}>pts</span>
        </div>

        <button onClick={onClose} style={{
          width: '100%', padding: 14, borderRadius: 14, border: '1px solid var(--border)',
          background: 'var(--bg)', color: 'var(--text)', fontSize: 14, fontWeight: 600,
          cursor: 'pointer', marginTop: 16, transition: 'all 0.2s',
        }}>
          Got it
        </button>
      </div>
    </div>
  );
}
