// Plugins: installing, loading, switching on and off, and what they have hooked into.
import { defineStore } from 'pinia';
import { ref, computed, markRaw } from 'vue';
import { loadKvStore, type KVStore } from '../lib/host/storage';
import {
  hostFetch, joinPath, listPluginFolders, pickFiles, pluginsDir, pluginsSupported, readText, removeFolder, writeText,
} from '../lib/plugins/host';
import type {
  Attachment, ComposerButton, InstalledPlugin, PluginApi, PluginManifest, PluginModule, PromptContext,
} from '../lib/plugins/types';
import { useSessionStore } from './session';

const STATE_FILE = 'plugins.json';
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

interface SavedState {
  enabled: Record<string, boolean>;
  settings: Record<string, Record<string, string | boolean>>;
  sources: Record<string, string>;
}

type Hook = (context: PromptContext) => void | Promise<void>;
type PasteHandler = (event: ClipboardEvent) => boolean | Promise<boolean>;
type DropHandler = (event: DragEvent) => boolean | Promise<boolean>;

export const usePluginStore = defineStore('plugins', () => {
  const installed = ref<InstalledPlugin[]>([]);
  const buttons = ref<(ComposerButton & { pluginId: string })[]>([]);
  const attachments = ref<Attachment[]>([]);
  const status = ref<string | null>(null);
  const notice = ref<{ message: string; kind: 'info' | 'error' } | null>(null);
  const supported = pluginsSupported();

  let kv: KVStore | null = null;
  let saved: SavedState = { enabled: {}, settings: {}, sources: {} };
  const modules = new Map<string, PluginModule>();
  const hooks: { pluginId: string; run: Hook }[] = [];
  const pasteHandlers: { pluginId: string; run: PasteHandler }[] = [];
  const dropHandlers: { pluginId: string; run: DropHandler }[] = [];

  const enabledPlugins = computed(() => installed.value.filter(p => p.enabled && !p.error));

  async function persist() {
    if (!kv) return;
    await kv.set('state', saved);
    await kv.save();
  }

  function notify(message: string, kind: 'info' | 'error' = 'info') {
    notice.value = { message, kind };
    setTimeout(() => { if (notice.value?.message === message) notice.value = null; }, 6000);
  }

  // --- the API one plugin is given -------------------------------------------------------------
  function apiFor(plugin: InstalledPlugin): PluginApi {
    const id = plugin.manifest.id;
    const session = useSessionStore();
    return {
      id,
      manifest: plugin.manifest,
      settings: {
        get<T>(key: string): T | undefined {
          const value = saved.settings[id]?.[key];
          if (value !== undefined) return value as T;
          return plugin.manifest.settings?.find(s => s.key === key)?.default as T | undefined;
        },
        async set(key, value) {
          saved.settings[id] = { ...(saved.settings[id] || {}), [key]: value };
          await persist();
        },
      },
      session: {
        get promptCapabilities() { return session.promptCapabilities; },
        get capabilitiesMeta() { return session.capabilitiesMeta; },
        get models() { return session.availableModels; },
        get currentModelId() { return session.currentModelId; },
        get isConnected() { return session.isConnected; },
        setModel: (modelId: string) => session.setModel(modelId),
      },
      composer: {
        addButton(button) {
          buttons.value = buttons.value.filter(b => !(b.pluginId === id && b.id === button.id));
          buttons.value.push({ ...button, pluginId: id });
        },
        addAttachment(attachment) {
          const added = { ...attachment, id: crypto.randomUUID(), pluginId: id };
          attachments.value.push(markRaw(added));
          return added.id;
        },
        removeAttachment(attachmentId) {
          attachments.value = attachments.value.filter(a => a.id !== attachmentId);
        },
        get attachments() { return attachments.value; },
        onPaste(handler) { pasteHandlers.push({ pluginId: id, run: handler }); },
        onDrop(handler) { dropHandlers.push({ pluginId: id, run: handler }); },
      },
      hooks: {
        beforePrompt(handler) { hooks.push({ pluginId: id, run: handler }); },
      },
      files: { pick: pickFiles },
      http: { fetch: hostFetch },
      ui: {
        notify: (message, kind) => notify(`${plugin.manifest.name}: ${message}`, kind),
        setStatus(text) { status.value = text; },
      },
    };
  }

  // --- loading -----------------------------------------------------------------------------------
  async function readManifest(dir: string): Promise<PluginManifest> {
    const manifest = JSON.parse(await readText(await joinPath(dir, 'plugin.json'))) as PluginManifest;
    if (!manifest.id || !ID.test(manifest.id)) throw new Error(`plugin.json has no valid id (lowercase letters, digits, dashes)`);
    if (!manifest.name || !manifest.main) throw new Error('plugin.json needs a name and a main file');
    return manifest;
  }

  async function activate(plugin: InstalledPlugin) {
    const code = await readText(await joinPath(plugin.dir, plugin.manifest.main));
    // A plugin is one self-contained module: loaded from a blob, it has no folder to import from
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const module = (await import(/* @vite-ignore */ url)) as PluginModule;
      if (typeof module.activate !== 'function') throw new Error(`${plugin.manifest.main} exports no activate()`);
      await module.activate(apiFor(plugin));
      modules.set(plugin.manifest.id, module);
      plugin.error = undefined;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function deactivate(id: string) {
    const module = modules.get(id);
    modules.delete(id);
    try { await module?.deactivate?.(); } catch (e) { console.warn(`plugin ${id} deactivate failed`, e); }
    for (const list of [hooks, pasteHandlers, dropHandlers]) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].pluginId === id) list.splice(i, 1);
    }
    buttons.value = buttons.value.filter(b => b.pluginId !== id);
    attachments.value = attachments.value.filter(a => a.pluginId !== id);
  }

  async function loadAll() {
    if (!supported) return;
    kv = await loadKvStore(STATE_FILE);
    saved = { enabled: {}, settings: {}, sources: {}, ...((await kv.get<SavedState>('state')) || {}) };
    const root = await pluginsDir();
    const found: InstalledPlugin[] = [];
    for (const folder of await listPluginFolders()) {
      const dir = await joinPath(root, folder);
      try {
        const manifest = await readManifest(dir);
        found.push({ manifest, dir, enabled: saved.enabled[manifest.id] ?? true, source: saved.sources[manifest.id] });
      } catch (e) {
        console.warn(`Skipping plugin folder ${folder}:`, e);
      }
    }
    installed.value = found;
    for (const plugin of installed.value) {
      if (!plugin.enabled) continue;
      try { await activate(plugin); } catch (e) { plugin.error = e instanceof Error ? e.message : String(e); }
    }
  }

  async function setEnabled(id: string, on: boolean) {
    const plugin = installed.value.find(p => p.manifest.id === id);
    if (!plugin) return;
    plugin.enabled = on;
    saved.enabled[id] = on;
    await persist();
    if (on) {
      try { await activate(plugin); } catch (e) { plugin.error = e instanceof Error ? e.message : String(e); }
    } else {
      await deactivate(id);
      plugin.error = undefined;
    }
  }

  // --- installing ----------------------------------------------------------------------------------
  /** From a URL of a plugin.json; `main` is fetched from beside it. A GitHub page URL is turned into
   *  its raw-file address, since that is the link people copy. */
  async function installFromUrl(manifestUrl: string) {
    const url = manifestUrl.trim()
      .replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//, 'https://raw.githubusercontent.com/$1/$2/');
    const response = await hostFetch(url);
    if (!response.ok) throw new Error(`Could not fetch ${url} (HTTP ${response.status})`);
    const manifestText = await response.text();
    const manifest = JSON.parse(manifestText) as PluginManifest;
    const mainUrl = new URL(manifest.main, url).toString();
    const main = await hostFetch(mainUrl);
    if (!main.ok) throw new Error(`Could not fetch ${mainUrl} (HTTP ${main.status})`);
    await install(manifest, manifestText, await main.text(), url);
  }

  /** From a folder on this computer holding plugin.json and its main file. */
  async function installFromFolder(folder: string) {
    const manifestText = await readText(await joinPath(folder, 'plugin.json'));
    const manifest = JSON.parse(manifestText) as PluginManifest;
    await install(manifest, manifestText, await readText(await joinPath(folder, manifest.main)), folder);
  }

  async function install(manifest: PluginManifest, manifestText: string, code: string, source: string) {
    if (!manifest.id || !ID.test(manifest.id)) throw new Error('plugin.json has no valid id');
    if (!manifest.main || manifest.main.includes('..')) throw new Error('plugin.json has no valid main file');
    const existing = installed.value.find(p => p.manifest.id === manifest.id);
    if (existing) await deactivate(manifest.id);
    const dir = await joinPath(await pluginsDir(), manifest.id);
    await writeText(await joinPath(dir, 'plugin.json'), manifestText);
    await writeText(await joinPath(dir, manifest.main), code);
    saved.enabled[manifest.id] = true;
    saved.sources[manifest.id] = source;
    await persist();
    const plugin: InstalledPlugin = { manifest, dir, enabled: true, source };
    installed.value = [...installed.value.filter(p => p.manifest.id !== manifest.id), plugin];
    const added = installed.value.find(p => p.manifest.id === manifest.id)!;
    try { await activate(added); } catch (e) { added.error = e instanceof Error ? e.message : String(e); }
    notify(`${manifest.name} ${manifest.version} installed`);
  }

  async function update(id: string) {
    const source = saved.sources[id];
    if (!source) throw new Error('This plugin has no source to update from');
    if (/^https?:\/\//.test(source)) await installFromUrl(source); else await installFromFolder(source);
  }

  async function uninstall(id: string) {
    const plugin = installed.value.find(p => p.manifest.id === id);
    if (!plugin) return;
    await deactivate(id);
    await removeFolder(plugin.dir);
    delete saved.enabled[id];
    delete saved.settings[id];
    delete saved.sources[id];
    await persist();
    installed.value = installed.value.filter(p => p.manifest.id !== id);
  }

  // --- settings, as Settings > Plugins edits them --------------------------------------------
  function settingValue(id: string, key: string): string | boolean | undefined {
    const value = saved.settings[id]?.[key];
    if (value !== undefined) return value;
    return installed.value.find(p => p.manifest.id === id)?.manifest.settings?.find(s => s.key === key)?.default;
  }

  async function setSetting(id: string, key: string, value: string | boolean) {
    saved.settings[id] = { ...(saved.settings[id] || {}), [key]: value };
    await persist();
  }

  // --- what the chat calls -------------------------------------------------------------------------
  /** Runs every beforePrompt hook in turn. A hook that throws is reported and skipped: one broken
   *  plugin must not stop messages being sent. */
  async function runBeforePrompt(context: PromptContext): Promise<void> {
    for (const hook of [...hooks]) {
      try {
        await hook.run(context);
      } catch (e) {
        const name = installed.value.find(p => p.manifest.id === hook.pluginId)?.manifest.name ?? hook.pluginId;
        context.notes.push(`${name} failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        status.value = null;
      }
      if (context.cancel) return;
    }
  }

  async function handlePaste(event: ClipboardEvent): Promise<boolean> {
    for (const handler of pasteHandlers) {
      if (await handler.run(event)) return true;
    }
    return false;
  }

  async function handleDrop(event: DragEvent): Promise<boolean> {
    for (const handler of dropHandlers) {
      if (await handler.run(event)) return true;
    }
    return false;
  }

  function takeAttachments(): Attachment[] {
    const taken = attachments.value;
    attachments.value = [];
    return taken;
  }

  function removeAttachment(id: string) {
    attachments.value = attachments.value.filter(a => a.id !== id);
  }

  return {
    supported, installed, enabledPlugins, buttons, attachments, status, notice,
    loadAll, setEnabled, installFromUrl, installFromFolder, update, uninstall,
    settingValue, setSetting, runBeforePrompt, handlePaste, handleDrop, takeAttachments, removeAttachment, notify,
  };
});
