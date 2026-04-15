import PropTypes from 'prop-types';

Toast.propTypes = {
  message: PropTypes.node.isRequired,
};

export default function Toast({ message }) {
  return (
    <div style={{
      position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--card)', color: 'var(--text)', padding: '12px 24px',
      borderRadius: 14, fontSize: 14, fontWeight: 600, zIndex: 100,
      border: '1px solid var(--accent)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 20px var(--accent-glow)',
      animation: 'slideDown 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
      {message}
    </div>
  );
}
