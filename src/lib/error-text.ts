import { t, tf } from '../i18n';

// Errors this app throws itself carry a code, so what reaches a toast is in the user's language —
// the English message stays for the console.
export type AppErrorCode = 'DEST_EXISTS' | 'SOURCE_MISSING' | 'NAME_TAKEN' | 'BACKUP_INVALID' | 'BACKUP_BAD_NOTE';

export function appError(code: AppErrorCode, message: string, name?: string): Error {
  return Object.assign(new Error(message), { code, noteName: name });
}

/** What to show for a caught error. */
export function errorText(e: unknown): string {
  const err = e as { code?: string; noteName?: string; message?: string } | null | undefined;
  const m = t.value.msg;
  if (err?.code === 'DEST_EXISTS') return m.errDestExists;
  if (err?.code === 'SOURCE_MISSING') return m.errSourceMissing;
  if (err?.code === 'NAME_TAKEN') return tf(m.errNameTaken, { name: err.noteName ?? '' });
  if (err?.code === 'BACKUP_INVALID') return m.errBackupInvalid;
  if (err?.code === 'BACKUP_BAD_NOTE') return tf(m.errBackupBadNote, { name: err.noteName ?? '?' });
  return err?.message ?? m.unknownError;
}
