export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const [{ award }, { onRunCompleted }] = await Promise.all([
    import('./modules/scoring/index.js'),
    import('./modules/grading/index.js'),
  ]);
  await onRunCompleted(award);
}
