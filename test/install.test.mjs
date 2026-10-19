import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { launcherFiles } from '../src/install.mjs';

test('launcher executable quotes paths without evaluating their contents', async () => {
  const directory = await mkdtemp('/tmp/slack-recents-');
  try {
    const entry = join(directory, "test's $(invalid) & <entry>.mjs");
    const output = join(directory, 'args.json');
    await writeFile(entry, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2)));`);
    const files = launcherFiles(process.execPath, entry, 9328, join(directory, "state's $(invalid)"));
    execFileSync('/bin/sh', ['-c', files.executable]);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), ['--helper', '--port', '9328']);
    if (process.platform === 'darwin') {
      const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: files.plist, encoding: 'utf8' }));
      assert.equal(plist.CFBundlePackageType, 'APPL');
      assert.equal(plist.LSUIElement, true);
      assert.equal(plist.LSMultipleInstancesProhibited, true);
      assert.equal(plist.SlackRecentsEntry, entry);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
