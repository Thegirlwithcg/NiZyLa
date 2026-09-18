#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(__dirname, '..');
const args = [appPath, ...process.argv.slice(2)];

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (error) => {
  console.error(`Failed to start NiZyLa: ${error.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
