import { signal } from '@preact/signals';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  level: ToastLevel;
  message: string;
  action?: { label: string; handler: () => void };
  ttl?: number;  // ms; undefined = sticky (no auto-dismiss)
}

export const toasts = signal<ToastItem[]>([]);

let seq = 0;

function push(level: ToastLevel, message: string, opts?: Pick<ToastItem, 'action' | 'ttl'>) {
  const id = `t-${++seq}`;
  const ttl = opts?.ttl ?? (level === 'error' ? undefined : 4000);
  toasts.value = [...toasts.value, { id, level, message, action: opts?.action, ttl }];
  if (ttl !== undefined) {
    setTimeout(() => dismiss(id), ttl);
  }
  return id;
}

export function dismiss(id: string): void {
  toasts.value = toasts.value.filter(t => t.id !== id);
}

export const toast = {
  info:    (m: string, o?: Pick<ToastItem, 'action' | 'ttl'>) => push('info', m, o),
  success: (m: string, o?: Pick<ToastItem, 'action' | 'ttl'>) => push('success', m, o),
  warning: (m: string, o?: Pick<ToastItem, 'action' | 'ttl'>) => push('warning', m, o),
  error:   (m: string, o?: Pick<ToastItem, 'action' | 'ttl'>) => push('error', m, o),
};
