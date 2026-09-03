'use client';

import React, { useEffect, useState } from 'react';
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
    if (initialStatus?.status === 'successful' || initialStatus?.status === 'failed' || initialStatus?.status === 'cancelled') return;
    return subscribeToSubmissionStatus(submissionId, (next) => {
      setStatus(next);
      setConnectionError(false);
    }, () => setConnectionError(true));
  }, [initialStatus?.status, submissionId]);

  const terminal = status?.status === 'successful' || status?.status === 'failed' || status?.status === 'cancelled';
  const label = terminal
    ? status.status === 'successful' ? 'Successful' : status.status === 'failed' ? 'Failed' : 'Cancelled'
    : status?.currentStage ?? (status?.status === 'queued' ? 'Queued' : status?.status ?? 'Waiting for grading');
  return (
    <section aria-live="polite">
      <h2>Grading status</h2>
      <p>{label}</p>
      {terminal && status.score != null ? <p>Score: {status.score}</p> : null}
      {status?.reportUrl ? <p><a href={status.reportUrl}>View grading report</a></p> : null}
      {connectionError ? <p role="alert">Live grading updates are temporarily unavailable.</p> : null}
    </section>
  );
}

interface StatusEventSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  onerror: ((event: Event) => void) | null;
}

export function subscribeToSubmissionStatus(
  submissionId: string,
  onStatus: (status: GradingStatusSnapshot) => void,
  onError: () => void,
  createSource: (url: string) => StatusEventSource = (url) => new EventSource(url),
): () => void {
  const source = createSource(`/submissions/${submissionId}/events`);
  source.addEventListener('status', (event) => {
    const next = JSON.parse((event as MessageEvent<string>).data) as GradingStatusSnapshot;
    onStatus(next);
    if (next.status === 'successful' || next.status === 'failed' || next.status === 'cancelled') source.close();
  });
  source.onerror = onError;
  return () => source.close();
}
