/** Short previews for the chat activity panel (matches transcript summaries). */

export function truncateActivity(text: unknown, max = 120): string {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function formatToolCallActivity(name: string, args: Record<string, unknown> = {}): string {
  const path =
    args.path ?? args.file_path ?? args.target_file ?? args.filePath ?? args.pattern ?? args.glob_pattern;
  const command = args.command ?? args.cmd;
  const query = args.query ?? args.search_term ?? args.searchTerm ?? args.contents;

  if (typeof path === 'string' && path.trim()) {
    return `${name}: ${truncateActivity(path)}`;
  }
  if (typeof command === 'string' && command.trim()) {
    return `${name}: ${truncateActivity(command)}`;
  }
  if (typeof query === 'string' && query.trim()) {
    return `${name}: ${truncateActivity(query)}`;
  }

  const keys = Object.keys(args);
  if (keys.length === 0) return name;
  const preview = truncateActivity(JSON.stringify(args), 100);
  return preview ? `${name} · ${preview}` : name;
}

export function formatToolResultActivity(
  name: string,
  content?: unknown,
  resultSummary?: Record<string, unknown>
): string {
  const summary = resultSummary ?? {};
  const raw =
    content ??
    summary.displayOutput ??
    summary.stderr ??
    summary.displayResult ??
    summary.rawResult ??
    '';
  const text = truncateActivity(String(raw ?? '').trim(), 140);
  if (text) return `${name}: ${text}`;
  if (summary.success === false) return `${name}: failed`;
  return `${name}: done`;
}

export function formatReasoningActivity(text: string): string {
  const preview = truncateActivity(text.replace(/\s+/g, ' ').trim(), 140);
  return preview ? `Thinking: ${preview}` : 'Thinking…';
}
