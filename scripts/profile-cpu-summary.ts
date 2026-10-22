/**
 * Summarizes a V8 .cpuprofile: total self-time per function and per file,
 * so build hotspots are visible without the DevTools UI.
 *
 * Usage: bun scripts/profile-cpu-summary.ts <profile.cpuprofile> [topN]
 */
import { readFileSync } from 'node:fs';

interface ProfileCallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
}

interface ProfileNode {
  id: number;
  callFrame: ProfileCallFrame;
}

const file = process.argv[2];
if (!file) {
  console.error('usage: bun scripts/profile-cpu-summary.ts <profile.cpuprofile> [topN]');
  process.exit(1);
}
const topN = Number(process.argv[3] ?? 25);

const profile = JSON.parse(readFileSync(file, 'utf8'));
const { nodes, samples, timeDeltas, startTime, endTime } = profile;

const selfTime = new Map<number, number>(); // nodeId -> microseconds
const byId = new Map<number, ProfileNode>(nodes.map((n: ProfileNode) => [n.id, n]));

for (let i = 0; i < samples.length; i++) {
  const id = samples[i];
  const dt = timeDeltas[i] ?? 0;
  selfTime.set(id, (selfTime.get(id) ?? 0) + dt);
}

const funcTime = new Map<string, number>(); // "fn (file:line)" -> us
const fileTime = new Map<string, number>(); // file -> us

for (const [id, us] of selfTime) {
  const node = byId.get(id);
  if (!node) continue;
  const cf = node.callFrame;
  const url = (cf.url || '(anonymous)').replace(/^file:\/\//, '');
  const key = `${cf.functionName || '(anonymous)'} @ ${url}${cf.lineNumber >= 0 ? `:${cf.lineNumber + 1}` : ''}`;
  funcTime.set(key, (funcTime.get(key) ?? 0) + us);
  // Bucket by file, stripping query/hash noise
  const fileKey = url.split('?')[0] || '(vm)';
  fileTime.set(fileKey, (fileTime.get(fileKey) ?? 0) + us);
}

const totalUs = endTime - startTime;
const fmt = (us: number) => `${(us / 1000).toFixed(0).padStart(6)}ms`;

console.log(`Total profile: ${(totalUs / 1000).toFixed(0)}ms\n`);
console.log(`── Top ${topN} functions by self time ──`);
for (const [key, us] of [...funcTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)) {
  console.log(`${fmt(us)}  ${((us / totalUs) * 100).toFixed(1).padStart(4)}%  ${key}`);
}
console.log(`\n── Top ${topN} files by self time ──`);
for (const [key, us] of [...fileTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)) {
  console.log(`${fmt(us)}  ${((us / totalUs) * 100).toFixed(1).padStart(4)}%  ${key}`);
}
