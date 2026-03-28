import { useState, useRef, useEffect } from 'react';

/**
 * Compact refresh button with loading spinner animation.
 * Place in page headers for manual data refresh.
 */
export default function RefreshButton({ onRefresh }) {
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleClick = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh?.();
    } catch (e) {
      console.error('Refresh failed:', e);
    }
    timerRef.current = setTimeout(() => setRefreshing(false), 400);
  };

  return (
    <button onClick={handleClick} disabled={refreshing} style={{
      background: 'none', border: '1px solid var(--border)', borderRadius: 8,
      width: 32, height: 32, cursor: 'pointer', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontSize: 14,
      color: 'var(--text-muted)', transition: 'all 0.2s',
    }}>
      <span style={{
        display: 'inline-block',
        animation: refreshing ? 'spin 0.6s linear infinite' : 'none',
      }}>
        🔄
      </span>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}
