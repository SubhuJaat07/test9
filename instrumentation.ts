export async function register() {
  // Only run on Node.js runtime, not Edge
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Prevent double-start on hot reload
    if ((globalThis as any).__verifyEngineStarted) {
      console.log('[instrumentation] Engine already started, skipping');
      return;
    }
    (globalThis as any).__verifyEngineStarted = true;

    const repoId = process.env.REPO_ID;
    if (!repoId) {
      console.error('[instrumentation] REPO_ID env var is required! Set it to test1-test10');
      return;
    }

    const workerCount = parseInt(process.env.WORKER_COUNT || '100');

    console.log(`[instrumentation] Auto-starting verify engine for ${repoId} with ${workerCount} workers`);

    try {
      const { startVerifyEngine } = await import('./src/lib/verify-engine');
      await startVerifyEngine({
        repoId,
        workerCount,
        selfPingUrl: process.env.SELF_PING_URL,
      });
      console.log(`[instrumentation] ✅ Verify engine started for ${repoId}`);
    } catch (err: any) {
      console.error(`[instrumentation] ❌ Failed to start engine: ${err.message}`);
    }
  }
}
