import './index.css';
import './utils/debugLogger';
import { installBrowserTauriMock } from './utils/browserTauriMock';

// Install a permissive Tauri IPC mock when running outside the desktop app so
// unguarded `invoke()` calls don't crash the React tree in the Vite preview.
installBrowserTauriMock();

import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App.tsx';
import { ErrorBoundary } from './components/core/ErrorBoundary';
import { Toast } from './components/shared/Toast';
import { TooltipProvider } from './components/ui/tooltip';
import { ConfigProvider } from './contexts/ConfigContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { StudioConnectionProvider } from './contexts/StudioConnectionContext';
import { ThemeProvider } from './contexts/ThemeContext';

const savedTheme = localStorage.getItem('theme') || 'dark';
// Forces the saved theme into the DOM before React even boots up.
// This prevents a blinding white flash of unstyled content on startup.
if (savedTheme === 'dark') {
  document.documentElement.classList.add('dark');
} else {
  document.documentElement.classList.remove('dark');
}

// Disable default browser context menu globally
document.addEventListener('contextmenu', (e) => {
  if (import.meta.env.PROD) {
    e.preventDefault();
  }
});

/**
 * Strips native HTML `title` attributes globally via a MutationObserver.
 *
 * We use a custom tooltip component for all hover states.
 * If native titles are left intact, the browser's ugly default yellow tooltip
 * will render directly over our styled tooltips, ruining the premium feel.
 */
function TitleAttributeGuard({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const clearTitles = (root: ParentNode) => {
      root.querySelectorAll?.('[title]').forEach((el) => el.removeAttribute('title'));
    };
    clearTitles(document);
    // Observer removes titles from dynamically added elements.
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          mutation.target.removeAttribute('title');
        }
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            node.removeAttribute('title');
            clearTitles(node);
          }
        });
      });
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['title'],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  return children;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <ConfigProvider>
        <StudioConnectionProvider>
          <ThemeProvider>
            <TitleAttributeGuard>
              <TooltipProvider>
                <main className="text-text-primary bg-bg-base min-h-screen h-full font-sans transition-colors duration-300">
                  <ErrorBoundary>
                    <App />
                    <Toast />
                  </ErrorBoundary>
                </main>
              </TooltipProvider>
            </TitleAttributeGuard>
          </ThemeProvider>
        </StudioConnectionProvider>
      </ConfigProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
