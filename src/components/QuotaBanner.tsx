import { quotaLevel, quotaRatio } from '../lib/quota';
import { t, tf } from '../i18n';

export function QuotaBanner() {
  if (quotaLevel.value === 'none') return null;
  const pct = Math.round(quotaRatio.value * 100);
  const msg = tf(quotaLevel.value === 'critical' ? t.value.msg.quotaCritical : t.value.msg.quotaWarn, { pct });
  return (
    <div class={`quota-banner quota-${quotaLevel.value}`} role="status" aria-live="polite">
      {msg}
    </div>
  );
}
