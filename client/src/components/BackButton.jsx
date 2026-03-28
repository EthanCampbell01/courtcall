import { useNavigate } from 'react-router-dom';

export default function BackButton({ to, label = 'Back' }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => to ? navigate(to) : navigate(-1)}
      style={{
        background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer',
        padding: 0, fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16,
      }}
    >
      ← {label}
    </button>
  );
}
