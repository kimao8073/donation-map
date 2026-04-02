#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runOrThrow(command, args, { cwd, env } = {}) {
  const res = spawnSync(command, args, {
    cwd,
    env: env || process.env,
    stdio: 'inherit',
  });
  if (res.error) throw res.error;
  if (typeof res.status === 'number' && res.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${res.status}`);
  }
}

async function main() {
  const ROOT = process.cwd();
  const processedPath = path.join(ROOT, 'processed', 'campaigns.json');
  if (!fs.existsSync(processedPath)) {
    console.error('[start] processed/campaigns.json not found; run: node scripts/server-refresh.js');
  }
  runOrThrow(process.execPath, ['server.js'], { cwd: ROOT, env: process.env });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
