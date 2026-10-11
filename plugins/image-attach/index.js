// Images: pictures attached to a message, sent to the agent as ACP image content blocks.
// Three ways in - the 📎 button, pasting, and dropping files on the conversation - and one way out:
// a thumbnail in the message box until it is sent, removable with its ×.

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const FALLBACK_MAX_IMAGES = 4;
const FALLBACK_MAX_BYTES = 10 * 1024 * 1024;

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function activate(api) {
  // What the agent said it takes: Qwen Code, for one, says 4 pictures of up to ~10 MB a turn
  function limits() {
    const meta = api.session.capabilitiesMeta?.imageCapability || {};
    return { images: meta.maxImagesPerTurn || FALLBACK_MAX_IMAGES, bytes: meta.maxBytes || FALLBACK_MAX_BYTES };
  }

  function mine() {
    return api.composer.attachments.filter(a => a.pluginId === api.id);
  }

  function agentTakesPictures() {
    if (!api.session.isConnected) {
      api.ui.notify('Start a session first, then add the picture.', 'error');
      return false;
    }
    if (!api.session.promptCapabilities?.image) {
      api.ui.notify('This agent does not accept pictures (it did not say it supports image content).', 'error');
      return false;
    }
    return true;
  }

  /** Scaled down when either side is over the limit; otherwise the original bytes, untouched. */
  async function fitted(bytes, mimeType) {
    const maxSide = Number(api.settings.get('maxSide') ?? 2048);
    if (!maxSide || mimeType === 'image/gif' || mimeType === 'image/svg+xml') return { bytes, mimeType };
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    } catch {
      return { bytes, mimeType };    // not decodable here; the agent may still read it
    }
    const scale = maxSide / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) {
      bitmap.close();
      return { bytes, mimeType };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    // A screenshot stays PNG, so text in it stays sharp; a photo becomes JPEG, which is far smaller
    const type = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.9));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: type };
  }

  async function add(name, mimeType, bytes) {
    if (!mimeType.startsWith('image/')) {
      api.ui.notify(`${name} is not a picture.`, 'error');
      return;
    }
    const { images, bytes: maxBytes } = limits();
    if (mine().length >= images) {
      api.ui.notify(`The agent takes at most ${images} pictures in one message.`, 'error');
      return;
    }
    const ready = await fitted(bytes, mimeType);
    if (ready.bytes.length > maxBytes) {
      api.ui.notify(`${name} is ${(ready.bytes.length / 1048576).toFixed(1)} MB; the agent takes up to ${(maxBytes / 1048576).toFixed(0)} MB.`, 'error');
      return;
    }
    const data = toBase64(ready.bytes);
    api.composer.addAttachment({
      name,
      size: ready.bytes.length,
      previewUrl: `data:${ready.mimeType};base64,${data}`,
      block: { type: 'image', mimeType: ready.mimeType, data },
    });
  }

  async function addFiles(files) {
    const pictures = [...files].filter(f => f.type.startsWith('image/'));
    if (!pictures.length) return false;
    if (!agentTakesPictures()) return true;
    for (const [i, file] of pictures.entries()) {
      const name = file.name && file.name !== 'image.png' ? file.name : `pasted-${Date.now()}-${i + 1}.png`;
      await add(name, file.type, new Uint8Array(await file.arrayBuffer()));
    }
    return true;
  }

  api.composer.addButton({
    id: 'attach',
    icon: '📎',
    title: 'Attach pictures (or paste them, or drop them on the conversation)',
    async onClick() {
      if (!agentTakesPictures()) return;
      const picked = await api.files.pick({ title: 'Attach pictures', extensions: EXTENSIONS, multiple: true });
      for (const file of picked) await add(file.name, file.mimeType, fromBase64(file.base64));
    },
  });

  api.composer.onPaste(event => addFiles(event.clipboardData?.files || []));
  api.composer.onDrop(event => addFiles(event.dataTransfer?.files || []));
}
