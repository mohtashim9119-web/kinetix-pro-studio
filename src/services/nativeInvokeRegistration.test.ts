import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const LIB_RS = join(REPO_ROOT, 'src-tauri/src/lib.rs');

function productionSourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return name === 'dev' ? [] : productionSourceFiles(path);
      }
      return /\.(?:ts|tsx)$/.test(name) && !/\.test\.(?:ts|tsx)$/.test(name) ? [path] : [];
    });
}

function invokedCustomCommands(): Map<string, string[]> {
  const commands = new Map<string, string[]>();
  const literalInvoke = /\binvoke(?:<[^;()]*>)?\(\s*['"]([^'"]+)['"]/g;
  for (const file of productionSourceFiles(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(literalInvoke)) {
      const command = match[1];
      if (!command) continue;
      if (command.startsWith('plugin:')) continue;
      const locations = commands.get(command) ?? [];
      locations.push(relative(REPO_ROOT, file));
      commands.set(command, locations);
    }
  }
  return commands;
}

function registeredCommands(libSource: string): Set<string> {
  const handler = libSource.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
  if (!handler) throw new Error('src-tauri/src/lib.rs has no generate_handler! registration list');
  return new Set(
    handler
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split('::').at(-1)!)
  );
}

const ROUND_24A_TO_27_COMMANDS = [
  'relink_pick_folder',
  'relink_list_folder',
  'asset_store_write_from_path',
  'asset_store_status',
  'asset_store_attempt_resolution',
  'storage_root_status',
  'storage_root_relocate',
  'storage_root_reclaim',
  'size_report',
  'log_storage_persistence',
  'ffmpeg_volume_free_space',
  'ffmpeg_log_disk_preflight',
] as const;

describe('native invoke registration', () => {
  it('registers every literal custom command invoked by production TypeScript', () => {
    const invoked = invokedCustomCommands();
    const registered = registeredCommands(readFileSync(LIB_RS, 'utf8'));
    const missing = [...invoked]
      .filter(([command]) => !registered.has(command))
      .map(([command, files]) => `${command} (${files.join(', ')})`);

    expect(missing).toEqual([]);
    for (const command of ROUND_24A_TO_27_COMMANDS) {
      expect(registered.has(command), `${command} is absent from generate_handler!`).toBe(true);
    }
  });

  it('tripwire goes red when a UI-invoked registration is removed', () => {
    const source = readFileSync(LIB_RS, 'utf8').replace(
      'asset_store::asset_store_attempt_resolution,',
      '',
    );
    expect(registeredCommands(source).has('asset_store_attempt_resolution')).toBe(false);
    expect(invokedCustomCommands().has('asset_store_attempt_resolution')).toBe(true);
  });
});
