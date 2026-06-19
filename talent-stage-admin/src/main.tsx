import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import { initTheme } from './hooks/useTheme';
import './styles/global.css';

const baseUrl = String(import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
const routerBasename = baseUrl && baseUrl !== '/' ? baseUrl : undefined;

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
