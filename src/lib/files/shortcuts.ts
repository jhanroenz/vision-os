/** Keyboard shortcut matching for the Files app. */

export type FileShortcutAction =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'rename'
  | 'selectAll'
  | 'refresh';

export const FILE_SHORTCUT_HINTS: Record<FileShortcutAction, string> = {
  copy: 'Ctrl+C',
  cut: 'Ctrl+X',
  paste: 'Ctrl+V',
  delete: 'Delete',
  rename: 'F2',
  selectAll: 'Ctrl+A',
  refresh: 'F5'
};

function hasModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey;
}

function isTypingTarget(target: EventTarget | null) {
  return Boolean(
    (target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')
  );
}

export function matchFileShortcut(
  event: KeyboardEvent,
  action: FileShortcutAction
): boolean {
  if (isTypingTarget(event.target)) return false;

  const key = event.key;

  switch (action) {
    case 'copy':
      return hasModifier(event) && key.toLowerCase() === 'c' && !event.altKey;
    case 'cut':
      return hasModifier(event) && key.toLowerCase() === 'x' && !event.altKey;
    case 'paste':
      return hasModifier(event) && key.toLowerCase() === 'v' && !event.altKey;
    case 'delete':
      return key === 'Delete' && !hasModifier(event) && !event.altKey;
    case 'rename':
      return key === 'F2' && !hasModifier(event);
    case 'selectAll':
      return hasModifier(event) && key.toLowerCase() === 'a' && !event.altKey;
    case 'refresh':
      return key === 'F5' && !hasModifier(event);
    default:
      return false;
  }
}

export function handleFileShortcuts(
  event: KeyboardEvent,
  handlers: Partial<Record<FileShortcutAction, () => void | Promise<void>>>,
  options?: { canCopy?: boolean; canCut?: boolean; canPaste?: boolean; canDelete?: boolean }
) {
  if (isTypingTarget(event.target)) return;

  const tryHandle = (
    action: FileShortcutAction,
    enabled = true
  ) => {
    if (!enabled || !matchFileShortcut(event, action)) return false;
    const handler = handlers[action];
    if (!handler) return false;
    event.preventDefault();
    event.stopPropagation();
    void handler();
    return true;
  };

  if (tryHandle('copy', options?.canCopy)) return;
  if (tryHandle('cut', options?.canCut)) return;
  if (tryHandle('paste', options?.canPaste)) return;
  if (tryHandle('delete', options?.canDelete)) return;
  if (tryHandle('rename')) return;
  if (tryHandle('selectAll')) return;
  if (tryHandle('refresh')) return;
}
