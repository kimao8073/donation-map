#!/usr/bin/env node
/* eslint-disable no-console */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function cmdNpm() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

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

  // 1) Crawl (JSON)
  console.error('[refresh] crawling sources...');
  runOrThrow(cmdNpm(), ['run', 'crawl:now:json'], { cwd: ROOT });
  runOrThrow(cmdNpm(), ['run', 'crawl:goodneighbors:json'], { cwd: ROOT });
  runOrThrow(cmdNpm(), ['run', 'crawl:happybean:json'], { cwd: ROOT });

  // 2) Build processed output using LLM
  const env = {
    ...process.env,
    // Sensible defaults for "server refresh" runs.
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'llama3.2:1b',
    CONCURRENCY: process.env.CONCURRENCY || '2',
    CHECKPOINT_EVERY: process.env.CHECKPOINT_EVERY || '10',
    // Default to incremental updates; override by FORCE_REFINE=true when needed.
    CHANGED_ONLY: process.env.CHANGED_ONLY ?? 'true',
  };

  console.error('[refresh] building processed/campaigns.json...');
  runOrThrow(cmdNpm(), ['run', 'build:processed'], { cwd: ROOT, env });

  console.error('[refresh] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
