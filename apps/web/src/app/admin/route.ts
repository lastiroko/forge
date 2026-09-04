import { isAuthorizationError } from '../../modules/identity/index.js';
import { hideContent, suspendMember, warnMember } from '../../modules/admin/index.js';
import {
  cancelGradingRun, getAdminOperations, retryGradingRun, type OperationsRun, type WorkerHeartbeat,
} from '../../modules/operations/index.js';

export const dynamic = 'force-dynamic';

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderRuns(runs: OperationsRun[], emptyMessage: string, action: 'retry' | 'cancel' | null): string {
  if (runs.length === 0) return `<p>${emptyMessage}</p>`;
  const actionHeader = action ? '<th>Actions</th>' : '';
  return `<table><thead><tr><th>Run ID</th><th>Submission ID</th><th>Stage</th><th>Updated</th>${actionHeader}</tr></thead><tbody>${runs.map((run) => {
    const actionCell = action
      ? `<td><form method="post" action="/admin"><input type="hidden" name="runId" value="${escapeHtml(run.id)}"><input type="hidden" name="action" value="${action}"><button type="submit">${action === 'retry' ? 'Retry' : 'Cancel'}</button></form></td>`
      : '';
    return `<tr><td>${escapeHtml(run.id)}</td><td>${escapeHtml(run.submissionId)}</td><td>${escapeHtml(run.stage ?? 'Not reported')}</td><td><time datetime="${escapeHtml(run.updatedAt.toISOString())}">${escapeHtml(run.updatedAt.toISOString())}</time></td>${actionCell}</tr>`;
  }).join('')}</tbody></table>`;
}

function renderWorkers(workers: WorkerHeartbeat[]): string {
  if (workers.length === 0) return '<p>No worker heartbeats have been reported.</p>';
  return `<table><thead><tr><th>Worker ID</th><th>Started</th><th>Last heartbeat</th><th>Status</th></tr></thead><tbody>${workers.map((worker) =>
    `<tr><td>${escapeHtml(worker.workerId)}</td><td><time datetime="${escapeHtml(worker.startedAt.toISOString())}">${escapeHtml(worker.startedAt.toISOString())}</time></td><td><time datetime="${escapeHtml(worker.lastHeartbeatAt.toISOString())}">${escapeHtml(worker.lastHeartbeatAt.toISOString())}</time></td><td>${escapeHtml(worker.status)}</td></tr>`,
  ).join('')}</tbody></table>`;
}

export async function GET(): Promise<Response> {
  try {
    const operations = await getAdminOperations();
    const moderationForm = (action: string, heading: string) => `<form method="post" action="/admin"><h3>${heading}</h3><input type="hidden" name="action" value="${action}"><label>Target ID <input name="targetId" required></label><label>Reason <textarea name="reason" required></textarea></label><button type="submit">Submit</button></form>`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin operations</title></head><body><main><h1>Admin operations</h1><section aria-labelledby="moderation"><h2 id="moderation">Content moderation</h2>${moderationForm('hide-solution', 'Hide solution')}${moderationForm('hide-comment', 'Hide comment')}${moderationForm('warn-member', 'Warn member')}${moderationForm('suspend-member', 'Suspend member')}</section><section aria-labelledby="queue"><h2 id="queue">Grading queue</h2><p>Queued jobs: <output data-queue-length>${escapeHtml(operations.queueLength)}</output></p></section><section aria-labelledby="running"><h2 id="running">Running grading jobs</h2>${renderRuns(operations.runningRuns, 'No grading jobs are currently running.', 'cancel')}</section><section aria-labelledby="workers"><h2 id="workers">Worker heartbeats</h2>${renderWorkers(operations.workers)}</section><section aria-labelledby="failures"><h2 id="failures">Recent failed runs</h2>${renderRuns(operations.failedRuns, 'No failed grading runs were found.', 'retry')}</section></main></body></html>`;
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    if (isAuthorizationError(error)) return new Response('Forbidden', { status: 403 });
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const action = form.get('action');
  if (action !== 'retry' && action !== 'cancel' && action !== 'hide-solution' && action !== 'hide-comment' && action !== 'warn-member' && action !== 'suspend-member') {
    return new Response('Bad Request', { status: 400 });
  }

  const runId = form.get('runId');
  const targetId = form.get('targetId');
  const reason = form.get('reason');
  if ((action === 'retry' || action === 'cancel')
    ? typeof runId !== 'string' || runId.trim().length === 0
    : typeof targetId !== 'string' || targetId.trim().length === 0 || typeof reason !== 'string' || reason.trim().length === 0) {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    if (action === 'retry') await retryGradingRun((runId as string).trim());
    else if (action === 'cancel') await cancelGradingRun((runId as string).trim());
    else if (action === 'hide-solution') await hideContent({ type: 'solution', id: (targetId as string).trim() }, reason as string);
    else if (action === 'hide-comment') await hideContent({ type: 'comment', id: (targetId as string).trim() }, reason as string);
    else if (action === 'warn-member') await warnMember((targetId as string).trim(), reason as string);
    else await suspendMember((targetId as string).trim(), reason as string);
  } catch (error) {
    if (isAuthorizationError(error)) return new Response('Forbidden', { status: 403 });
    throw error;
  }

  return new Response(null, { status: 303, headers: { Location: '/admin' } });
}
