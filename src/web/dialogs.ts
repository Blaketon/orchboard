import { el } from './dom.ts';

export interface FormField {
  readonly name: string;
  readonly label: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly maxLength?: number;
}

/**
 * Shows a small modal form and resolves with the entered values, or null if cancelled.
 * `submit` may throw to keep the form open and show the error.
 */
export function formDialog(options: {
  readonly title: string;
  readonly fields: readonly FormField[];
  readonly submitLabel: string;
  readonly submit: (values: Record<string, string>) => Promise<void>;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const inputs = options.fields.map((field) =>
      el('input', {
        className: 'field-input',
        attrs: {
          name: field.name,
          autocomplete: 'off',
          ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          ...(field.required ? { required: '' } : {}),
          ...(field.maxLength ? { maxlength: String(field.maxLength) } : {}),
        },
      }),
    );
    inputs.forEach((input, i) => {
      input.value = options.fields[i]?.value ?? '';
    });

    const error = el('p', { className: 'form-error', attrs: { role: 'alert' } });
    error.hidden = true;
    const submit = el('button', {
      className: 'button button-primary',
      text: options.submitLabel,
      attrs: { type: 'submit' },
    });
    const cancel = el('button', { className: 'button', text: 'Cancel', attrs: { type: 'button' } });
    const form = el('form', { className: 'form' }, [
      el('h2', { className: 'form-title', text: options.title }),
      ...options.fields.map((field, i) =>
        el('label', { className: 'field' }, [
          el('span', { className: 'field-label', text: field.label }),
          inputs[i],
        ]),
      ),
      error,
      el('div', { className: 'form-actions' }, [cancel, submit]),
    ]);
    const dialog = el('dialog', { className: 'modal modal-small' }, [form]);
    document.body.append(dialog);

    let succeeded = false;
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(succeeded);
    });
    cancel.addEventListener('click', () => {
      dialog.close();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = Object.fromEntries(
        options.fields.map((field, i) => [field.name, inputs[i]?.value.trim() ?? '']),
      );
      submit.disabled = true;
      error.hidden = true;
      options
        .submit(values)
        .then(() => {
          succeeded = true;
          dialog.close();
        })
        .catch((caught: unknown) => {
          error.textContent = caught instanceof Error ? caught.message : String(caught);
          error.hidden = false;
        })
        .finally(() => {
          submit.disabled = false;
        });
    });

    dialog.showModal();
    inputs[0]?.focus();
  });
}

/** Asks for confirmation before something destructive. */
export function confirmDialog(options: {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const confirm = el('button', {
      className: 'button button-danger-solid',
      text: options.confirmLabel,
      attrs: { type: 'button' },
    });
    const cancel = el('button', { className: 'button', text: 'Cancel', attrs: { type: 'button' } });
    const dialog = el('dialog', { className: 'modal modal-small' }, [
      el('div', { className: 'form' }, [
        el('h2', { className: 'form-title', text: options.title }),
        el('p', { className: 'form-message', text: options.message }),
        el('div', { className: 'form-actions' }, [cancel, confirm]),
      ]),
    ]);
    document.body.append(dialog);

    let confirmed = false;
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(confirmed);
    });
    cancel.addEventListener('click', () => {
      dialog.close();
    });
    confirm.addEventListener('click', () => {
      confirmed = true;
      dialog.close();
    });
    dialog.showModal();
    cancel.focus();
  });
}
