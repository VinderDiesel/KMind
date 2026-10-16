import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/syne/500.css';
import '@fontsource/syne/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
