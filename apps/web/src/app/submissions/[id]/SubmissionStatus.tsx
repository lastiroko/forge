'use client';

import { useEffect, useState } from 'react';
import type { GradingStatusSnapshot } from '../../../modules/submissions/index.js';

export function SubmissionStatus({
  submissionId,
  initialStatus,
}: {
  submissionId: string;
  initialStatus?: GradingStatusSnapshot;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    if (status?.status === 'successful' || status?.status === 'failed') return;
    const source = new EventSource(`/submissions/${submissionId}/events`);
    source.addEventListener('status', (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as GradingStatusSnapshot;
      setStatus(next);
      setConnectionError(false);
      if (next.status === 'successful' || next.status === 'failed') source.close();
    });
    source.onerror = () => setConnectionError(true);
    return () => source.close();
  }, [submissionId, status?.status]);

  const terminal = status?.status === 'successful' || status?.status === 'failed';
  const label = terminal
    ? status.status === 'successful' ? 'Successful' : 'Failed'
    : status?.currentStage ?? (status?.status === 'queued' ? 'Queued' : status?.status ?? 'Waiting for grading');
  return (
    <section aria-live="polite">
      <h2>Grading status</h2>
      <p>{label}</p>
      {terminal ? <p>Score: {status.score}</p> : null}
      {status?.reportUrl ? <p><a href={status.reportUrl}>View grading report</a></p> : null}
      {connectionError ? <p role="alert">Live grading updates are temporarily unavailable.</p> : null}
    </section>
  );
}
