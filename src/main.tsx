import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { I18nProvider } from './i18n';
import { ShadingModeControl } from './components/ShadingModeControl';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
      <ShadingModeControl />
    </I18nProvider>
  </StrictMode>,
);
