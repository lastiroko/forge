'use client';

import React, { useRef, useState, type FormEvent } from 'react';
import type { Report, ReportTarget } from '../modules/community/index.js';
import { reportAction } from './report-actions.js';

interface ReportFormProps {
  target: ReportTarget;
}

interface SubmitReportCallbacks {
  succeed(inserted: Report): void;
  fail(message: string): void;
}

export async function submitReport(
  target: ReportTarget,
  reason: string,
  action: typeof reportAction,
  callbacks: SubmitReportCallbacks,
): Promise<void> {
  try {
    const inserted = await action(target, reason);
    callbacks.succeed(inserted);
  } catch (error) {
    callbacks.fail(error instanceof Error ? error.message : 'Unable to submit report.');
  }
}

export function ReportForm({ target }: ReportFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setError(null);
    setIsSubmitting(true);
    try {
      await submitReport(target, reason, reportAction, {
        succeed: () => {
          setSucceeded(true);
          setIsOpen(false);
        },
        fail: setError,
      });
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (succeeded) {
    return <p>Report submitted.</p>;
  }

  if (!isOpen) {
    return <button type="button" onClick={() => setIsOpen(true)}>Report</button>;
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor={`report-${target.type}-${target.id}`}>Reason for reporting this {target.type}</label>
      <textarea
        id={`report-${target.type}-${target.id}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        disabled={isSubmitting}
      />
      <button type="submit" disabled={isSubmitting}>Submit report</button>
      <button type="button" onClick={() => setIsOpen(false)} disabled={isSubmitting}>Cancel</button>
      {error ? <p>{error}</p> : null}
    </form>
  );
}
