const TYPE_LABELS: Record<string, string> = {
  turn_start: 'Turn start',
  turn_end: 'Turn end',
  agent_error: 'Agent error',
  llm_request: 'LLM request',
  llm_response: 'LLM response',
  tool_call: 'Tool call',
  tool_result: 'Tool result',
  tool_result_full: 'Tool result (full)',
  reasoning: 'Reasoning',
  reasoning_delta: 'Reasoning Δ',
  planning: 'Planning',
  planning_delta: 'Planning Δ',
  message: 'Reply',
  message_delta: 'Reply Δ',
  status: 'Status',
  coding_delegate_start: 'Delegate start',
  coding_delegate_end: 'Delegate end',
  coding_executor_reasoning_delta: 'Coder reasoning Δ',
  coding_executor_delta: 'Coder output Δ',
  coding_llm_request: 'Coder LLM request',
  workspace: 'Workspace',
  plan: 'Plan',
  verification: 'Verification',
  stack: 'Stack',
  context: 'Context',
  auto_compact: 'Auto compact',
  auto_reflect: 'Auto reflect',
  file_change: 'File change',
  file_open: 'File open',
  shell_start: 'Shell start',
  shell_output: 'Shell output',
  shell_done: 'Shell done'
};

const TYPE_GROUPS: Record<string, string> = {
  turn_start: 'turn',
  turn_end: 'turn',
  agent_error: 'system',
  llm_request: 'llm',
  llm_response: 'llm',
  tool_call: 'tool',
  tool_result: 'tool',
  tool_result_full: 'tool',
  reasoning: 'llm',
  reasoning_delta: 'llm',
  planning: 'llm',
  planning_delta: 'llm',
  message: 'stream',
  message_delta: 'stream',
  status: 'stream',
  coding_delegate_start: 'coding',
  coding_delegate_end: 'coding',
  coding_executor_reasoning_delta: 'coding',
  coding_executor_delta: 'coding',
  coding_llm_request: 'coding'
};

function preview(text: unknown, max = 120): string {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function transcriptTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type ?? 'event';
}

export function transcriptTypeGroup(type: string): string {
  return TYPE_GROUPS[type] ?? 'other';
}

export function transcriptEntrySummary(entry: {
  type?: string;
  data?: Record<string, unknown>;
}): string {
  const type = entry?.type ?? 'event';
  const data = entry?.data ?? {};

  switch (type) {
    case 'turn_start':
      return preview((data.message as string) ?? (data.data as { message?: string })?.message, 160);
    case 'turn_end':
      return String(data.status ?? (data.data as { status?: string })?.status ?? '');
    case 'llm_request':
      return `step ${data.step ?? '?'} · ${data.messageCount ?? (data.messages as unknown[])?.length ?? 0} messages → ${data.model ?? ''}`;
    case 'llm_response': {
      const assistant = data.assistantMessage as { tool_calls?: unknown[]; content?: string } | undefined;
      const tools = assistant?.tool_calls?.length ?? 0;
      const text = preview(data.reasoning ?? assistant?.content, 140);
      return tools
        ? `step ${data.step ?? '?'} · ${tools} tool call(s)${text ? ` · ${text}` : ''}`
        : `step ${data.step ?? '?'}${text ? ` · ${text}` : ''}`;
    }
    case 'tool_call':
      return `${data.name ?? '?'}(${preview(JSON.stringify(data.args ?? {}), 80)})`;
    case 'tool_result':
    case 'tool_result_full':
      return `${data.name ?? '?'} · ${preview(data.rawResult ?? data.content ?? data.displayResult, 160)}`;
    case 'coding_delegate_start':
    case 'coding_delegate_end':
      return `${data.targetFile ?? '?'} · ${data.status ?? 'started'}`;
    case 'coding_llm_request':
      return `${data.targetFile ?? ''} · ${(data.messages as unknown[])?.length ?? 0} messages`;
    case 'reasoning':
    case 'reasoning_delta':
      return preview(data.content ?? data.text, 160);
    case 'planning':
    case 'planning_delta':
      return preview(data.content ?? data.text, 160);
    case 'message':
      return preview(data.content, 180);
    case 'status':
      return preview(data.message ?? data.phase, 120);
    case 'coding_executor_reasoning_delta':
    case 'coding_executor_delta':
      return `${data.targetFile ?? ''} · ${preview(data.text, 100)}`;
    case 'agent_error':
      return preview(data.message, 160);
    default:
      return preview(JSON.stringify(data).slice(0, 200), 160);
  }
}

export function formatTranscriptTime(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  } catch {
    return iso;
  }
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function transcriptStreamLabel(
  type: string,
  chunkCount: number,
  streaming: boolean
): string {
  const base = transcriptTypeLabel(type).replace(' Δ', '');
  if (streaming) return `${base} · streaming`;
  if (chunkCount > 1) return `${base} · ${chunkCount} chunks`;
  return base;
}
