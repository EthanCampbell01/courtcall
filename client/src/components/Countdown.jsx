import { useState, useEffect } from 'react';

/**
 * Live countdown timer to a prediction deadline.
 * Visual urgency: calm (green) → warning (orange) → urgent (red) → locked.
 */
export default function Countdown({ deadline, label = 'Predictions lock in' }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!deadline) return null;

  const target = new Date(deadline).getTime();
  const diff = target - now;

  if (diff <= 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        background: 'var(--red-glow)', border: '1px solid rgba(255,71,87,0.2)',
        borderRadius: 14, marginBottom: 14,
      }}>
        <span style={{ fontSize: 16 }}>🔒</span>
        <span style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600 }}>Predictions locked</span>
      </div>
    );
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);

  const urgent = diff < 1000 * 60 * 60; // < 1 hour
  const warning = diff < 1000 * 60 * 60 * 24; // < 24 hours
  const color = urgent ? 'var(--red)' : warning ? 'var(--orange)' : 'var(--accent)';
  const bgColor = urgent ? 'var(--red-glow)' : warning ? 'var(--orange-glow)' : 'var(--accent-glow)';
  const borderColor = urgent ? 'rgba(255,71,87,0.2)' : warning ? 'rgba(255,159,28,0.2)' : 'rgba(0,232,123,0.15)';

  const segments = [];
  if (days > 0) segments.push({ value: days, unit: 'd' });
  if (hours > 0 || days > 0) segments.push({ value: hours, unit: 'h' });
  segments.push({ value: mins, unit: 'm' });
  if (days === 0) segments.push({ value: secs, unit: 's' });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', background: bgColor, border: `1px solid ${borderColor}`,
      borderRadius: 14, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{urgent ? '🚨' : warning ? '⏰' : '🟢'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{
            background: 'var(--bg)', borderRadius: 6, padding: '4px 6px',
            display: 'flex', alignItems: 'baseline', gap: 1,
            border: '1px solid var(--border)',
          }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color, minWidth: 20, textAlign: 'right' }}>
              {String(seg.value).padStart(2, '0')}
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 600 }}>{seg.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
