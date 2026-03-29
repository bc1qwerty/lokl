import { render } from 'preact';
import { App } from './app';
import './styles/reset.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/editor.css';
import './styles/components.css';

render(<App />, document.getElementById('app')!);

// PWA registration
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      onNeedRefresh() {
        if (confirm('New version available. Reload?')) {
          window.location.reload();
        }
      },
    });
  }).catch(() => {
    // PWA not available in dev mode
  });
}
