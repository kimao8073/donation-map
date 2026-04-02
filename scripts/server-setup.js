#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { ollamaHasModel } = require('./llm-ollama');

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
  const pkgPath = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('Run this from the repository root (package.json not found).');
  }

  const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';
  const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

  // 1) Install deps (only if needed)
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    console.error('[setup] installing npm dependencies...');
    runOrThrow(cmdNpm(), ['i'], { cwd: ROOT });
  } else {
    console.error('[setup] node_modules exists; skipping npm install');
  }

  // 2) Ensure Ollama + model
  console.error(`[setup] checking Ollama at ${OLLAMA_HOST} (model=${MODEL})...`);
  let hasModel = false;
  try {
    hasModel = await ollamaHasModel(MODEL, { host: OLLAMA_HOST });
  } catch (err) {
    console.error(`[setup] Ollama not reachable at ${OLLAMA_HOST}: ${String(err?.message || err)}`);
    console.error('[setup] Start Ollama first (example): ollama serve');
    process.exit(1);
  }

  if (!hasModel) {
    console.error(`[setup] pulling model: ${MODEL}`);
    runOrThrow('ollama', ['pull', MODEL], { cwd: ROOT });
  } else {
    console.error('[setup] model is available');
  }

  // 3) Initial data refresh (crawl + processed build)
  console.error('[setup] refreshing server data (crawl + LLM refine)...');
  runOrThrow(process.execPath, ['scripts/server-refresh.js'], { cwd: ROOT, env: process.env });

  console.error('[setup] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
