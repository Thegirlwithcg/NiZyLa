#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(__dirname, '..');
const userArgs = process.argv.slice(2);
const foreground = userArgs.includes('--foreground') || process.env.NIZYLA_DEBUG === '1';
const args = [appPath, ...userArgs.filter((arg) => arg !== '--foreground')];
const isWindows = process.platform === 'win32';
const logPath = path.join(os.tmpdir(), 'nizyla-launch.log');

function log(message) {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Ignore logging failures.
  }
}

log(`Launching ${electronPath} ${args.join(' ')}`);

const child = spawn(electronPath, args, {
  stdio: foreground || !isWindows ? 'inherit' : 'ignore',
  detached: isWindows && !foreground,
  windowsHide: isWindows && !foreground
});

child.on('error', (error) => {
  log(`Failed: ${error.stack || error.message}`);
  console.error(`Failed to start NiZyLa: ${error.message}`);
  console.error(`Launch log: ${logPath}`);
  process.exit(1);
});

if (isWindows && !foreground) {
  child.unref();
  process.exit(0);
} else {
  child.on('close', (code) => {
    log(`Exited with code ${code ?? 0}`);
    process.exit(code ?? 0);
  });
}
