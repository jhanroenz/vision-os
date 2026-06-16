import fs from 'node:fs/promises';
import {
  listConversations,
  createConversation,
  getConversationWithContext,
  deleteConversation,
  updateConversation,
  compactConversation,
  activateConversationContext
} from '../conversations.js';
import * as transcriptLog from '../transcriptLog.js';
import { json, jsonError, readJson } from '../http.js';

export async function list() {
  try {
    const conversations = await listConversations();
    return json({ conversations });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function create() {
  try {
    const conversation = await createConversation();
    const full = await getConversationWithContext(conversation.id);
    return json(full, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function get(id: string) {
  try {
    const conversation = await getConversationWithContext(id);
    if (!conversation) {
      return jsonError('Conversation not found', 404);
    }
    return json(conversation);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function activate(id: string) {
  try {
    const result = await activateConversationContext(id);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message, message === 'Conversation not found' ? 404 : 500);
  }
}

export async function patch(id: string, request: Request) {
  try {
    const { title, workspaceRoot } = await readJson(request);
    const conversation = await updateConversation(id, { title, workspaceRoot });
    const { serializeConversationWorkspace } = await import('../conversationWorkspace.js');
    return json({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      cwd: conversation.cwd,
      ...serializeConversationWorkspace(conversation)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message, message === 'Conversation not found' ? 404 : 400);
  }
}

export async function remove(id: string) {
  try {
    await deleteConversation(id);
    await transcriptLog.deleteTranscript(id);
    return json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function transcriptMeta(id: string) {
  try {
    const meta = await transcriptLog.getTranscriptMeta(id);
    return json(meta);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function transcript(id: string, url: URL) {
  try {
    const tail = Math.min(Math.max(Number(url.searchParams.get('tail') ?? 500), 1), 5000);
    const turnFile = url.searchParams.get('turnFile') ?? undefined;
    const data = await transcriptLog.readTranscript(id, { tail, turnFile });
    return json(data);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function transcriptDownload(id: string) {
  try {
    const meta = await transcriptLog.getTranscriptMeta(id);
    if (!meta.totalLines) {
      return jsonError('No transcript for this conversation', 404);
    }
    const raw = await fs.readFile(meta.path, 'utf-8');
    return new Response(raw, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="transcript-${id}.jsonl"`
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}

export async function compact(id: string) {
  try {
    const result = await compactConversation(id);
    if (!result.compacted) {
      return json({
        compacted: false,
        message: 'Not enough messages to compact yet',
        context: result.context
      });
    }
    return json({
      compacted: true,
      summary: result.summary,
      context: result.context,
      conversation: {
        id: result.conversation.id,
        title: result.conversation.title,
        compactSummary: result.conversation.compactSummary
      }
    });
  } catch (error) {
    console.error('Compact error:', error);
    return jsonError(error instanceof Error ? error.message : String(error));
  }
}
