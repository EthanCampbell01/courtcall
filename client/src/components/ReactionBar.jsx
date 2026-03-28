import { useState } from 'react';

const EMOJI_OPTIONS = ['😂', '🔥', '💀', '👏', '🤡', '😤', '💪', '🧠'];

/**
 * Emoji reaction bar for a prediction.
 * Shows existing reactions as counted pills and a + button to add your own.
 */
export default function ReactionBar({ predictionId, reactions = [], currentUserId, onReact, onRemove }) {
  const [showPicker, setShowPicker] = useState(false);

  // Count reactions by emoji
  const counts = {};
  let myReaction = null;
  for (const r of reactions) {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    if (r.user_id === currentUserId) myReaction = r.emoji;
  }

  const handlePick = (emoji) => {
    setShowPicker(false);
    if (emoji === myReaction) {
      onRemove?.(predictionId);
    } else {
      onReact?.(predictionId, emoji);
    }
  };

  const sortedEmojis = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 6, position: 'relative' }}>
      {sortedEmojis.map(([emoji, count]) => {
        const isMine = emoji === myReaction;
        return (
          <button key={emoji} onClick={() => handlePick(emoji)} style={{
            display: 'flex', alignItems: 'center', gap: 3,
            padding: '3px 8px', borderRadius: 100,
            border: `1px solid ${isMine ? 'var(--accent)' : 'var(--border)'}`,
            background: isMine ? 'var(--accent-glow)' : 'var(--card)',
            cursor: 'pointer', fontSize: 12,
          }}>
            <span>{emoji}</span>
            <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: isMine ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 600 }}>
              {count}
            </span>
          </button>
        );
      })}

      {/* Add reaction button */}
      <button onClick={() => setShowPicker(!showPicker)} style={{
        width: 28, height: 28, borderRadius: 100,
        border: '1px solid var(--border)', background: 'transparent',
        cursor: 'pointer', fontSize: 12, color: 'var(--text-dim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {showPicker ? '✕' : '+'}
      </button>

      {/* Emoji picker */}
      {showPicker && (
        <>
          <div onClick={() => setShowPicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: 6, display: 'flex', gap: 2, zIndex: 41,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            {EMOJI_OPTIONS.map(e => (
              <button key={e} onClick={() => handlePick(e)} style={{
                width: 36, height: 36, borderRadius: 8, border: 'none',
                background: e === myReaction ? 'var(--accent-glow)' : 'transparent',
                cursor: 'pointer', fontSize: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
