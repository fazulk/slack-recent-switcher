const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-recents-windows-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
async function archiveFixture(root) {
  const asar = await import('@electron/asar');
  const archive = path.join(root, 'original.asar');
  const contents = {
    'package.json': JSON.stringify({ name: 'slack-desktop', version: '4.52.162', main: './dist/boot.bundle.cjs' }),
    'dist/boot.bundle.cjs': 'module.exports = 42;',
    'native/library.node': 'native test bytes'
  };
  const stat = { size: 0, mode: 0o100644 };
  await asar.createPackageFromStreams(archive, Object.entries(contents).map(([name, content]) => ({
    path: name, type: 'file', unpacked: name.endsWith('.node'), stat: { ...stat, size: Buffer.byteLength(content) }, streamGenerator: () => Readable.from([content])
  })));
  return { asar, archive };
}
test('archive rebuilding preserves unpacked modules under spaces and glob metacharacters', async t => {
  const root = temporary(t);
  const { asar, archive } = await archiveFixture(root);
  const { patchArchive, inspectArchive } = await import('../scripts/archive.mjs');
  const original = digest(fs.readFileSync(archive));
  const output = path.join(root, 'patched.asar');
  await patchArchive({ archive, output, extracted: path.join(root, '.stage [test] (copy)'), root: path.resolve(__dirname, '..') });
  assert.equal(digest(fs.readFileSync(archive)), original);
  assert.equal(asar.statFile(output, 'native/library.node').unpacked, true);
  assert.equal(fs.readFileSync(`${output}.unpacked/native/library.node`, 'utf8'), 'native test bytes');
  assert.equal(asar.extractFile(output, 'dist/boot.bundle.cjs').toString(), 'module.exports = 42;');
  assert.equal(JSON.parse(asar.extractFile(output, 'package.json')).main, './slack-recent-switcher/bootstrap.cjs');
  assert.equal(asar.statFile(output, 'package.json').integrity.hash, digest(asar.extractFile(output, 'package.json')));
  assert.throws(() => inspectArchive(output), /unpatched/);
});
test('archive inspection accepts the known Slack architecture loader', async t => {
  const root = temporary(t);
  const asar = await import('@electron/asar');
  const archive = path.join(root, 'loader.asar');
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'slack-desktop', main: 'index.js' }));
  fs.writeFileSync(path.join(source, 'index.js'), "const { app } = require('electron'); app.setAppPath('../app-arm64.asar'); process._archPath = require.resolve('../app-arm64.asar'); require(process._archPath);");
  await asar.createPackage(source, archive);
  const { inspectArchive } = await import('../scripts/archive.mjs');
  assert.equal(inspectArchive(archive).originalMain, 'index.js');
  fs.writeFileSync(path.join(source, 'index.js'), 'import "./other.js";');
  const unsupported = path.join(root, 'unsupported.asar');
  await asar.createPackage(source, unsupported);
  assert.throws(() => inspectArchive(unsupported), /Unsupported Slack entry point/);
});
test('Windows PE integrity is updated for the rebuilt archive without changing other resources', async t => {
  const root = temporary(t);
  const { asar, archive } = await archiveFixture(root);
  const { NtExecutable, NtExecutableResource } = await import('pe-library');
  const { patchWindowsIntegrity, readWindowsIntegrity, windowsArchitecture } = await import('../scripts/windows-pe.mjs');
  const exe = NtExecutable.createEmpty(false, false);
  exe.newHeader.fileHeader.machine = 0x8664;
  const resources = NtExecutableResource.from(exe);
  resources.replaceResourceEntryFromString('INTEGRITY', 'ELECTRONASAR', 1033, JSON.stringify([{ file: 'resources\\app.asar', alg: 'SHA256', value: '0'.repeat(64) }]));
  resources.replaceResourceEntryFromString('TEST', 7, 1033, 'Preserve this resource');
  resources.outputResource(exe);
  const file = path.join(root, 'slack.exe'); fs.writeFileSync(file, Buffer.from(exe.generate()));
  assert.equal(windowsArchitecture(file), 'x64');
  const expected = digest(Buffer.from(asar.getRawHeader(archive).headerString));
  assert.equal(patchWindowsIntegrity(file, archive), expected);
  assert.equal(readWindowsIntegrity(file)[0].value, expected);
  const after = NtExecutableResource.from(NtExecutable.from(fs.readFileSync(file)));
  assert.deepEqual(after.getResourceEntriesAsString('TEST', 7), [[1033, 'Preserve this resource']]);
  after.removeResourceEntry('INTEGRITY', 'ELECTRONASAR');
  const unsupported = NtExecutable.createEmpty(false, false); after.outputResource(unsupported);
  fs.writeFileSync(file, Buffer.from(unsupported.generate()));
  const before = fs.readFileSync(file);
  assert.throws(() => patchWindowsIntegrity(file, archive), /integrity resource is missing/);
  assert.ok(fs.readFileSync(file).equals(before), 'Unsupported executables must not be modified');
});
test('Windows discovery selects the latest complete Squirrel app and refuses MSIX sources', async t => {
  const root = temporary(t);
  const { findWindowsSource, containsWindowsPath } = await import('../scripts/install-windows.mjs');
  const base = path.join(root, 'slack'); fs.mkdirSync(base);
  fs.writeFileSync(path.join(base, 'slack.exe'), 'launcher stub');
  for (const name of ['app-4.9.99', 'app-4.52.162']) {
    fs.mkdirSync(path.join(base, name, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(base, name, 'slack.exe'), 'fixture');
    fs.writeFileSync(path.join(base, name, 'resources/app.asar'), 'fixture');
  }
  fs.mkdirSync(path.join(base, 'app-99.0.0'));
  const selected = fs.realpathSync(path.join(base, 'app-4.52.162'));
  assert.equal(findWindowsSource(base), selected);
  assert.equal(findWindowsSource(path.join(selected, 'slack.exe')), selected);
  fs.writeFileSync(path.join(selected, 'AppxManifest.xml'), 'fixture');
  assert.throws(() => findWindowsSource(selected), /MSIX/);
  assert.equal(containsWindowsPath('C:\\Users\\Person\\Slack', 'c:/users/person/slack/resources/app.asar'), true);
  assert.equal(containsWindowsPath('C:\\Users\\Person\\Slack', 'C:\\Users\\Person\\SlackRecents'), false);
});
