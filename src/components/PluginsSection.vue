<script setup lang="ts">
// Settings > Plugins: install from a link or a folder, switch on and off, update, remove, and each
// plugin's own settings.
import { ref, computed } from 'vue';
import { usePluginStore } from '../stores/plugins';
import { useSessionStore } from '../stores/session';
import { pickFolder } from '../lib/plugins/host';
import type { PluginSetting } from '../lib/plugins/types';

const plugins = usePluginStore();
const session = useSessionStore();
const url = ref('');
const busy = ref(false);
const problem = ref('');
const open = ref<string | null>(null);

const list = computed(() => plugins.installed);

// A plugin runs with this app's own access to your files and network, so it is installed only
// once it has been said so plainly - the same as installing any program.
function confirmed(from: string): boolean {
  return window.confirm(
    `Install a plugin from\n${from}\n\nA plugin runs inside ACP UI with the same access to your files and ` +
    `network as the app itself. Only install plugins from sources you trust.`);
}

async function run(work: () => Promise<void>) {
  busy.value = true;
  problem.value = '';
  try {
    await work();
  } catch (e) {
    problem.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function installUrl() {
  const from = url.value.trim();
  if (!from || !confirmed(from)) return;
  run(async () => {
    await plugins.installFromUrl(from);
    url.value = '';
  });
}

async function installFolder() {
  const folder = await pickFolder('Choose the plugin folder (it holds plugin.json)');
  if (!folder || !confirmed(folder)) return;
  run(() => plugins.installFromFolder(folder));
}

function remove(id: string, name: string) {
  if (!window.confirm(`Remove ${name}? Its settings are removed with it.`)) return;
  run(() => plugins.uninstall(id));
}

function value(id: string, setting: PluginSetting) {
  return plugins.settingValue(id, setting.key);
}

function save(id: string, setting: PluginSetting, event: Event) {
  const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const next = setting.type === 'toggle' ? (target as HTMLInputElement).checked : target.value;
  plugins.setSetting(id, setting.key, next);
}
</script>

<template>
  <section class="plugins-section">
    <div class="section-header">
      <h3>Plugins</h3>
    </div>

    <p v-if="!plugins.supported" class="muted">Plugins are files on disk, so they work in the desktop app only.</p>

    <template v-else>
      <div class="install-row">
        <input
          v-model="url"
          type="url"
          placeholder="Link to a plugin.json, e.g. https://github.com/you/plugin/blob/main/plugin.json"
          :disabled="busy"
          @keydown.enter="installUrl"
        />
        <button class="install-btn" :disabled="busy || !url.trim()" @click="installUrl">Install</button>
        <button class="install-btn secondary" :disabled="busy" @click="installFolder">From folder…</button>
      </div>
      <p v-if="problem" class="problem">{{ problem }}</p>

      <div v-if="list.length === 0" class="muted">No plugins installed yet.</div>

      <div v-for="plugin in list" :key="plugin.manifest.id" class="plugin-item">
        <div class="plugin-row">
          <label class="switch" :title="plugin.enabled ? 'On' : 'Off'">
            <input
              type="checkbox"
              :checked="plugin.enabled"
              :disabled="busy"
              @change="plugins.setEnabled(plugin.manifest.id, ($event.target as HTMLInputElement).checked)"
            />
          </label>
          <div class="plugin-info">
            <strong>{{ plugin.manifest.name }}</strong>
            <span class="version">{{ plugin.manifest.version }}</span>
            <p v-if="plugin.manifest.description" class="description">{{ plugin.manifest.description }}</p>
            <p v-if="plugin.error" class="problem">Could not start: {{ plugin.error }}</p>
          </div>
          <div class="plugin-actions">
            <button
              v-if="plugin.manifest.settings?.length"
              class="link-btn"
              @click="open = open === plugin.manifest.id ? null : plugin.manifest.id"
            >{{ open === plugin.manifest.id ? 'Hide settings' : 'Settings' }}</button>
            <button
              v-if="plugin.source"
              class="link-btn"
              :disabled="busy"
              :title="`Install again from ${plugin.source}`"
              @click="run(() => plugins.update(plugin.manifest.id))"
            >Update</button>
            <button class="link-btn danger" :disabled="busy" @click="remove(plugin.manifest.id, plugin.manifest.name)">Remove</button>
          </div>
        </div>

        <div v-if="open === plugin.manifest.id" class="plugin-settings">
          <div v-for="setting in plugin.manifest.settings" :key="setting.key" class="form-group">
            <label v-if="setting.type === 'toggle'" class="toggle-label">
              <input
                type="checkbox"
                :checked="Boolean(value(plugin.manifest.id, setting))"
                @change="save(plugin.manifest.id, setting, $event)"
              />
              {{ setting.label }}
            </label>
            <template v-else>
              <label>{{ setting.label }}</label>
              <select
                v-if="setting.type === 'select' || setting.type === 'model'"
                :value="value(plugin.manifest.id, setting) ?? ''"
                @change="save(plugin.manifest.id, setting, $event)"
              >
                <template v-if="setting.type === 'model'">
                  <option value="">Choose automatically</option>
                  <option v-for="m in session.availableModels" :key="m.modelId" :value="m.modelId">{{ m.name }}</option>
                  <option
                    v-if="value(plugin.manifest.id, setting) && !session.availableModels.some(m => m.modelId === value(plugin.manifest.id, setting))"
                    :value="String(value(plugin.manifest.id, setting))"
                  >{{ value(plugin.manifest.id, setting) }}</option>
                </template>
                <option v-for="o in setting.options || []" v-else :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <textarea
                v-else-if="setting.type === 'textarea'"
                rows="4"
                :value="String(value(plugin.manifest.id, setting) ?? '')"
                :placeholder="setting.placeholder"
                @change="save(plugin.manifest.id, setting, $event)"
              />
              <input
                v-else
                :type="setting.type === 'password' ? 'password' : 'text'"
                :value="String(value(plugin.manifest.id, setting) ?? '')"
                :placeholder="setting.placeholder"
                autocomplete="off"
                @change="save(plugin.manifest.id, setting, $event)"
              />
            </template>
            <small v-if="setting.help">{{ setting.help }}</small>
            <small v-if="setting.type === 'model' && !session.availableModels.length">
              Start a session to choose from its models.
            </small>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.plugins-section {
  padding: 1rem 0;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.section-header h3 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

.install-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.install-row input {
  flex: 1;
  min-width: 0;
  padding: 0.5rem;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  background: var(--bg-input, transparent);
  color: inherit;
}

.install-btn {
  padding: 0.5rem 0.9rem;
  border: none;
  border-radius: 6px;
  background: var(--bg-primary, #0066cc);
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}

.install-btn.secondary {
  background: transparent;
  color: inherit;
  border: 1px solid var(--border-color, #ccc);
}

.install-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.plugin-item {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  margin-top: 0.6rem;
}

.plugin-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.version {
  margin-left: 0.4rem;
  font-size: 0.8rem;
  color: var(--text-muted, #666);
}

.description {
  margin: 0.2rem 0 0;
  font-size: 0.85rem;
  color: var(--text-secondary, #666);
}

.plugin-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.link-btn {
  background: none;
  border: none;
  color: var(--text-accent, #0066cc);
  cursor: pointer;
  padding: 0;
  font-size: 0.85rem;
}

.link-btn.danger {
  color: #b00020;
}

.plugin-settings {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--border-color, #e0e0e0);
}

.form-group {
  margin-bottom: 0.75rem;
}

.form-group > label {
  display: block;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 0.45rem;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  background: var(--bg-input, transparent);
  color: inherit;
  box-sizing: border-box;
}

.form-group small {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.78rem;
  color: var(--text-muted, #666);
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.toggle-label input {
  width: auto;
}

.muted {
  color: var(--text-muted, #666);
  font-size: 0.85rem;
}

.problem {
  color: #b00020;
  font-size: 0.85rem;
  margin: 0.3rem 0;
}
</style>
