export default function Home() {
  return (
    <div style={{ padding: '50px', textAlign: 'center' }}>
      <h1>Seismic DSP Dashboard</h1>
      <p>Deployment successful! 🎉</p>
      <p>API endpoints:</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        <li><a href="/api/diagnose/env">/api/diagnose/env</a></li>
        <li><a href="/api/db/diagnose">/api/db/diagnose</a></li>
        <li><a href="/api/diagnose/storage">/api/diagnose/storage</a></li>
      </ul>
    </div>
  );
}
