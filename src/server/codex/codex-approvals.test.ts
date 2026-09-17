import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { approvalResponse, describeRequest } from './codex-approvals.ts';

describe('describeRequest', () => {
  it('describes a command approval', () => {
    assert.deepEqual(
      describeRequest({
        id: 7,
        method: 'item/commandExecution/requestApproval',
        params: { itemId: 'i1', command: 'npm install', reason: 'Needs network access' },
      }),
      {
        id: '7',
        kind: 'command',
        title: 'Run a command',
        detail: 'npm install',
        reason: 'Needs network access',
        canAllowForSession: true,
        declineOnly: false,
      },
    );
  });

  it('lists the files of a file change from the item Codex started', () => {
    const approval = describeRequest(
      { id: 'a', method: 'item/fileChange/requestApproval', params: { itemId: 'i2' } },
      new Map([['i2', { files: ['src/app.ts', 'README.md'] }]]),
    );
    assert.equal(approval?.detail, 'src/app.ts\nREADME.md');
    assert.equal(approval.reason, null);
  });

  it('describes permission requests and questions', () => {
    const permissions = describeRequest({
      id: 1,
      method: 'item/permissions/requestApproval',
      params: {
        permissions: { network: { enabled: true }, fileSystem: { read: null, write: ['/tmp'] } },
      },
    });
    assert.equal(permissions?.detail, 'Network access\nWrite: /tmp');

    const question = describeRequest({
      id: 2,
      method: 'item/tool/requestUserInput',
      params: { questions: [{ id: 'q', question: 'Which database?' }] },
    });
    assert.equal(question?.detail, 'Which database?');
    assert.equal(question.declineOnly, true);
  });

  it('ignores requests Orchboard does not handle', () => {
    assert.equal(describeRequest({ id: 3, method: 'item/tool/call', params: {} }), undefined);
  });
});

describe('approvalResponse', () => {
  const request = (method: string, params: object = {}) => ({ id: 1, method, params });

  it('answers current and legacy approval requests in their own format', () => {
    assert.deepEqual(
      approvalResponse(request('item/commandExecution/requestApproval'), 'acceptForSession'),
      { result: { decision: 'acceptForSession' } },
    );
    assert.deepEqual(approvalResponse(request('item/fileChange/requestApproval'), 'decline'), {
      result: { decision: 'decline' },
    });
    assert.deepEqual(approvalResponse(request('execCommandApproval'), 'accept'), {
      result: { decision: 'approved' },
    });
    assert.deepEqual(approvalResponse(request('applyPatchApproval'), 'decline'), {
      result: { decision: { denied: { rejection: 'Declined in Orchboard.' } } },
    });
  });

  it('grants requested permissions for the turn or the session', () => {
    const permissions = { network: { enabled: true }, fileSystem: null };
    assert.deepEqual(
      approvalResponse(request('item/permissions/requestApproval', { permissions }), 'accept'),
      { result: { permissions: { network: { enabled: true } }, scope: 'turn' } },
    );
    assert.deepEqual(
      approvalResponse(request('item/permissions/requestApproval', { permissions }), 'decline'),
      { result: { permissions: {}, scope: 'turn' } },
    );
  });

  it('declines questions it cannot answer', () => {
    assert.deepEqual(approvalResponse(request('mcpServer/elicitation/request'), 'decline'), {
      result: { action: 'decline', content: null, _meta: null },
    });
    assert.deepEqual(approvalResponse(request('item/tool/requestUserInput'), 'decline'), {
      error: 'Declined in Orchboard.',
    });
  });
});
