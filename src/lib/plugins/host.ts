// What the plugin system needs from the desktop host: its folder, reading and writing plugin files,
// reading pictures as bytes, the open dialog, and fetch without CORS. Desktop (Tauri) only - plugins
// are files on disk, which mobile and the web build do not have.
import { isTauriHost } from '../platform';
import type { PickedFile } from './types';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml',
};

export function mimeFor(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export function pluginsSupported(): boolean {
  return isTauriHost();
}

async function fs() {
  return import('@tauri-apps/plugin-fs');
}

async function path() {
  return import('@tauri-apps/api/path');
}

/** <config dir>/acp-ui/plugins, beside agents.json. */
export async function pluginsDir(): Promise<string> {
  const p = await path();
  return p.join(await p.configDir(), 'acp-ui', 'plugins');
}

export async function joinPath(...parts: string[]): Promise<string> {
  return (await path()).join(...parts);
}

export async function listPluginFolders(): Promise<string[]> {
  const f = await fs();
  const dir = await pluginsDir();
  if (!(await f.exists(dir))) return [];
  const entries = await f.readDir(dir);
  return entries.filter(e => e.isDirectory).map(e => e.name);
}

export async function readText(file: string): Promise<string> {
  return (await fs()).readTextFile(file);
}

export async function writeText(file: string, content: string): Promise<void> {
  const f = await fs();
  const p = await path();
  await f.mkdir(await p.dirname(file), { recursive: true });
  await f.writeTextFile(file, content);
}

export async function removeFolder(dir: string): Promise<void> {
  await (await fs()).remove(dir, { recursive: true });
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;      // String.fromCharCode takes only so many arguments at once
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function pickFiles(options: { title?: string; extensions?: string[]; multiple?: boolean }): Promise<PickedFile[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({
    title: options.title,
    multiple: options.multiple ?? false,
    directory: false,
    filters: options.extensions?.length ? [{ name: 'Files', extensions: options.extensions }] : undefined,
  });
  if (!chosen) return [];
  const paths = Array.isArray(chosen) ? chosen : [chosen];
  const f = await fs();
  const files: PickedFile[] = [];
  for (const file of paths) {
    const bytes = await f.readFile(file);
    const name = file.split(/[\\/]/).pop() || file;
    files.push({ name, path: file, mimeType: mimeFor(name), size: bytes.length, base64: toBase64(bytes) });
  }
  return files;
}

export async function pickFolder(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ title, directory: true, multiple: false });
  return typeof chosen === 'string' ? chosen : null;
}

/** fetch() through the Rust side, so an endpoint without CORS headers can still be reached. */
export async function hostFetch(url: string, init?: RequestInit): Promise<Response> {
  const { fetch } = await import('@tauri-apps/plugin-http');
  return fetch(url, init);
}
