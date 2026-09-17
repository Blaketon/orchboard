import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionUsage, Transcript, TranscriptPart } from '../../shared/api.ts';
import { MAX_RESULT_CHARS, MAX_SUMMARY_CHARS } from '../transcripts/transcript-parser.ts';
import { readTailLines } from '../transcripts/transcript-reader.ts';

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Record_ = Record<string, unknown>;

/**
 * Turns the lines of a Codex rollout file (`~/.codex/sessions/.../rollout-*.jsonl`) into
 * transcript entries and usage. Uses the model-facing `response_item` records: messages,
 * tool calls, and their outputs. Context Codex injects as user messages is left out.
 */
export function parseCodexRollout(lines: Iterable<string>, limit = 60): Transcript {
  const entries: { role: 'user' | 'assistant'; timestamp: string; parts: TranscriptPart[] }[] = [];
  let usage: SessionUsage | null = null;
  let model: string | null = null;

  const assistantEntry = (timestamp: string) => {
    const last = entries.at(-1);
    if (last?.role === 'assistant') return last;
    const entry = { role: 'assistant' as const, timestamp, parts: [] as TranscriptPart[] };
    entries.push(entry);
    return entry;
  };

  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record) || !isRecord(record.payload)) continue;
    const { payload } = record;
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : '';

    if (record.type === 'turn_context' && typeof payload.model === 'string') {
      model = payload.model;
      continue;
    }
    if (record.type === 'event_msg' && payload.type === 'token_count') {
      usage = tokenUsage(payload.info, model) ?? usage;
      continue;
    }
    if (record.type !== 'response_item') continue;

    switch (payload.type) {
      case 'message': {
        const texts = messageTexts(payload.content);
        if (payload.role === 'user') {
          if (!texts.length || texts.every(isInjectedContext)) continue;
          entries.push({
            role: 'user',
            timestamp,
            parts: [{ type: 'text', text: texts.join('\n\n') }],
          });
        } else if (payload.role === 'assistant' && texts.length) {
          assistantEntry(timestamp).parts.push({ type: 'text', text: texts.join('\n\n') });
        }
        break;
      }
      case 'function_call':
      case 'custom_tool_call':
      case 'local_shell_call': {
        const name = typeof payload.name === 'string' ? payload.name : 'shell';
        assistantEntry(timestamp).parts.push({
          type: 'tool_call',
          id: callId(payload),
          name,
          summary: summarizeCall(payload.arguments ?? payload.input ?? payload.action),
        });
        break;
      }
      case 'function_call_output':
      case 'custom_tool_call_output': {
        const text = outputText(payload.output);
        assistantEntry(timestamp).parts.push({
          type: 'tool_result',
          toolUseId: callId(payload),
          text: truncate(text, MAX_RESULT_CHARS),
          isError: false,
        });
        break;
      }
      default:
        break;
    }
  }

  return { entries: entries.slice(-limit), usage };
}

function messageTexts(content: unknown): string[] {
  if (typeof content === 'string') return content.trim() ? [content.trim()] : [];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (typeof item.text === 'string' && item.text.trim()) texts.push(item.text.trim());
    else if (item.type === 'input_image') texts.push('(image)');
  }
  return texts;
}

/** Codex adds its environment and instruction files to the conversation as user messages. */
function isInjectedContext(text: string): boolean {
  return (
    /^<[a-z_]+>/.test(text) || text.startsWith('# AGENTS.md instructions') || text === '(image)'
  );
}

function callId(payload: Record_): string {
  if (typeof payload.call_id === 'string') return payload.call_id;
  return typeof payload.id === 'string' ? payload.id : '';
}

function summarizeCall(value: unknown): string {
  let input: unknown = value;
  if (typeof value === 'string') {
    try {
      input = JSON.parse(value);
    } catch {
      input = value;
    }
  }
  if (isRecord(input)) {
    const command = input.command ?? input.cmd;
    if (Array.isArray(command)) input = command.join(' ');
    else if (typeof command === 'string') input = command;
  }
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return truncate(text.replace(/\s+/g, ' ').trim(), MAX_SUMMARY_CHARS);
}

function outputText(output: unknown): string {
  if (typeof output === 'string') {
    // Older rollouts wrap shell output as `{"output": "...", "metadata": {...}}`.
    try {
      const parsed: unknown = JSON.parse(output);
      if (isRecord(parsed) && typeof parsed.output === 'string') return parsed.output;
    } catch {
      // Plain text.
    }
    return output;
  }
  if (Array.isArray(output)) {
    return output
      .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function tokenUsage(info: unknown, model: string | null): SessionUsage | null {
  if (!isRecord(info) || !isRecord(info.total_token_usage)) return null;
  const total = info.total_token_usage;
  const last = isRecord(info.last_token_usage) ? info.last_token_usage : total;
  const cached = count(total.cached_input_tokens);
  return {
    tokens: {
      // OpenAI counts cached tokens as part of the input.
      input: Math.max(0, count(total.input_tokens) - cached),
      output: count(total.output_tokens),
      cacheCreation: count(total.cache_write_input_tokens),
      cacheRead: cached,
    },
    contextTokens: count(last.total_tokens),
    contextWindow: count(info.model_context_window),
    model,
    // Codex runs on a ChatGPT plan or API key; it doesn't record a cost.
    costUsd: null,
    costIsPartial: false,
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isRecord(value: unknown): value is Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Finds a thread's rollout file. Codex files them under `sessions/YYYY/MM/DD` for the local
 * date the thread started, with the thread id in the file name.
 */
export async function locateRollout(
  codexDir: string,
  threadId: string,
  startedAt: number,
): Promise<string | undefined> {
  if (!THREAD_ID.test(threadId)) return undefined;
  const sessions = path.join(codexDir, 'sessions');
  const day = 24 * 60 * 60 * 1000;
  // The day before and after cover time zone edges and threads started just before midnight.
  for (const time of [startedAt, startedAt - day, startedAt + day]) {
    const date = new Date(time);
    const dir = path.join(
      sessions,
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    );
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    const name = names.find((candidate) => candidate.endsWith(`${threadId}.jsonl`));
    if (name) return path.join(dir, name);
  }
  return undefined;
}

export async function readCodexTranscript(file: string | undefined): Promise<Transcript> {
  if (!file) return { entries: [], usage: null };
  try {
    return parseCodexRollout(await readTailLines(file));
  } catch {
    return { entries: [], usage: null };
  }
}
