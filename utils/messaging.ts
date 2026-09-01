// utils/messaging.ts
// Typed message passing helpers between background service worker and content scripts

import type { PrivisMessage, PrivisMessageType } from "../types/index.js";

const VALID_MESSAGE_TYPES: ReadonlySet<PrivisMessageType> = new Set<PrivisMessageType>([
  "capture.request",
  "capture.response",
  "execute.request",
  "execute.response",
  "ping",
  "pong",
]);

/**
 * Type guard to validate whether an unknown value is a valid PrivisMessage.
 */
export function isPrivisMessage(message: unknown): message is PrivisMessage {
  if (!message || typeof message !== "object") {
    return false;
  }
  const candidate = message as { type?: unknown };
  return typeof candidate.type === "string" && VALID_MESSAGE_TYPES.has(candidate.type as PrivisMessageType);
}

/**
 * Sends a message from the background service worker to a specific tab's content script.
 * @param tabId Target tab ID
 * @param message Message payload
 */
export async function sendToContent<T = unknown>(tabId: number, message: PrivisMessage): Promise<T> {
  if (!isPrivisMessage(message)) {
    throw new Error(`Invalid PrivisMessage: ${String((message as { type?: unknown })?.type ?? message)}`);
  }
  if (typeof chrome === "undefined" || !chrome.tabs?.sendMessage) {
    throw new Error("chrome.tabs.sendMessage is not available");
  }
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

/**
 * Sends a message from a content script to the background service worker.
 * @param message Message payload
 */
export async function sendToBackground<T = unknown>(message: PrivisMessage): Promise<T> {
  if (!isPrivisMessage(message)) {
    throw new Error(`Invalid PrivisMessage: ${String((message as { type?: unknown })?.type ?? message)}`);
  }
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("chrome.runtime.sendMessage is not available");
  }
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

