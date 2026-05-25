import { NextResponse } from 'next/server';
import { getEngineStatus, getRepoBatches } from '@/lib/verify-engine';

export async function GET() {
  const status = getEngineStatus();
  const batches = getRepoBatches();

  if (!status) {
    return NextResponse.json({
      running: false,
      batches,
      message: 'Engine not started yet. Set REPO_ID env var and redeploy.',
    });
  }

  return NextResponse.json(status);
}
