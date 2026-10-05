// Copies non-JS client resources and server sources to bin/, then webpack
// builds the client bundle via its own CLI call in package.json.
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcClient = path.join(root, 'src/client');
const srcServer = path.join(root, 'src/server');
const binClient = path.join(root, 'bin/client');
const binServer = path.join(root, 'bin/server');

async function copyDir(from, to, filter) {
    if (!existsSync(from)) return;
    await mkdir(to, { recursive: true });
    await cp(from, to, { recursive: true, filter });
}

await copyDir(srcClient, binClient, (src) => !src.endsWith('.js'));
await copyDir(srcServer, binServer);
