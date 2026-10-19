import { createConnection, createServer } from 'node:net';
import { lstat, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const stateDirectory = join(homedir(), 'Library', 'Application Support', 'Slack Recents');
export const socketPath = join(stateDirectory, 'helper.sock');

export function request(path, command) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let response = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('Launcher helper did not respond.')));
    socket.once('connect', () => socket.write(`${command}\n`));
    socket.on('data', data => {
      response += data;
      if (response.length > 16384) socket.destroy(new Error('Invalid launcher response.'));
      if (response.includes('\n')) {
        try { resolve(JSON.parse(response.split('\n')[0])); }
        catch (error) { reject(error); }
        socket.destroy();
      }
    });
    socket.once('error', reject);
    socket.once('end', () => reject(new Error('Launcher helper disconnected.')));
  });
}

export async function status(path = socketPath) {
  try { return await request(path, 'status'); }
  catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) return null;
    throw error;
  }
}

export async function serve(path, getStatus, stop) {
  const server = createServer(socket => {
    let input = '';
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', data => {
      input += data;
      if (input.length > 32) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      const command = input.trim();
      if (!['status', 'stop'].includes(command)) { socket.destroy(); return; }
      socket.end(`${JSON.stringify(getStatus())}\n`);
      if (command === 'stop') stop();
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => { server.removeListener('error', reject); resolve(); });
    });
  } catch (error) {
    server.close();
    if (error.code === 'EADDRINUSE') return null;
    throw error;
  }
  return () => new Promise(resolve => server.close(resolve));
}

export async function prepareState() {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
}

export async function clearStaleSocket() {
  // Launch Services serializes app launches; recover a crashed instance socket.
  const previous = await lstat(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!previous || await status()) return;
  const current = await lstat(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (current?.ino === previous.ino) await unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
