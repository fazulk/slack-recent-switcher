import fs from 'node:fs';
import crypto from 'node:crypto';
import { getRawHeader } from '@electron/asar';
import { NtExecutable, NtExecutableResource } from 'pe-library';

const hash = data => crypto.createHash('sha256').update(Buffer.from(data)).digest('hex');
export function windowsArchitecture(executable) {
  const exe = NtExecutable.from(fs.readFileSync(executable), { ignoreCert: true });
  const architecture = { 0x8664: 'x64', 0xaa64: 'arm64' }[exe.newHeader.fileHeader.machine];
  if (!architecture) throw new Error('Only Windows x64 and ARM64 Slack builds are supported.');
  return architecture;
}
function integrityEntries(resources) {
  return resources.entries.filter(entry => String(entry.type).toUpperCase() === 'INTEGRITY' && String(entry.id).toUpperCase() === 'ELECTRONASAR');
}
export function readWindowsIntegrity(executable) {
  const exe = NtExecutable.from(fs.readFileSync(executable), { ignoreCert: true });
  return integrityEntries(NtExecutableResource.from(exe)).flatMap(entry => JSON.parse(Buffer.from(entry.bin).toString('utf8')));
}
export function patchWindowsIntegrity(executable, archive) {
  const digest = hash(Buffer.from(getRawHeader(archive).headerString));
  const exe = NtExecutable.from(fs.readFileSync(executable), { ignoreCert: true });
  const sections = exe.getAllSections().filter(section => section.info.name !== '.rsrc').map(section => ({
    name: section.info.name, address: section.info.virtualAddress, digest: section.data ? hash(section.data) : null
  }));
  const resources = NtExecutableResource.from(exe);
  const entries = integrityEntries(resources);
  if (!entries.length) throw new Error('Unsupported Slack executable: Electron ASAR integrity resource is missing.');
  for (const entry of entries) {
    const values = JSON.parse(Buffer.from(entry.bin).toString('utf8'));
    const target = values.find(value => value.file?.replaceAll('\\', '/').toLowerCase() === 'resources/app.asar');
    if (!target || target.alg?.toLowerCase() !== 'sha256') throw new Error('Unsupported Windows Slack ASAR integrity metadata.');
    target.value = digest;
    entry.bin = Buffer.from(JSON.stringify(values));
  }
  // Keep section addresses stable. Generating the modified EXE removes its old
  // Authenticode signature; it cannot truthfully retain Slack's vendor signature.
  resources.outputResource(exe, true);
  const binary = Buffer.from(exe.generate());
  const checked = NtExecutable.from(binary);
  for (const before of sections) {
    const after = checked.getAllSections().find(section => section.info.name === before.name);
    if (!after || after.info.virtualAddress !== before.address || (after.data ? hash(after.data) : null) !== before.digest) throw new Error(`Executable section changed unexpectedly: ${before.name}`);
  }
  for (const entry of integrityEntries(NtExecutableResource.from(checked))) {
    const target = JSON.parse(Buffer.from(entry.bin).toString('utf8')).find(value => value.file?.replaceAll('\\', '/').toLowerCase() === 'resources/app.asar');
    if (target?.value !== digest) throw new Error('Windows executable integrity validation failed.');
  }
  fs.writeFileSync(executable, binary);
  return digest;
}
