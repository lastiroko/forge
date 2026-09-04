import JSZip from 'jszip';
import {
  listAccountExportEnrollments,
  type Enrollment,
} from '../enrollment/index.js';
import {
  loadAccountExportReport,
  listAccountExportGradingReports,
  readAccountExportReportObject,
  type AccountExportGradingReport,
  type ReportObjectReader,
} from '../grading/index.js';
import {
  getAccountExportProfile,
  type AccountExportProfile,
} from '../identity/index.js';
import {
  listAccountExportSubmissions,
  type Submission,
} from '../submissions/index.js';

export const MAX_REPORT_BYTES = 5 * 1024 * 1024;
export const MAX_AGGREGATE_REPORT_BYTES = 50 * 1024 * 1024;

export interface AccountExportDependencies {
  getProfile: (userId: string) => Promise<AccountExportProfile | undefined>;
  listEnrollments: (userId: string) => Promise<Enrollment[]>;
  listSubmissions: (userId: string) => Promise<Submission[]>;
  listReports: (userId: string) => Promise<AccountExportGradingReport[]>;
  readReportObject: ReportObjectReader;
}

const defaultDependencies: AccountExportDependencies = {
  getProfile: getAccountExportProfile,
  listEnrollments: listAccountExportEnrollments,
  listSubmissions: listAccountExportSubmissions,
  listReports: listAccountExportGradingReports,
  readReportObject: readAccountExportReportObject,
};

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function buildAccountExport(
  userId: string,
  dependencies: AccountExportDependencies = defaultDependencies,
): Promise<Buffer> {
  const profile = await dependencies.getProfile(userId);
  if (!profile) throw new Error(`Account export: no profile found for user ${userId}`);

  const enrollments = await dependencies.listEnrollments(userId);
  const submissions = await dependencies.listSubmissions(userId);
  const reportRuns = await dependencies.listReports(userId);
  const budget = { aggregateBytes: 0 };
  const reports: Array<{ runId: string; report: unknown }> = [];
  for (const run of reportRuns) {
    reports.push({
      runId: run.id,
      report: await loadAccountExportReport(
        run.id,
        dependencies.readReportObject,
        budget,
        MAX_REPORT_BYTES,
        MAX_AGGREGATE_REPORT_BYTES,
      ),
    });
  }

  const zip = new JSZip();
  zip.file('profile.json', serialize(profile));
  zip.file('enrollments.json', serialize(enrollments));
  zip.file('submissions.json', serialize(submissions));
  for (const { runId, report } of reports) {
    zip.file(`reports/${runId}.json`, serialize(report));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}
