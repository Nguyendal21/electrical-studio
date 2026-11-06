const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const REPLACE_RETRY_DELAYS = [25, 50, 100, 200, 400];
const transientReplaceError = error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
const fingerprint = content => createHash('sha256').update(content).digest('hex');

function validateDocument(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new Error('Sơ đồ phải là tệp JSON không quá 2 MB.');
  }
  let project;
  try { project = JSON.parse(content); } catch { throw new Error('Không đọc được nội dung JSON của sơ đồ.'); }
  if (!project || project.version !== 2 || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 120
    || !Array.isArray(project.devices) || project.devices.length > 250 || !Array.isArray(project.wires) || project.wires.length > 750) {
    throw new Error('Tệp không có định dạng sơ đồ Electrical Studio phiên bản 2.');
  }
  return content;
}

function suggestedFileName(value) {
  const supplied = typeof value === 'string' ? value : 'Sơ đồ mới';
  const base = path.win32.basename(supplied).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 160) || 'Sơ đồ mới';
  return /\.json$/i.test(base) ? base : `${base}.electrical.json`;
}

// Only native dialogs grant a path. Renderer requests refer to opaque, session-
// local IDs; renderer-supplied paths are never accepted by this service.
function createDocumentFiles({ chooseOpen, chooseSave, confirmConflict, documentsPath }, {
  rename = fs.rename,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  const documents = new Map();
  let queue = Promise.resolve();
  const serialized = action => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const describe = document => ({ documentId: document.id, fileName: path.basename(document.path), path: document.path });
  async function readBounded(filename) {
    const handle = await fs.open(filename, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) throw new Error('Sơ đồ phải là tệp JSON không quá 2 MB.');
      // Bound the allocation even if another program grows the file after stat.
      const buffer = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_DOCUMENT_BYTES) throw new Error('Sơ đồ phải là tệp JSON không quá 2 MB.');
      return buffer.subarray(0, length).toString('utf8');
    } finally { await handle.close(); }
  }
  async function changed(document) {
    try { return fingerprint(await readBounded(document.path)) !== document.fingerprint; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  }
  async function destinationFingerprint(filename) {
    try { return fingerprint(await readBounded(filename)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function writeAtomic(filename, content) {
    const originalFingerprint = await destinationFingerprint(filename);
    const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx');
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          // Windows readers or antivirus can briefly deny atomic replacement.
          // Never remove the destination or fall back to an in-place write.
          await rename(temporary, filename);
          break;
        } catch (error) {
          if (!transientReplaceError(error) || attempt >= REPLACE_RETRY_DELAYS.length) throw error;
          await wait(REPLACE_RETRY_DELAYS[attempt]);
          if (await destinationFingerprint(filename) !== originalFingerprint) {
            throw new Error('Tệp đã được thay đổi bên ngoài ứng dụng trong lúc lưu. Nhấn Ctrl+S để chọn cách lưu.');
          }
        }
      }
    } finally {
      await handle?.close().catch(() => {});
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  return {
    open: () => serialized(async () => {
      const filename = await chooseOpen(documentsPath);
      if (!filename) return null;
      const content = validateDocument(await readBounded(filename));
      const document = { id: randomUUID(), path: filename, fingerprint: fingerprint(content) };
      documents.set(document.id, document);
      return { ...describe(document), content };
    }),
    save: request => serialized(async () => {
      if (!request || typeof request !== 'object') throw new Error('Yêu cầu lưu sơ đồ không hợp lệ.');
      const content = validateDocument(request.content);
      if (request.documentId !== undefined && (typeof request.documentId !== 'string' || !documents.has(request.documentId))) {
        throw new Error('Vị trí lưu không còn hợp lệ. Hãy mở lại tệp hoặc chọn Lưu thành.');
      }
      let document = documents.get(request.documentId);
      if (request.automatic && (!document || request.saveAs)) return null;
      let saveAs = !!request.saveAs || !document;
      if (!saveAs && await changed(document)) {
        if (request.automatic) throw new Error('Tệp đã được thay đổi bên ngoài ứng dụng. Tạm dừng tự lưu; nhấn Ctrl+S để chọn cách lưu.');
        const decision = await confirmConflict(document.path);
        if (decision === 'cancel') return null;
        saveAs = decision === 'saveAs';
        if (!saveAs && decision !== 'overwrite') return null;
      }
      if (saveAs) {
        const filename = await chooseSave(document?.path ?? path.join(documentsPath, suggestedFileName(request.suggestedName)));
        if (!filename) return null;
        document = { id: randomUUID(), path: filename, fingerprint: '' };
      }
      await writeAtomic(document.path, content);
      document.fingerprint = fingerprint(content);
      documents.set(document.id, document);
      // Refresh other tokens to the same file after an intentional write.
      for (const entry of documents.values()) if (entry.path === document.path) entry.fingerprint = document.fingerprint;
      return describe(document);
    }),
  };
}

function trustedDocumentSender(event, window, url) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === url;
}

module.exports = { createDocumentFiles, trustedDocumentSender, validateDocument, MAX_DOCUMENT_BYTES };
