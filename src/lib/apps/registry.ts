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
import ChatApp from '$lib/components/apps/ChatApp.svelte';
import ResearchApp from '$lib/components/apps/ResearchApp.svelte';
import ResearchImageViewerApp from '$lib/components/apps/ResearchImageViewerApp.svelte';
import ResearchVideoPlayerApp from '$lib/components/apps/ResearchVideoPlayerApp.svelte';
import ConversationApp from '$lib/components/apps/ConversationApp.svelte';
import ConversationWorkspaceApp from '$lib/components/apps/ConversationWorkspaceApp.svelte';
import ConversationTranscriptApp from '$lib/components/apps/ConversationTranscriptApp.svelte';
import { windows } from '$lib/stores/windows';
import type { ResearchMediaAsset } from '$lib/api/research';

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
    id: 'chat',
    name: 'Chat',
    icon: '💬',
    defaultWidth: 780,
    defaultHeight: 520,
    component: ChatApp
  },
  {
    id: 'research',
    name: 'Research',
    icon: '🔎',
    defaultWidth: 980,
    defaultHeight: 640,
    component: ResearchApp
  },
  {
    id: 'researchImageViewer',
    name: 'Image Viewer',
    icon: '🖼️',
    launcher: false,
    defaultWidth: 900,
    defaultHeight: 640,
    component: ResearchImageViewerApp
  },
  {
    id: 'researchVideoPlayer',
    name: 'Video Player',
    icon: '🎬',
    launcher: false,
    defaultWidth: 980,
    defaultHeight: 680,
    component: ResearchVideoPlayerApp
  },
  {
    id: 'conversation',
    name: 'Conversation',
    icon: '🗨️',
    launcher: false,
    defaultWidth: 760,
    defaultHeight: 560,
    component: ConversationApp
  },
  {
    id: 'conversationWorkspace',
    name: 'Workspace',
    icon: '📂',
    launcher: false,
    defaultWidth: 680,
    defaultHeight: 480,
    component: ConversationWorkspaceApp
  },
  {
    id: 'conversationTranscript',
    name: 'Transcript',
    icon: '📜',
    launcher: false,
    defaultWidth: 760,
    defaultHeight: 520,
    component: ConversationTranscriptApp
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
  if (appId === 'chat') {
    openChat(options?.props?.initialConversationId as string | undefined);
    return;
  }
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

export function openChat(conversationId?: string) {
  const app = getAppById('chat');
  if (!app) return;
  const id = normalizeConversationId(conversationId);
  windows.open({
    id: 'chat-main',
    appId: 'chat',
    title: 'Chat',
    width: app.defaultWidth,
    height: app.defaultHeight,
    props: id ? { initialConversationId: id } : undefined
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

function normalizeConversationId(conversationId: unknown): string {
  if (typeof conversationId === 'string') return conversationId;
  if (conversationId == null) return '';
  return String(conversationId);
}

export function openConversation(conversationId: string) {
  const id = normalizeConversationId(conversationId);
  if (!id) return;
  openChat(id);
}

export function openConversationWorkspace(conversationId: string) {
  const app = getAppById('conversationWorkspace');
  if (!app) return;
  const id = normalizeConversationId(conversationId);
  if (!id) return;
  windows.open({
    id: `conversation-workspace-${id}`,
    appId: 'conversationWorkspace',
    title: `Workspace ${id.slice(0, 8)}`,
    width: app.defaultWidth,
    height: app.defaultHeight,
    props: { conversationId: id }
  });
}

export function openConversationTranscript(conversationId: string) {
  const app = getAppById('conversationTranscript');
  if (!app) return;
  const id = normalizeConversationId(conversationId);
  if (!id) return;
  windows.open({
    id: `conversation-transcript-${id}`,
    appId: 'conversationTranscript',
    title: `Transcript ${id.slice(0, 8)}`,
    width: app.defaultWidth,
    height: app.defaultHeight,
    props: { conversationId: id }
  });
}

export function openResearchImageViewer(mediaItems: ResearchMediaAsset[], index: number) {
  const app = getAppById('researchImageViewer');
  if (!app) return;
  windows.open({
    appId: app.id,
    title: 'Image Viewer',
    width: app.defaultWidth,
    height: app.defaultHeight,
    props: { mediaItems, index }
  });
}

export function openResearchVideoPlayer(media: ResearchMediaAsset) {
  const app = getAppById('researchVideoPlayer');
  if (!app) return;
  windows.open({
    appId: app.id,
    title: media.title ? `Video Player - ${media.title}` : 'Video Player',
    width: app.defaultWidth,
    height: app.defaultHeight,
    props: { media }
  });
}
