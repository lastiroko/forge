'use server';

import { cookies } from 'next/headers';
import { report, type Report, type ReportTarget } from '../modules/community/index.js';

export async function reportAction(target: ReportTarget, reason: string): Promise<Report> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('Report reason cannot be empty.');
  return report(target, trimmedReason, cookies());
}
