'use client';

import { useEffect, useState } from 'react';

interface EngineStats {
  repoId: string;
  batchPrefix: string;
  running: boolean;
  cursor: number;
  startNumber: number;
  endNumber: number;
  progressPercent: string;
  verified: number;
  notFound: number;
  rateLimited: number;
  errors: number;
  skipped: number;
  totalProcessed: number;
  totalInDb: number;
  startTime: number;
  elapsedSeconds: number;
  ratePerSecond: string;
  ratePerHour: number;
  workersActive: number;
  last429Time: number | null;
  currentBackoff: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStats(data);
      setError('');
    } catch (err: any) {
      setError('Failed to fetch status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const formatNumber = (n: number) => {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-2">Engine Not Running</div>
          <div className="text-gray-400">Set REPO_ID env var and redeploy</div>
        </div>
      </div>
    );
  }

  const verifiedRate = stats.totalProcessed > 0
    ? ((stats.verified / stats.totalProcessed) * 100).toFixed(1)
    : '0';

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">
              🔍 Verify Scanner
              <span className="ml-3 text-blue-400 text-lg">[{stats.repoId}]</span>
            </h1>
            <p className="text-gray-400 mt-1">
              Batch Prefix: <span className="text-yellow-300 font-mono">{stats.batchPrefix}xxxxxxxx</span>
              {' | '}Range: <span className="text-green-300 font-mono">{stats.startNumber}-{stats.endNumber}</span>
            </p>
          </div>
          <div className={`px-4 py-2 rounded-full text-sm font-bold ${stats.running ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {stats.running ? '● RUNNING' : '● STOPPED'}
          </div>
        </div>

        {/* Main Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Verified" value={formatNumber(stats.verified)} color="text-green-400" />
          <StatCard label="Not Found" value={formatNumber(stats.notFound)} color="text-gray-400" />
          <StatCard label="Rate/Hour" value={formatNumber(stats.ratePerHour)} color="text-blue-400" />
          <StatCard label="Rate/Sec" value={stats.ratePerSecond} color="text-cyan-400" />
          <StatCard label="429 Rate Limited" value={formatNumber(stats.rateLimited)} color="text-red-400" />
          <StatCard label="Errors" value={formatNumber(stats.errors)} color="text-orange-400" />
          <StatCard label="Skipped (DB)" value={formatNumber(stats.skipped)} color="text-yellow-400" />
          <StatCard label="Workers Active" value={stats.workersActive.toString()} color="text-purple-400" />
        </div>

        {/* Progress Bar */}
        <div className="bg-gray-900 rounded-xl p-6 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Progress</span>
            <span className="text-white font-mono">{stats.progressPercent}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-4">
            <div
              className="bg-gradient-to-r from-blue-600 to-cyan-500 h-4 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(parseFloat(stats.progressPercent), 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>Cursor: {stats.cursor}</span>
            <span>Total in DB: {formatNumber(stats.totalInDb)}</span>
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-gray-900 rounded-xl p-5">
            <h3 className="text-gray-400 text-sm mb-3">Verification Stats</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Verified Hit Rate</span>
                <span className="text-green-400 font-mono">{verifiedRate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Processed</span>
                <span className="text-white font-mono">{formatNumber(stats.totalProcessed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Elapsed Time</span>
                <span className="text-white font-mono">{formatTime(stats.elapsedSeconds)}</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl p-5">
            <h3 className="text-gray-400 text-sm mb-3">Rate Limit Status</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Current Backoff</span>
                <span className={stats.currentBackoff > 0 ? 'text-red-400 font-mono' : 'text-green-400 font-mono'}>
                  {stats.currentBackoff > 0 ? `${(stats.currentBackoff / 1000).toFixed(1)}s` : 'None'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Last 429</span>
                <span className="text-gray-300 font-mono text-sm">
                  {stats.last429Time ? new Date(stats.last429Time).toLocaleTimeString() : 'Never'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">429 Total</span>
                <span className="text-red-400 font-mono">{formatNumber(stats.rateLimited)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Target Info */}
        <div className="bg-gray-900/50 rounded-xl p-4 text-center text-sm text-gray-500">
          Target: All repos combined = 10 lakh (1M) verified/hour | This repo target: ~1 lakh/hour
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <div className="text-gray-400 text-xs mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}
