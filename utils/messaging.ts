// utils/messaging.ts
// Typed message passing helpers between background service worker and content scripts

/**
 * Sends a message from the background service worker to a specific tab's content script.
 * @param tabId Target tab ID
 * @param message Message payload
 */
export function sendToContent<T = unknown>(tabId: number, message: unknown): Promise<T> {
  // TODO: Implement in chunks
  throw new Error("Not implemented");
}

/**
 * Sends a message from a content script to the background service worker.
 * @param message Message payload
 */
export function sendToBackground<T = unknown>(message: unknown): Promise<T> {
  // TODO: Implement in chunks
  throw new Error("Not implemented");
}
