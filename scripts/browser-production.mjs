import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
  stdio: 'inherit',
  env: { ...process.env, ASSET_DOCTOR_TEST_BUILD: '1' },
});
const [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
