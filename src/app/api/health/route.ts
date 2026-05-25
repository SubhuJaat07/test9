import { NextResponse } from 'next/server';
import { isEngineRunning, getEngineStatus } from '@/lib/verify-engine';

export async function GET() {
  const status = getEngineStatus();

  return NextResponse.json({
    status: 'ok',
    repoId: status?.repoId || 'unknown',
    running: isEngineRunning(),
    verified: status?.verified || 0,
    ratePerHour: status?.ratePerHour || 0,
    workersActive: status?.workersActive || 0,
  });
}
