import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export function signApp(app) {
  const run = (program, args, input) => execFileSync(program, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
  // Re-sign all native libraries first, then sign executable bundles from the inside out.
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', '--options', 'runtime', app]);
  const bundles = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      walk(child);
      if (entry.name.endsWith('.app')) bundles.push(child);
    }
  }
  walk(path.join(app, 'Contents/Frameworks'));
  bundles.push(app);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-recents-sign-'));
  try {
    const entitlementFile = path.join(temporary, 'entitlements.plist');
    for (const bundle of bundles) {
      const xml = run('/usr/bin/codesign', ['-d', '--entitlements', ':-', bundle]);
      const entitlements = xml.trim() ? JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], xml)) : {};
      // Ad-hoc signatures have no Team ID. Without this, dyld rejects the re-signed Electron framework.
      entitlements['com.apple.security.cs.disable-library-validation'] = true;
      fs.writeFileSync(entitlementFile, JSON.stringify(entitlements));
      run('/usr/bin/plutil', ['-convert', 'xml1', entitlementFile]);
      run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', entitlementFile, bundle]);
    }
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
