// utils/messaging.ts
// Typed message passing helpers between background service worker and content scripts

import type { PrivisMessage } from "../types/index.js";

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

/**
 * Type guard to validate whether an unknown value is a valid PrivisMessage and has valid payloads.
 */
export function isPrivisMessage(message: unknown): message is PrivisMessage {
  if (!isObject(message)) {
    return false;
  }
  const candidate = message as { type?: unknown; payload?: unknown };
  if (typeof candidate.type !== "string") {
    return false;
  }

  switch (candidate.type) {
    case "ping":
    case "pong":
    case "capture.request":
      return true;

    case "capture.response": {
      if (!isObject(candidate.payload)) return false;
      const payload = candidate.payload;
      return (
        Array.isArray(payload.elements) &&
        isObject(payload.browserState) &&
        typeof payload.browserState.url === "string" &&
        typeof payload.browserState.title === "string" &&
        isObject(payload.browserState.viewport) &&
        typeof payload.browserState.viewport.w === "number" &&
        typeof payload.browserState.viewport.h === "number"
      );
    }

    case "execute.request": {
      if (!isObject(candidate.payload)) return false;
      return Array.isArray(candidate.payload.actions);
    }

    case "execute.response": {
      if (!isObject(candidate.payload)) return false;
      return Array.isArray(candidate.payload.results);
    }

    default:
      return false;
  }
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

