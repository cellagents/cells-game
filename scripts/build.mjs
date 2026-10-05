// Copies non-TS client resources to bin/client (html, css, images, audio),
// then compiles the server via tsc. The client bundle is built separately
// by webpack from package.json.
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcClient = path.join(root, 'src/client');
const binClient = path.join(root, 'bin/client');

async function copyDir(from, to, filter) {
    if (!existsSync(from)) return;
    await mkdir(to, { recursive: true });
    await cp(from, to, { recursive: true, filter });
}

// Copy everything under src/client except .ts sources (webpack bundles those).
await copyDir(srcClient, binClient, (src) => !src.endsWith('.ts'));

// Compile the server (and config.ts) to bin/.
const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.server.json'], {
    cwd: root,
    stdio: 'inherit'
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
