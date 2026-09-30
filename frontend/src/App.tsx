import { gql } from '@apollo/client';
// React hooks live in the "@apollo/client/react" entrypoint as of Apollo Client v4.
import { useQuery } from '@apollo/client/react';

const HEALTH_QUERY = gql`
  query Health {
    health {
      ok
      databaseConnected
      timestamp
    }
  }
`;

interface HealthQueryResult {
  health: {
    ok: boolean;
    databaseConnected: boolean;
    timestamp: string;
  };
}

function App() {
  const { data, loading, error, refetch } = useQuery<HealthQueryResult>(HEALTH_QUERY);

  return (
    <main className="app">
      <h1>PERN Stack Scaffold</h1>
      <p>React + Express + Node + PostgreSQL, wired together over GraphQL.</p>

      <section className="status-card">
        <h2>Backend wiring check</h2>

        {loading && <p>Checking backend / database connectivity…</p>}

        {error && (
          <p className="status status--error">
            ❌ Could not reach the GraphQL API at <code>{import.meta.env.VITE_GRAPHQL_URL}</code>.
            <br />
            {error.message}
          </p>
        )}

        {data && (
          <ul className="status-list">
            <li>GraphQL server: {data.health.ok ? '✅ reachable' : '❌ unreachable'}</li>
            <li>
              Postgres (via Prisma):{' '}
              {data.health.databaseConnected ? '✅ connected' : '❌ not connected'}
            </li>
            <li>Server time: {data.health.timestamp}</li>
          </ul>
        )}

        <button onClick={() => refetch()}>Re-check</button>
      </section>

      <p className="hint">
        This is a bare scaffold — no sample data model yet. Add Prisma models in{' '}
        <code>backend/prisma/schema.prisma</code>, extend the GraphQL schema in{' '}
        <code>backend/src/schema</code>, and build UI here in <code>frontend/src</code>.
      </p>
    </main>
  );
}

export default App;
