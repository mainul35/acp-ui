<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { marked } from 'marked';
import { useSessionStore } from '../stores/session';
import { usePluginStore } from '../stores/plugins';
import { isMobile } from '../lib/platform';
import ModePicker from './ModePicker.vue';
import ModelPicker from './ModelPicker.vue';
import CommandPalette from './CommandPalette.vue';
import type { SlashCommand } from '../lib/types';

const sessionStore = useSessionStore();
const pluginStore = usePluginStore();
const inputText = ref('');
const dragging = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const commandPaletteRef = ref<InstanceType<typeof CommandPalette> | null>(null);

// On mobile (iOS/Android) the soft-keyboard's Return key should insert a
// newline like every other native chat app; submitting is the dedicated
// Send button. On desktop, Enter still submits and Shift+Enter newlines.
const submitOnEnter = !isMobile();

// Track expanded thought sections by message id
const expandedThoughts = ref<Set<string>>(new Set());

const messages = computed(() => sessionStore.messageList);
const isLoading = computed(() => sessionStore.isLoading);
const isReconnecting = computed(() => sessionStore.isReconnecting);
const currentSession = computed(() => sessionStore.currentSession);
const availableModes = computed(() => sessionStore.availableModes);
const currentModeId = computed(() => sessionStore.currentModeId);
const availableModels = computed(() => sessionStore.availableModels);
const currentModelId = computed(() => sessionStore.currentModelId);
const availableCommands = computed(() => sessionStore.availableCommands);

// Slash command state
const showCommandPalette = computed(() => {
  if (availableCommands.value.length === 0) return false;
  const text = inputText.value;
  // Show palette when input starts with "/" and cursor is after it
  if (!text.startsWith('/')) return false;
  // Don't show if there's a space (command already entered)
  const spaceIndex = text.indexOf(' ');
  return spaceIndex === -1;
});

const commandFilter = computed(() => {
  if (!inputText.value.startsWith('/')) return '';
  return inputText.value.slice(1); // Remove the leading "/"
});

// Auto-scroll to bottom when new messages arrive
watch(messages, async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}, { deep: true });

const attachments = computed(() => pluginStore.attachments);
const composerButtons = computed(() => pluginStore.buttons);
const canSend = computed(() => (!!inputText.value.trim() || attachments.value.length > 0)
  && !isLoading.value && !isReconnecting.value);

async function handleSend() {
  const text = inputText.value.trim();
  if ((!text && attachments.value.length === 0) || isLoading.value) return;
  
  inputText.value = '';
  try {
    await sessionStore.sendPrompt(text);
  } catch (e) {
    console.error('Failed to send prompt:', e);
  }
}

function handleKeyDown(event: KeyboardEvent) {
  // Let CommandPalette handle navigation keys when visible
  if (showCommandPalette.value && commandPaletteRef.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      commandPaletteRef.value.handleKeyDown(event);
      return;
    }
  }

  // Enter-to-send is desktop only. On mobile we let the textarea insert a
  // newline like every other native chat app and require an explicit tap
  // on the Send button.
  if (submitOnEnter && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
}

// Pasting a picture: the default paste is stopped only when the clipboard holds files and a plugin
// is listening, so ordinary text still pastes as it always did.
async function handlePaste(event: ClipboardEvent) {
  if (!event.clipboardData?.files.length) return;
  event.preventDefault();
  if (!(await pluginStore.handlePaste(event))) {
    pluginStore.notify('Nothing here takes pasted files. Install a plugin for it under Settings > Plugins.', 'error');
  }
}

function handleDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  dragging.value = true;
}

async function handleDrop(event: DragEvent) {
  dragging.value = false;
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  if (!(await pluginStore.handleDrop(event))) {
    pluginStore.notify('Nothing here takes dropped files. Install a plugin for it under Settings > Plugins.', 'error');
  }
}

async function runButton(onClick: () => void | Promise<void>) {
  try {
    await onClick();
  } catch (e) {
    pluginStore.notify(e instanceof Error ? e.message : String(e), 'error');
  }
}

function handleCommandSelect(command: SlashCommand) {
  // Replace current input with the command
  if (command.hint) {
    inputText.value = `/${command.name} `;
  } else {
    inputText.value = `/${command.name} `;
  }
}

function handleCommandClose() {
  // Just dismiss, keep the text
}

