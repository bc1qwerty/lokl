import { signal } from '@preact/signals';

export type QuotaLevel = 'none' | 'warning' | 'critical';

export const quotaRatio = signal<number>(0);
export const quotaLevel = signal<QuotaLevel>('none');

export function ratioToLevel(r: number): QuotaLevel {
  if (r > 0.95) return 'critical';
  if (r > 0.8)  return 'warning';
  return 'none';
}

export async function checkQuota(): Promise<void> {
  if (!navigator.storage?.estimate) return;
  try {
    const { usage = 0, quota = 1 } = await navigator.storage.estimate();
    const r = quota > 0 ? usage / quota : 0;
    quotaRatio.value = r;
    quotaLevel.value = ratioToLevel(r);
  } catch {
    // ignore — quota.estimate can fail in some private modes
  }
}

const ONE_HOUR = 60 * 60 * 1000;

export function startQuotaMonitor(intervalMs: number = ONE_HOUR): () => void {
  checkQuota();
  const id = setInterval(() => { checkQuota(); }, intervalMs);
  return () => clearInterval(id);
}
