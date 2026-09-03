import { getSubmission, streamStatus } from '../../../../modules/submissions/index.js';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const submission = await getSubmission(params.id);
  if (!submission) return Response.json({ error: 'not found' }, { status: 404 });

  const encoder = new TextEncoder();
  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort(), { once: true });
  let keepalive: ReturnType<typeof setInterval> | undefined;

  const body = new ReadableStream<Uint8Array>({
    async start(streamController) {
      keepalive = setInterval(() => {
        try { streamController.enqueue(encoder.encode(': keepalive\n\n')); } catch { controller.abort(); }
      }, 15_000);
      try {
        for await (const snapshot of streamStatus(params.id, controller.signal)) {
          streamController.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify(snapshot)}\n\n`));
        }
        streamController.close();
      } catch (error) {
        if (!controller.signal.aborted) streamController.error(error);
      } finally {
        if (keepalive) clearInterval(keepalive);
      }
    },
    cancel() {
      controller.abort();
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
