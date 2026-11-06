import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import { installErrorReporting } from './lib/reportError';

installErrorReporting();

// Installable app (PWA): the service worker makes the ERP open full-screen from the home-screen icon and start
// instantly. It never caches live data (see public/sw.js). Production builds only.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
