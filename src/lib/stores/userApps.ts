import { writable, get } from 'svelte/store';
import { listUserApps, syncUserApps, userAppToDefinition } from '$lib/api/userApps';
import type { AppDefinition, UserAppRecord } from '$lib/types';

interface UserAppsState {
  loaded: boolean;
  loading: boolean;
  apps: UserAppRecord[];
  error: string | null;
}

const internal = writable<UserAppsState>({
  loaded: false,
  loading: false,
  apps: [],
  error: null
});

function setState(patch: Partial<UserAppsState>) {
  internal.update((s) => ({ ...s, ...patch }));
}

export const userAppsStore = {
  subscribe: internal.subscribe,

  getApps(): UserAppRecord[] {
    return get(internal).apps;
  },

  getPublishedDefinitions(): AppDefinition[] {
    return get(internal)
      .apps.filter((a) => a.status === 'published')
      .map(userAppToDefinition);
  },

  getDraftDefinitions(): AppDefinition[] {
    return get(internal)
      .apps.filter((a) => a.status === 'draft')
      .map(userAppToDefinition);
  },

  findById(id: string): UserAppRecord | undefined {
    return get(internal).apps.find((a) => a.id === id);
  },

  async refresh(): Promise<void> {
    setState({ loading: true, error: null });
    try {
      const apps = await listUserApps();
      setState({ apps, loaded: true, loading: false });
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  },

  async sync(): Promise<void> {
    setState({ loading: true, error: null });
    try {
      await syncUserApps();
      const apps = await listUserApps();
      setState({ apps, loaded: true, loading: false });
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
};

export function loadUserApps(): Promise<void> {
  return userAppsStore.refresh();
}
