import { spawnSync } from 'node:child_process';

const suite = process.argv[2] === 'full' ? 'full' : 'smoke';
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['playwright', 'test'], {
  cwd: process.cwd(),
  env: { ...process.env, PLAYWRIGHT_SUITE: suite },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
