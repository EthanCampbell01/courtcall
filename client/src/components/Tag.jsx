import PropTypes from 'prop-types';

Tag.propTypes = {
  text: PropTypes.string.isRequired,
  color: PropTypes.string,
};

export default function Tag({ text, color = 'var(--text-muted)' }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
      background: 'var(--bg-raised)', color,
      border: '1px solid var(--border)',
      letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}
