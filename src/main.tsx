import { render } from 'preact';
import { App } from './app';
import { t } from './i18n';
import './styles/reset.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/editor.css';
import './styles/components.css';

render(<App />, document.getElementById('app')!);

// PWA registration
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        if (confirm(t.value.msg.newVersion)) {
          // Tells the waiting SW to skipWaiting; the page reloads once it takes
          // control. A plain location.reload() would keep serving the old build.
          void updateSW(true);
        }
      },
    });
  }).catch(() => {
    // PWA not available in dev mode
  });
}
