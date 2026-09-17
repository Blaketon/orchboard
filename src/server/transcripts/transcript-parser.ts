import type { TranscriptEntry, TranscriptPart } from '../../shared/api.ts';

export type { TranscriptEntry, TranscriptPart };

export const MAX_RESULT_CHARS = 2000;
export const MAX_SUMMARY_CHARS = 160;

/**
 * Turns Claude Code transcript lines (JSONL) into display entries.
 *
 * Claude Code writes each content block of an assistant turn (thinking, text, tool call) as its
 * own line sharing one message id; those are merged back into a single entry. System-injected
 * (`isMeta`) and subagent (`isSidechain`) lines, thinking blocks, and non-message line types are
 * left out.
 */
export function parseTranscript(lines: Iterable<string>, limit = 60): TranscriptEntry[] {
  const entries: { role: 'user' | 'assistant'; timestamp: string; parts: TranscriptPart[] }[] = [];
  let lastMessageId: string | undefined;

  for (const line of lines) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // A partially written last line, or noise.
    }
    if (!isRecord(record) || record.isMeta === true || record.isSidechain === true) continue;
    if (record.type !== 'user' && record.type !== 'assistant') continue;
    const message = record.message;
    if (!isRecord(message)) continue;

    const parts = extractParts(message.content);
    if (parts.length === 0) continue;

    const messageId = typeof message.id === 'string' ? message.id : undefined;
    const previous = entries.at(-1);
    if (record.type === 'assistant' && messageId && messageId === lastMessageId && previous) {
      previous.parts.push(...parts);
      continue;
    }

    lastMessageId = record.type === 'assistant' ? messageId : undefined;
    entries.push({
      role: record.type,
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
      parts,
    });
  }
  return entries.slice(-limit);
}

function extractParts(content: unknown): TranscriptPart[] {
  if (typeof content === 'string') {
    const text = content.trim();
    return text ? [{ type: 'text', text }] : [];
  }
  if (!Array.isArray(content)) return [];

  const parts: TranscriptPart[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push({ type: 'text', text: block.text.trim() });
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      parts.push({
        type: 'tool_call',
        id: typeof block.id === 'string' ? block.id : '',
        name: block.name,
        summary: summarizeToolInput(block.name, block.input),
      });
    } else if (block.type === 'tool_result') {
      parts.push({
        type: 'tool_result',
        toolUseId: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
        text: truncate(resultText(block.content), MAX_RESULT_CHARS),
        isError: block.is_error === true,
      });
    }
  }
  return parts;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!isRecord(item)) return '';
      if (item.type === 'text' && typeof item.text === 'string') return item.text;
      if (item.type === 'image') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** A one-line description of what a tool call does, e.g. the command or file path. */
export function summarizeToolInput(name: string, input: unknown): string {
  if (!isRecord(input)) return '';
  const field = (key: string): string => (typeof input[key] === 'string' ? input[key] : '');
  let summary: string;

  switch (name.toLowerCase()) {
    case 'bash':
    case 'powershell':
      summary = field('command');
      break;
    case 'read':
    case 'write':
    case 'edit':
    case 'notebookedit':
      summary = field('file_path') || field('notebook_path');
      break;
    case 'grep':
      summary = [field('pattern'), field('path')].filter(Boolean).join(' in ');
      break;
    case 'glob':
      summary = field('pattern');
      break;
    case 'webfetch':
      summary = field('url');
      break;
    case 'websearch':
      summary = field('query');
      break;
    case 'skill':
      summary = [field('skill'), field('args')].filter(Boolean).join(' ');
      break;
    case 'task':
    case 'agent':
      summary = field('description') || field('prompt');
      break;
    case 'todowrite':
      summary = Array.isArray(input.todos) ? `${input.todos.length} todo(s)` : '';
      break;
    case 'askuserquestion': {
      const first: unknown = Array.isArray(input.questions) ? input.questions[0] : undefined;
      summary = isRecord(first) && typeof first.question === 'string' ? first.question : '';
      break;
    }
    default:
      summary =
        Object.values(input).find(
          (value): value is string => typeof value === 'string' && !!value.trim(),
        ) ?? '';
  }
  return truncate(summary.replace(/\s+/g, ' ').trim(), MAX_SUMMARY_CHARS);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