function handleCancel() {
  sessionStore.cancelOperation();
}

async function handleModeChange(modeId: string) {
  try {
    await sessionStore.setMode(modeId);
  } catch (e) {
    console.error('Failed to change mode:', e);
  }
}

async function handleModelChange(modelId: string) {
  try {
    await sessionStore.setModel(modelId);
  } catch (e) {
    console.error('Failed to change model:', e);
  }
}

function isThoughtExpanded(messageId: string): boolean {
  return expandedThoughts.value.has(messageId);
}

function toggleThought(messageId: string): void {
  if (expandedThoughts.value.has(messageId)) {
    expandedThoughts.value.delete(messageId);
  } else {
    expandedThoughts.value.add(messageId);
  }
}

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

function getToolIcon(kind: string): string {
  switch (kind) {
    case 'read': return '📖';
    case 'edit': return '✏️';
    case 'delete': return '🗑️';
    case 'move': return '📦';
    case 'search': return '🔍';
    case 'execute': return '▶️';
    case 'think': return '💭';
    case 'fetch': return '🌐';
    default: return '🔧';
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'pending': return '⏳';
    case 'in_progress': return '⚙️';
    case 'completed': return '✓';
    case 'failed': return '✗';
    default: return '';
  }
}
</script>

<template>
  <div
    :class="['chat-view', { dragging }]"
    @dragover="handleDragOver"
    @dragleave="dragging = false"
    @drop="handleDrop"
  >
    <div class="chat-header">
      <h2>{{ currentSession?.title || 'Chat' }}</h2>
      <div class="header-right">
        <ModelPicker 
          v-if="availableModels.length > 0"
          :models="availableModels"
          :current-model-id="currentModelId"
          :disabled="isLoading"
          @change="handleModelChange"
        />
        <ModePicker 
          v-if="availableModes.length > 0"
          :modes="availableModes"
          :current-mode-id="currentModeId"
          :disabled="isLoading"
          @change="handleModeChange"
        />
        <span class="agent-name">{{ currentSession?.agentName }}</span>
      </div>
    </div>
    
    <div ref="messagesContainer" class="messages-container">
      <div 
        v-for="message in messages" 
        :key="message.id"
        :class="['message', `message-${message.role}`]"
      >
        <div class="message-header">
          <span class="role">{{ message.role === 'user' ? 'You' : 'Assistant' }}</span>
        </div>
        
        <!-- Agent thinking section (collapsible) - shown first to explain reasoning -->
        <div v-if="message.thought && message.role === 'assistant'" class="thought-section">
          <button class="thought-toggle" @click="toggleThought(message.id)">
            <span class="thought-icon">💭</span>
            <span class="thought-label">{{ isThoughtExpanded(message.id) ? 'Hide Thinking' : 'Show Thinking' }}</span>
            <span class="thought-chevron">{{ isThoughtExpanded(message.id) ? '▲' : '▼' }}</span>
          </button>
          <div v-if="isThoughtExpanded(message.id)" class="thought-content">
            <div v-html="renderMarkdown(message.thought)" />
          </div>
        </div>
        
        <!-- Tool calls for this message (shown after thinking) -->
        <div v-if="message.toolCalls?.length" class="tool-calls-section">
          <div 
            v-for="tc in message.toolCalls" 
            :key="tc.toolCallId"
            :class="['tool-call-inline', `tool-${tc.status}`]"
          >
            <span class="tool-icon">{{ getToolIcon(tc.kind) }}</span>
            <span class="tool-name">{{ tc.title }}</span>
            <span v-if="tc.locations?.length" class="tool-location">
              {{ tc.locations[0].path }}
            </span>
            <span :class="['tool-status', `status-${tc.status}`]">
              {{ getStatusIcon(tc.status) }}
            </span>
          </div>
        </div>
        
        <div 
          v-if="message.content"
          class="message-content"
          v-html="renderMarkdown(message.content)"
        />

        <div v-if="message.attachments?.length" class="message-attachments">
          <img
            v-for="(attachment, i) in message.attachments"
            :key="i"
            v-show="attachment.previewUrl"
            :src="attachment.previewUrl"
            :alt="attachment.name"
            :title="attachment.name"
          />
        </div>
        <ul v-if="message.notes?.length" class="message-notes">
          <li v-for="(note, i) in message.notes" :key="i">{{ note }}</li>
        </ul>
      </div>
      
      <!-- Loading indicator -->
      <div v-if="isLoading" class="loading-indicator">
        <span class="spinner"></span>
        <span>{{ pluginStore.status || 'Thinking...' }}</span>
        <button class="cancel-btn" @click="handleCancel">Cancel</button>
      </div>
    </div>
    
    <div v-if="pluginStore.notice" :class="['plugin-notice', `notice-${pluginStore.notice.kind}`]">
      {{ pluginStore.notice.message }}
    </div>
    <div v-if="attachments.length" class="attachment-strip">
      <div v-for="attachment in attachments" :key="attachment.id" class="attachment-chip" :title="attachment.name">
        <img v-if="attachment.previewUrl" :src="attachment.previewUrl" :alt="attachment.name" />
        <span v-else class="attachment-name">{{ attachment.name }}</span>
        <button class="attachment-remove" title="Remove" @click="pluginStore.removeAttachment(attachment.id)">×</button>
      </div>
    </div>
    <div class="input-container">
      <div v-if="composerButtons.length" class="composer-buttons">
        <button
          v-for="button in composerButtons"
          :key="`${button.pluginId}:${button.id}`"
          class="composer-btn"
          :title="button.title"
          :disabled="isLoading || isReconnecting"
          @click="runButton(button.onClick)"
        >{{ button.icon }}</button>
      </div>
      <CommandPalette
        ref="commandPaletteRef"
        :commands="availableCommands"
        :filter="commandFilter"
        :visible="showCommandPalette"
        @select="handleCommandSelect"
        @close="handleCommandClose"
      />
      <textarea
        v-model="inputText"
        :placeholder="
          isReconnecting
            ? 'Reconnecting…'
            : (availableCommands.length > 0
                ? 'Type your message... (/ for commands)'
                : 'Type your message...')
        "
        :disabled="isLoading || isReconnecting"
        @keydown="handleKeyDown"
        @paste="handlePaste"
        rows="3"
      />
      <button 
        class="send-btn"
        :disabled="!canSend"
        @click="handleSend"
      >
        Send
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Files held over the conversation: say it will take them */
.chat-view.dragging {
  outline: 2px dashed var(--text-accent, #0066cc);
  outline-offset: -6px;
}

.message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

.message-attachments img {
  max-height: 140px;
  max-width: 220px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #ccc);
}

.message-notes {
  margin: 0.4rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.78rem;
  color: var(--text-muted, #666);
}

.attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.5rem 1rem 0;
}

.attachment-chip {
  position: relative;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-assistant, #f5f5f5);
}

.attachment-chip img {
  display: block;
  height: 64px;
  max-width: 110px;
  object-fit: cover;
}

.attachment-name {
  display: block;
  padding: 0.4rem 1.6rem 0.4rem 0.6rem;
  font-size: 0.8rem;
}

.attachment-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  line-height: 1;
}

