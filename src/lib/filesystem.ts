/** @deprecated Import from `$lib/api/workspace` instead. */
export {
  WorkspaceFS,
  WorkspaceFS as FileSystem,
  normalizeWorkspacePath,
  joinWorkspacePath
} from '$lib/api/workspace';

export type {
  WorkspaceEntry,
  WorkspaceListing,
  WorkspaceFileData,
  WorkspaceStat
} from '$lib/api/workspace';
