import { derived, get, writable } from 'svelte/store';

export interface PromptOptions {
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface AlertOptions {
  title?: string;
  message: string;
  okLabel?: string;
}

type DialogState =
  | {
      type: 'prompt';
      title: string;
      message?: string;
      label: string;
      defaultValue: string;
      placeholder?: string;
      confirmLabel: string;
      cancelLabel: string;
      resolve: (value: string | null) => void;
    }
  | {
      type: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel: string;
      destructive: boolean;
      resolve: (value: boolean) => void;
    }
  | {
      type: 'alert';
      title: string;
      message: string;
      okLabel: string;
      resolve: () => void;
    };

const current = writable<DialogState | null>(null);

export const dialogState = { subscribe: current.subscribe };

export const dialogOpen = derived(current, ($dialog) => $dialog !== null);

export function isDialogOpen() {
  return get(current) !== null;
}

function closeDialog() {
  current.set(null);
}

export function dialogPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    current.set({
      type: 'prompt',
      title: options.title,
      message: options.message,
      label: options.label ?? 'Name',
      defaultValue: options.defaultValue ?? '',
      placeholder: options.placeholder,
      confirmLabel: options.confirmLabel ?? 'OK',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      resolve: (value) => {
        closeDialog();
        resolve(value);
      }
    });
  });
}

export function dialogConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    current.set({
      type: 'confirm',
      title: options.title ?? 'Confirm',
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'OK',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      destructive: options.destructive ?? false,
      resolve: (value) => {
        closeDialog();
        resolve(value);
      }
    });
  });
}

export function dialogAlert(options: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    current.set({
      type: 'alert',
      title: options.title ?? 'Notice',
      message: options.message,
      okLabel: options.okLabel ?? 'OK',
      resolve: () => {
        closeDialog();
        resolve();
      }
    });
  });
}

export function dialogCancel() {
  const dialog = get(current);
  if (!dialog) return;
  if (dialog.type === 'prompt') dialog.resolve(null);
  else if (dialog.type === 'confirm') dialog.resolve(false);
  else dialog.resolve();
}

export function dialogSubmitPrompt(value: string) {
  const dialog = get(current);
  if (dialog?.type !== 'prompt') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  dialog.resolve(trimmed);
}

export function dialogSubmitConfirm() {
  const dialog = get(current);
  if (dialog?.type !== 'confirm') return;
  dialog.resolve(true);
}

export function dialogSubmitAlert() {
  const dialog = get(current);
  if (dialog?.type !== 'alert') return;
  dialog.resolve();
}
