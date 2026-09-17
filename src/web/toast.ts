import { el } from './dom.ts';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  readonly durationMs?: number;
  /** Makes the toast a button, e.g. to open the agent it is about. */
  readonly onClick?: () => void;
}

let container: HTMLElement | undefined;

/** Shows a short message in the corner. Errors stay a little longer by default. */
export function showToast(
  message: string,
  kind: ToastKind = 'info',
  options: ToastOptions = {},
): void {
  if (!container) {
    container = el('div', {
      className: 'toasts',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    document.body.append(container);
  }
  const { onClick } = options;
  const toast = onClick
    ? el('button', {
        className: 'toast toast-button',
        text: message,
        attrs: { type: 'button', 'data-kind': kind },
        on: {
          click: () => {
            toast.remove();
            onClick();
          },
        },
      })
    : el('div', { className: 'toast', attrs: { 'data-kind': kind }, text: message });
  container.append(toast);
  window.setTimeout(
    () => {
      toast.remove();
    },
    options.durationMs ?? (kind === 'error' ? 8000 : 4000),
  );
}