.composer-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.composer-btn {
  width: 2.4rem;
  height: 2.4rem;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-size: 1.1rem;
}

.composer-btn:hover:not(:disabled) {
  border-color: var(--text-accent, #0066cc);
}

.plugin-notice {
  margin: 0.5rem 1rem 0;
  padding: 0.45rem 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
  background: var(--bg-assistant, #f5f5f5);
}

.plugin-notice.notice-error {
  color: #b00020;
  border: 1px solid #f3b5bf;
}

.chat-header {
  padding: 1rem;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.chat-header h2 {
  margin: 0;
  font-size: 1.1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.agent-name {
  font-size: 0.875rem;
  color: var(--text-accent, #0066cc);
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.message {
  margin-bottom: 1rem;
  padding: 0.75rem;
  border-radius: 8px;
}

.message-user {
  background: var(--bg-user, #e3f2fd);
  margin-left: 2rem;
}

.message-assistant {
  background: var(--bg-assistant, #f5f5f5);
  margin-right: 2rem;
}

.message-header {
  margin-bottom: 0.5rem;
}

.role {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-secondary, #666);
}

/* Tool calls inline styles */
.tool-calls-section {
  margin-bottom: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tool-call-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.625rem;
  border-radius: 4px;
  font-size: 0.8rem;
  background: rgba(0, 0, 0, 0.04);
  border-left: 2px solid var(--border-color);
}

.tool-pending {
  border-left-color: #f59e0b;
}

.tool-in_progress {
  border-left-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
}

.tool-completed {
  border-left-color: #10b981;
  background: rgba(16, 185, 129, 0.08);
}

.tool-failed {
  border-left-color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

.tool-icon {
  font-size: 0.875rem;
}

.tool-name {
  font-weight: 500;
  color: var(--text-primary);
}

.tool-location {
  flex: 1;
  color: var(--text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-status {
  font-size: 0.75rem;
  font-weight: 600;
}

.status-pending { color: #f59e0b; }
.status-in_progress { color: #3b82f6; }
.status-completed { color: #10b981; }
.status-failed { color: #ef4444; }

.message-content {
  line-height: 1.5;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

.message-content :deep(p) {
  margin: 0.5rem 0;
}

.message-content :deep(ol),
.message-content :deep(ul) {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.message-content :deep(li) {
  margin: 0.25rem 0;
}

.message-content :deep(pre) {
  background: var(--bg-code, #282c34);
  color: var(--text-code, #abb2bf);
  padding: 0.75rem;
  border-radius: 4px;
  overflow-x: auto;
}

.message-content :deep(code) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9rem;
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  color: var(--text-muted, #666);
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color, #ccc);
  border-top-color: var(--text-accent, #0066cc);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.cancel-btn {
  margin-left: auto;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  background: transparent;
  font-size: 0.8rem;
  cursor: pointer;
}

.input-container {
  position: relative;
  display: flex;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

textarea {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  font-size: 1rem;
  font-family: inherit;
  resize: none;
}

textarea:focus {
  outline: none;
  border-color: var(--text-accent, #0066cc);
}

.send-btn {
  padding: 0.75rem 1.5rem;
  background: var(--bg-primary, #0066cc);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.send-btn:hover:not(:disabled) {
  background: var(--bg-primary-hover, #0052a3);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ---------- Mobile / narrow-viewport tweaks ---------- */

@media (max-width: 800px) {
  /* Reserve space for the floating mobile hamburger (44px wide, fixed in
     App.vue) so the mode/model pickers don't sit underneath it. Also push
     the header below the camera notch / status bar so picker buttons aren't
     clipped on phones with a hole-punch or notch. */
  .chat-header {
    padding-top: calc(1rem + env(safe-area-inset-top, 0px));
    padding-left: calc(44px + 1rem);
  }

  /* Agent identity is already shown in the sidebar drawer; on a phone the
     chat header should belong to mode/model/actions. Hiding the long name
     also avoids awkward 4-line wraps for names like "Copilot CLI dev tunnel". */
  .agent-name {
    display: none;
  }

  /* Session title is also redundant on mobile (visible in the sidebar
     SessionList) and otherwise gets crushed to a single character by the
     mode/model pickers. Reclaim the horizontal space. */
  .chat-header h2 {
    display: none;
  }

  .input-container {
    /* iOS home-indicator: keep Send button reachable above the gesture area. */
    padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    gap: 0.5rem;
  }

  textarea {
    /* Avoid iOS auto-zoom on focus when font-size < 16px. */
    font-size: 16px;
    min-height: 44px;
  }

  .send-btn {
    min-width: 64px;
    min-height: 44px;
    padding: 0.5rem 1rem;
  }
}

/* Agent Thinking Section */
.thought-section {
  margin-bottom: 0.75rem;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
}

.thought-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: var(--bg-hover, #f5f5f5);
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--text-muted, #666);
  text-align: left;
  transition: background 0.15s ease;
}

.thought-toggle:hover {
  background: var(--bg-user, #e3f2fd);
}

.thought-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.thought-label {
  flex: 1;
  font-weight: 500;
}

.thought-chevron {
  font-size: 0.7rem;
  color: var(--text-muted, #999);
}

.thought-content {
  padding: 0.75rem 1rem 0.75rem 1.25rem;
  background: var(--bg-main, #fafafa);
  border-top: 1px solid var(--border-color, #e0e0e0);
  font-size: 0.9rem;
  color: var(--text-muted, #666);
  font-style: italic;
  line-height: 1.5;
}

.thought-content :deep(p) {
  margin: 0 0 0.5rem 0;
}

.thought-content :deep(p:last-child) {
  margin-bottom: 0;
}

.thought-content :deep(code) {
  background: var(--bg-hover, #f0f0f0);
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  font-size: 0.85em;
}
</style>
