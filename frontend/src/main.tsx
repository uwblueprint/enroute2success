import React from 'react';
import ReactDOM from 'react-dom/client';
// Apollo Client v4 moved all React-specific exports (ApolloProvider, useQuery,
// etc.) out of the core "@apollo/client" package and into "@apollo/client/react".
import { ApolloProvider } from '@apollo/client/react';
import { apolloClient } from './apolloClient';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ApolloProvider client={apolloClient}>
      <App />
    </ApolloProvider>
  </React.StrictMode>
);
