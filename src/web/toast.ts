import { el } from './dom.ts';

export type ToastKind = 'info' | 'success' | 'error';

let container: HTMLElement | undefined;

/** Shows a short message in the corner. Errors stay a little longer. */
export function showToast(message: string, kind: ToastKind = 'info', durationMs?: number): void {
  if (!container) {
    container = el('div', {
      className: 'toasts',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    document.body.append(container);
  }
  const toast = el('div', { className: 'toast', attrs: { 'data-kind': kind }, text: message });
  container.append(toast);
  window.setTimeout(
    () => {
      toast.remove();
    },
    durationMs ?? (kind === 'error' ? 8000 : 4000),
  );
}
