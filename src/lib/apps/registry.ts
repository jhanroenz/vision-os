import type { AppDefinition } from '$lib/types';
import WelcomeApp from '$lib/components/apps/WelcomeApp.svelte';
import CalculatorApp from '$lib/components/apps/CalculatorApp.svelte';
import NotepadApp from '$lib/components/apps/NotepadApp.svelte';
import PaintApp from '$lib/components/apps/PaintApp.svelte';
import FilesApp from '$lib/components/apps/FilesApp.svelte';
import TerminalApp from '$lib/components/apps/TerminalApp.svelte';
import ClockApp from '$lib/components/apps/ClockApp.svelte';
import SettingsApp from '$lib/components/apps/SettingsApp.svelte';
import SnakeApp from '$lib/components/apps/SnakeApp.svelte';
import TodoApp from '$lib/components/apps/TodoApp.svelte';
import BrowserApp from '$lib/components/apps/BrowserApp.svelte';
import CalendarApp from '$lib/components/apps/CalendarApp.svelte';
import AboutApp from '$lib/components/apps/AboutApp.svelte';
import { windows } from '$lib/stores/windows';

export const APPS: AppDefinition[] = [
  {
    id: 'welcome',
    name: 'Welcome',
    icon: '✦',
    defaultWidth: 560,
    defaultHeight: 420,
    component: WelcomeApp
  },
  {
    id: 'calculator',
    name: 'Calculator',
    icon: '🔢',
    defaultWidth: 320,
    defaultHeight: 480,
    component: CalculatorApp
  },
  {
    id: 'notepad',
    name: 'Notepad',
    icon: '📝',
    defaultWidth: 600,
    defaultHeight: 450,
    component: NotepadApp
  },
  {
    id: 'paint',
    name: 'Paint',
    icon: '🎨',
    defaultWidth: 700,
    defaultHeight: 500,
    component: PaintApp
  },
  {
    id: 'files',
    name: 'Files',
    icon: '📁',
    defaultWidth: 650,
    defaultHeight: 420,
    component: FilesApp
  },
  {
    id: 'terminal',
    name: 'Terminal',
    icon: '💻',
    defaultWidth: 620,
    defaultHeight: 400,
    component: TerminalApp
  },
  {
    id: 'clock',
    name: 'Clock',
    icon: '🕐',
    defaultWidth: 380,
    defaultHeight: 420,
    component: ClockApp
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: '⚙',
    defaultWidth: 900,
    defaultHeight: 640,
    component: SettingsApp
  },
  {
    id: 'snake',
    name: 'Snake',
    icon: '🐍',
    defaultWidth: 420,
    defaultHeight: 500,
    component: SnakeApp
  },
  {
    id: 'todo',
    name: 'Tasks',
    icon: '✅',
    defaultWidth: 400,
    defaultHeight: 480,
    component: TodoApp
  },
  {
    id: 'browser',
    name: 'Browser',
    icon: '🌐',
    defaultWidth: 800,
    defaultHeight: 520,
    component: BrowserApp
  },
  {
    id: 'calendar',
    name: 'Calendar',
    icon: '📅',
    defaultWidth: 420,
    defaultHeight: 460,
    component: CalendarApp
  },
  {
    id: 'about',
    name: 'About',
    icon: '◎',
    defaultWidth: 400,
    defaultHeight: 340,
    component: AboutApp
  }
];

export function getAppById(id: string): AppDefinition | undefined {
  return APPS.find((a) => a.id === id);
}

export function openApp(appId: string, options?: { props?: Record<string, unknown>; title?: string }) {
  const app = getAppById(appId);
  if (!app) return;
  windows.open({
    appId: app.id,
    title: options?.title ?? app.name,
    width: app.defaultWidth,
    height: app.defaultHeight,
    props: options?.props
  });
}

export function openNotepad(filePath?: string) {
  const app = getAppById('notepad');
  if (!app) return;
  const title = filePath ? `${filePath.split('/').pop()} - Notepad` : 'Notepad';
  windows.open({
    appId: 'notepad',
    title,
    width: app.defaultWidth,
    height: app.defaultHeight,
    props: filePath ? { filePath } : undefined
  });
}

export function openFiles(startPath = '.') {
  const app = getAppById('files');
  if (!app) return;
  windows.open({
    appId: 'files',
    title: 'Files',
    width: app.defaultWidth,
    height: app.defaultHeight,
    props: { startPath }
  });
}
