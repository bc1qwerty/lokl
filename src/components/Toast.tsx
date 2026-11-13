import { toasts, dismiss } from '../lib/toast';
import { t as tr } from '../i18n';

export function ToastContainer() {
  return (
    <div class="toast-container" role="region" aria-live="polite" aria-label={tr.value.a11y.notifications}>
      {toasts.value.map(t => (
        <div class={`toast toast-${t.level}`} key={t.id} role="status">
          <span class="toast-message">{t.message}</span>
          {t.action && (
            <button
              class="toast-action"
              onClick={() => { t.action!.handler(); dismiss(t.id); }}
            >
              {t.action.label}
            </button>
          )}
          <button
            class="toast-dismiss"
            onClick={() => dismiss(t.id)}
            aria-label={tr.value.a11y.dismiss}
            title={tr.value.a11y.dismiss}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
