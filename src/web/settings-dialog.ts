import { el } from './dom.ts';
import type { Settings, SettingsStore, ThemeChoice } from './settings-store.ts';
import { playChime } from './sound.ts';
import { showToast } from './toast.ts';

/** The settings window: appearance, notifications, and sound. */
export function createSettingsDialog(store: SettingsStore): { open(): void } {
  const checkbox = (key: keyof Settings, label: string, hint?: string) => {
    const input = el('input', { attrs: { type: 'checkbox' } });
    input.addEventListener('change', () => {
      store.update({ [key]: input.checked });
    });
    store.subscribe((settings) => {
      input.checked = settings[key] === true;
    });
    return el('label', { className: 'check' }, [
      input,
      el('span', {}, [label, hint ? el('span', { className: 'check-hint', text: hint }) : null]),
    ]);
  };

  const themeOptions: readonly { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  const themeInputs = themeOptions.map(({ value, label }) => {
    const input = el('input', { attrs: { type: 'radio', name: 'theme', value } });
    input.addEventListener('change', () => {
      if (input.checked) store.update({ theme: value });
    });
    return {
      value,
      element: el('label', { className: 'check' }, [input, el('span', { text: label })]),
      input,
    };
  });

  const toastSeconds = el('input', {
    className: 'field-input field-narrow',
    attrs: { type: 'number', min: '2', max: '60', step: '1' },
  });
  toastSeconds.addEventListener('change', () => {
    store.update({ toastSeconds: Number(toastSeconds.value) });
  });

  const volume = el('input', {
    attrs: { id: 'settings-volume', type: 'range', min: '0', max: '1', step: '0.05' },
  });
  volume.addEventListener('input', () => {
    store.update({ volume: Number(volume.value) });
  });

  const desktop = checkbox(
    'desktopNotifications',
    'System notifications',
    'When the dashboard tab is in the background',
  );
  const desktopInput = desktop.querySelector('input');
  desktopInput?.addEventListener('change', () => {
    if (!desktopInput.checked) return;
    if (!('Notification' in window)) {
      showToast('This browser does not support system notifications.', 'error');
      store.update({ desktopNotifications: false });
      return;
    }
    void Notification.requestPermission().then((permission) => {
      if (permission !== 'granted') {
        showToast('Notifications are blocked for this site in your browser settings.', 'error');
        store.update({ desktopNotifications: false });
      }
    });
  });

  store.subscribe((settings) => {
    for (const option of themeInputs) option.input.checked = option.value === settings.theme;
    toastSeconds.value = String(settings.toastSeconds);
    volume.value = String(settings.volume);
  });

  const section = (title: string, children: readonly HTMLElement[]) =>
    el('fieldset', { className: 'settings-section' }, [el('legend', { text: title }), ...children]);

  const close = el('button', { className: 'button', text: 'Done', attrs: { type: 'button' } });
  const dialog = el(
    'dialog',
    { className: 'modal', attrs: { 'aria-labelledby': 'settings-title' } },
    [
      el('div', { className: 'form' }, [
        el('h2', { className: 'form-title', text: 'Settings', attrs: { id: 'settings-title' } }),
        section('Appearance', [
          el(
            'div',
            { className: 'check-row' },
            themeInputs.map((option) => option.element),
          ),
        ]),
        section('Notifications', [
          checkbox('toastOnDone', 'When an agent completes'),
          checkbox('toastOnBlocked', 'When an agent needs input'),
          desktop,
          el('label', { className: 'field field-inline' }, [
            el('span', {
              className: 'field-label',
              text: 'Keep notifications on screen for (seconds)',
            }),
            toastSeconds,
          ]),
        ]),
        section('Usage limits', [
          checkbox('showUsage', 'Show Claude and Codex plan limits in the sidebar'),
          checkbox('usageAlerts', 'Notify when a limit reaches 90% or resets'),
        ]),
        section('Sound', [
          checkbox('soundOnDone', 'Chime when an agent completes'),
          checkbox('soundOnBlocked', 'Chime when an agent needs input'),
          // A div, not a label: the Test button must not also activate the slider.
          el('div', { className: 'field field-inline' }, [
            el('label', {
              className: 'field-label',
              text: 'Volume',
              attrs: { for: 'settings-volume' },
            }),
            volume,
            el('button', {
              className: 'button button-small',
              text: 'Test',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  playChime('done', store.get().volume);
                },
              },
            }),
          ]),
        ]),
        el('div', { className: 'form-actions' }, [close]),
      ]),
    ],
  );
  document.body.append(dialog);
  close.addEventListener('click', () => {
    dialog.close();
  });

  return {
    open() {
      dialog.showModal();
    },
  };
}
