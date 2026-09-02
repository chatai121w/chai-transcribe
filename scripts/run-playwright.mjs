import { spawnSync } from 'node:child_process';

const requestedSuite = process.argv[2];
const suite = ['smoke', 'full', 'live', 'production'].includes(requestedSuite)
  ? requestedSuite
  : 'smoke';
const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
const commandArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npx playwright test']
  : ['playwright', 'test'];
const result = spawnSync(command, commandArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PLAYWRIGHT_SUITE: suite,
    ...(suite === 'production' ? { RUN_PRODUCTION_LAB: '1' } : {}),
  },
  stdio: 'inherit',
  shell: false,
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
