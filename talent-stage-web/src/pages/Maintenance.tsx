interface Props {
  message?: string;
}

export default function Maintenance({ message }: Props) {
  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      background: '#0a0a0a',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 42, marginBottom: 16 }}>&#128295;</div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, lineHeight: 1.2 }}>Maintenance Mode</h1>
        <p style={{ marginTop: 12, color: 'rgba(255,255,255,.72)', fontSize: 15, lineHeight: 1.6 }}>
          {message || 'We are currently doing maintenance. Please try again later.'}
        </p>
      </div>
    </div>
  );
}
