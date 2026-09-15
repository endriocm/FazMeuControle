import { isRecognizedFinancialData } from "./finance-schema.mjs";

const updatedAt = (data, fallback = "") => Date.parse(data?.updatedAt || fallback) || 0;
const pendingKey = (key) => `${key}__pending_sync_v1`;

export function readPendingFinancialData(storage, key) {
  try {
    const payload = JSON.parse(storage.getItem(pendingKey(key)));
    return isRecognizedFinancialData(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function preservePendingFinancialData(storage, key, payload) {
  storage.setItem(pendingKey(key), JSON.stringify(payload));
}

export function acknowledgeFinancialData(storage, key, payload) {
  const pending = readPendingFinancialData(storage, key);
  // Uma confirmação antiga não pode apagar uma edição feita durante o envio.
  if (pending && JSON.stringify(pending) === JSON.stringify(payload)) {
    storage.removeItem(pendingKey(key));
    return true;
  }
  return false;
}

export function resolveFinancialHydration(remote, local, options = {}) {
  if (isRecognizedFinancialData(options.pendingData)) {
    const payload = isRecognizedFinancialData(local) && updatedAt(local) > updatedAt(options.pendingData)
      ? local : options.pendingData;
    // A cópia integral preserva também exclusões, inclusive uma conta vazia.
    return { payload, needsSync: true };
  }
  if (isRecognizedFinancialData(local)
    && (!isRecognizedFinancialData(remote) || updatedAt(local) > updatedAt(remote, options.remoteClientUpdatedAt))) {
    return { payload: local, needsSync: true };
  }
  return { payload: remote, needsSync: false };
}
