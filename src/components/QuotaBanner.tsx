import { quotaLevel, quotaRatio } from '../lib/quota';

export function QuotaBanner() {
  if (quotaLevel.value === 'none') return null;
  const pct = Math.round(quotaRatio.value * 100);
  const msg = quotaLevel.value === 'critical'
    ? `Storage ${pct}% full. Empty trash now to avoid save failures.`
    : `Storage ${pct}% full. Consider emptying trash.`;
  return (
    <div class={`quota-banner quota-${quotaLevel.value}`} role="status" aria-live="polite">
      {msg}
    </div>
  );
}
