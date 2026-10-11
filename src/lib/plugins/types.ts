// Plugins: what a plugin declares about itself, and the API it is given when it starts.
//
// A plugin is a folder in <config dir>/acp-ui/plugins/<id>/ holding plugin.json (the manifest
// below) and one ES module, named by `main`, whose `activate(api)` is called when ACP UI starts or
// when the plugin is switched on. The module runs with the app's own privileges - there is no
// sandbox - which is why installing one asks for confirmation first.
import type { ContentBlock } from '@agentclientprotocol/sdk';
import type { ModelInfo } from '../types';

export type SettingType = 'text' | 'password' | 'toggle' | 'select' | 'model' | 'textarea';

/** One setting a plugin shows in Settings > Plugins. Its value is read with api.settings.get. */
export interface PluginSetting {
  key: string;
  label: string;
  type: SettingType;
  default?: string | boolean;
  help?: string;
  /** For `select`: the choices. `model` lists the session's models instead. */
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** The ES module to load, relative to the plugin's folder. */
  main: string;
  settings?: PluginSetting[];
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  dir: string;
  enabled: boolean;
  /** Set when the plugin failed to load or threw from activate(). */
  error?: string;
  /** Where it was installed from, so it can be updated from there again. */
  source?: string;
}

/** Something waiting in the message box to go with the next message, such as a picture. */
export interface Attachment {
  id: string;
  /** Which plugin added it. */
  pluginId: string;
  name: string;
  /** What is sent to the agent with the message. */
  block: ContentBlock;
  /** A data: URL to show as a thumbnail, when there is one. */
  previewUrl?: string;
  size?: number;
}

/** What a beforePrompt hook sees, and may change, for the message about to be sent. */
export interface PromptContext {
  text: string;
  readonly attachments: readonly Attachment[];
  /** Blocks added after the text and the attachments. */
  extraBlocks: ContentBlock[];
  /** Short lines shown under the sent message, e.g. "Routed to Gemma 4 (vision)". */
  notes: string[];
  /** Set to stop the message being sent; the reason is shown instead. */
  cancel?: string;
}

export interface ComposerButton {
  id: string;
  icon: string;
  title: string;
  onClick: () => void | Promise<void>;
}

export interface PickedFile {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  base64: string;
}

export interface PluginApi {
  readonly id: string;
  readonly manifest: PluginManifest;
  settings: {
    get<T = string | boolean>(key: string): T | undefined;
    set(key: string, value: string | boolean): Promise<void>;
  };
  session: {
    /** promptCapabilities from the agent's initialize answer (image, audio, embeddedContext). */
    readonly promptCapabilities: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
    /** The agent's own extra information about capabilities (_meta), e.g. image size limits. */
    readonly capabilitiesMeta: Record<string, unknown>;
    readonly models: readonly ModelInfo[];
    readonly currentModelId: string;
    readonly isConnected: boolean;
    setModel(modelId: string): Promise<void>;
  };
  composer: {
    addButton(button: ComposerButton): void;
    addAttachment(attachment: Omit<Attachment, 'id' | 'pluginId'>): string;
    removeAttachment(id: string): void;
    readonly attachments: readonly Attachment[];
    /** Called on paste into the message box; return true when the plugin handled it. */
    onPaste(handler: (event: ClipboardEvent) => boolean | Promise<boolean>): void;
    /** Called when files are dropped on the conversation; return true when handled. */
    onDrop(handler: (event: DragEvent) => boolean | Promise<boolean>): void;
  };
  hooks: {
    /** Runs before each message is sent, in the order plugins were loaded. */
    beforePrompt(handler: (context: PromptContext) => void | Promise<void>): void;
  };
  files: {
    /** The native open dialog; the files come back read, as base64. */
    pick(options: { title?: string; extensions?: string[]; multiple?: boolean }): Promise<PickedFile[]>;
  };
  /** fetch() from the app itself, so CORS does not apply. */
  http: { fetch(url: string, init?: RequestInit): Promise<Response> };
  ui: {
    notify(message: string, kind?: 'info' | 'error'): void;
    /** A short line in the "working" indicator while a hook runs, e.g. "Choosing a model…". */
    setStatus(text: string | null): void;
  };
}

/** The shape of a plugin's module. */
export interface PluginModule {
  activate(api: PluginApi): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
