import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileDataUrl } from '../electron/scanner.js';

test('PDF files use the application/pdf data URL MIME type', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-pdf-'));
  const filePath = path.join(temp, 'sample.pdf');
  try {
    await fs.writeFile(filePath, Buffer.from('%PDF-1.4\n%%EOF\n'));
    const value = await readFileDataUrl(filePath);
    assert.match(value, /^data:application\/pdf;base64,/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
