import type { Approval, ApprovalDecision } from '../../shared/api.ts';
import type { ServerRequest } from './app-server.ts';

/** What Codex reported about an item it started, used to explain approval requests. */
export interface ItemInfo {
  readonly command?: string;
  readonly files?: readonly string[];
}

type Params = Record<string, unknown>;

/**
 * Describes a request from Codex that needs the user, or returns undefined for requests
 * Orchboard doesn't handle (which the caller rejects right away).
 */
export function describeRequest(
  request: ServerRequest,
  items: ReadonlyMap<string, ItemInfo> = new Map(),
): Approval | undefined {
  const params: Params = isRecord(request.params) ? request.params : {};
  const id = String(request.id);
  const reason = text(params.reason) || null;
  const item = items.get(text(params.itemId));

  switch (request.method) {
    case 'item/commandExecution/requestApproval':
      return {
        id,
        kind: 'command',
        title: 'Run a command',
        detail:
          params.command === undefined || params.command === null
            ? (item?.command ?? '')
            : text(params.command),
        reason,
        canAllowForSession: true,
        declineOnly: false,
      };
    case 'execCommandApproval':
      return {
        id,
        kind: 'command',
        title: 'Run a command',
        detail: Array.isArray(params.command) ? params.command.map(String).join(' ') : '',
        reason,
        canAllowForSession: true,
        declineOnly: false,
      };
    case 'item/fileChange/requestApproval':
      return {
        id,
        kind: 'fileChange',
        title: 'Change files',
        detail: item?.files?.join('\n') ?? text(params.grantRoot),
        reason,
        canAllowForSession: true,
        declineOnly: false,
      };
    case 'applyPatchApproval':
      return {
        id,
        kind: 'fileChange',
        title: 'Change files',
        detail: isRecord(params.fileChanges) ? Object.keys(params.fileChanges).join('\n') : '',
        reason,
        canAllowForSession: true,
        declineOnly: false,
      };
    case 'item/permissions/requestApproval':
      return {
        id,
        kind: 'permissions',
        title: 'Grant extra permissions',
        detail: describePermissions(params.permissions),
        reason,
        canAllowForSession: true,
        declineOnly: false,
      };
    case 'item/tool/requestUserInput':
      return {
        id,
        kind: 'question',
        title: 'Answer a question',
        detail: Array.isArray(params.questions)
          ? params.questions
              .map((question) => (isRecord(question) ? text(question.question) : ''))
              .filter(Boolean)
              .join('\n')
          : '',
        reason: null,
        canAllowForSession: false,
        declineOnly: true,
      };
    case 'mcpServer/elicitation/request':
      return {
        id,
        kind: 'question',
        title: `Respond to ${text(params.serverName) || 'an MCP server'}`,
        detail: text(params.message),
        reason: null,
        canAllowForSession: false,
        declineOnly: true,
      };
    default:
      return undefined;
  }
}

/** The JSON-RPC reply for a decision: a result, or an error message to send instead. */
export function approvalResponse(
  request: ServerRequest,
  decision: ApprovalDecision,
): { readonly result: unknown } | { readonly error: string } {
  const accept = decision !== 'decline';
  const forSession = decision === 'acceptForSession';
  const params: Params = isRecord(request.params) ? request.params : {};

  switch (request.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { result: { decision } };
    case 'execCommandApproval':
    case 'applyPatchApproval':
      return {
        result: {
          decision: !accept
            ? { denied: { rejection: 'Declined in Orchboard.' } }
            : forSession
              ? 'approved_for_session'
              : 'approved',
        },
      };
    case 'item/permissions/requestApproval':
      return {
        result: {
          permissions: accept ? grantedPermissions(params.permissions) : {},
          scope: forSession ? 'session' : 'turn',
        },
      };
    case 'mcpServer/elicitation/request':
      return { result: { action: 'decline', content: null, _meta: null } };
    default:
      return { error: 'Declined in Orchboard.' };
  }
}

function describePermissions(value: unknown): string {
  if (!isRecord(value)) return '';
  const lines: string[] = [];
  if (isRecord(value.network) && value.network.enabled === true) lines.push('Network access');
  if (isRecord(value.fileSystem)) {
    for (const [key, label] of [
      ['read', 'Read'],
      ['write', 'Write'],
    ] as const) {
      const paths = value.fileSystem[key];
      if (Array.isArray(paths)) for (const entry of paths) lines.push(`${label}: ${String(entry)}`);
    }
  }
  return lines.join('\n');
}

/** Grants exactly what was requested, leaving out the parts that were not. */
function grantedPermissions(value: unknown): Params {
  if (!isRecord(value)) return {};
  const granted: Params = {};
  if (isRecord(value.network)) granted.network = value.network;
  if (isRecord(value.fileSystem)) granted.fileSystem = value.fileSystem;
  return granted;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Params {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
