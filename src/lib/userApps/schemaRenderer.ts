import { getAppData, submitSchemaAction } from '$lib/api/userApps';

export interface SchemaBlock {
  type: string;
  label?: string;
  key?: string;
  field?: string;
  fields?: SchemaFormField[];
  action?: string;
  text?: string;
  title?: string;
  appId?: string;
  message?: string;
}

export interface SchemaFormField {
  name: string;
  label?: string;
  input?: 'text' | 'textarea' | 'number';
  default?: unknown;
}

export interface SchemaDocument {
  title?: string;
  blocks: SchemaBlock[];
}

export async function loadBlockValue(slug: string, key: string): Promise<unknown> {
  try {
    const row = await getAppData(slug, key);
    return row.value;
  } catch {
    return null;
  }
}

export async function submitFormBlock(
  slug: string,
  block: SchemaBlock,
  values: Record<string, unknown>
): Promise<unknown> {
  const action = block.action ?? 'save_form';
  return submitSchemaAction(slug, action, {
    key: block.key ?? 'formData',
    data: values
  });
}

export function formatStatValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
