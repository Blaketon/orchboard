// Development: compile the browser code (and keep recompiling on change) while running the
// server from TypeScript source with automatic restarts.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const webProject = ['-p', 'src/web/tsconfig.build.json'];

// Build once up front so the page works as soon as the server is up.
execFileSync(process.execPath, [tsc, ...webProject], { stdio: 'inherit' });

const children: ChildProcess[] = [
  spawn(process.execPath, [tsc, ...webProject, '--watch', '--preserveWatchOutput'], {
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['--watch', 'src/server/main.ts'], { stdio: 'inherit' }),
];

function stopAll(): void {
  for (const child of children) child.kill();
}

process.once('SIGINT', stopAll);
process.once('SIGTERM', stopAll);
for (const child of children) {
  child.once('exit', (code) => {
    stopAll();
    process.exitCode = code ?? 0;
  });
}
