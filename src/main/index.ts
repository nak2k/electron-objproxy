import { app, ipcMain, webContents, type WebContents } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { ClassMap, CreateObjectRequest, GetSingletonRequest, GetSingletonSyncRequest, CallMethodRequest, ReleaseObjectsMessage, CallWithPortMessage, ExtensionMetadata } from '../common/types.js';
import { IPC_CHANNEL, EXTENSION_METADATA } from '../common/constants.js';

export { EXTENSION_METADATA } from '../common/constants.js';
export type { ExtensionMetadata, TransferablePort } from '../common/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration options for initializing the object proxy system.
 */
export interface InitObjProxyOptions {
  /** Map of class names to their constructors */
  classMap: ClassMap;
}

/**
 * Metadata interface for objects in the main process.
 */
interface ObjectMetadataMain {
  /** Unique identifier for the object */
  objectId: number;
  /**
   * Set of WebContents to forward events to.
   * For non-singleton objects this contains exactly one entry (the creator and lifecycle owner).
   * For singleton objects this accumulates every WebContents that has obtained the singleton.
   */
  senders: Set<WebContents>;
}

/**
 * Map to store objects managed by the main process.
 */
const objectMap: Record<number, object> = {};

/**
 * Map to store singleton objects by class name.
 * Singletons are never released once created.
 */
const singletonMap: Record<string, number> = {};

/**
 * Next object ID to be assigned.
 */
let nextObjectId = 1;

/**
 * Registered class map for object creation.
 */
let registeredClassMap: ClassMap = {};

/**
 * Symbol used to store metadata on objects.
 */
const OBJECT_METADATA_SYMBOL = Symbol('ELECTRON_OBJ_PROXY_MAIN_METADATA');

/**
 * Handles IPC invoke requests from renderer processes.
 */
async function handleInvokeRequest(
  event: Electron.IpcMainInvokeEvent,
  payload: CreateObjectRequest | GetSingletonRequest | CallMethodRequest
): Promise<any> {
  switch (payload.type) {
    case 'new': {
      const { className, args } = payload;
      return handleObjectCreation(event.sender, className, args);
    }

    case 'getSingleton': {
      const { className, args } = payload;
      return handleGetSingleton(event.sender, className, args);
    }

    case 'call': {
      const { objectId, method, args } = payload;
      return handleMethodCall(objectId, method, args);
    }

    default:
      throw new Error(`Unknown invoke request type: ${(payload as any).type}`);
  }
}

/**
 * Handles IPC send requests from renderer processes.
 */
function handleSendRequest(
  event: Electron.IpcMainEvent,
  message: ReleaseObjectsMessage | GetSingletonSyncRequest | CallWithPortMessage
): void {
  switch (message.type) {
    case 'release': {
      const { objectIds } = message;
      handleObjectRelease(objectIds);
      break;
    }

    case 'getSingletonSync': {
      const { className, args } = message;
      const result = handleGetSingleton(event.sender, className, args);
      event.returnValue = result;
      break;
    }

    case 'callWithPort': {
      const { objectId, method, args } = message;
      handleMethodCallWithPort(objectId, method, args, event.ports);
      break;
    }

    default:
      console.warn(`Unknown send request type: ${(message as any).type}`);
  }
}

/**
 * Creates a new object instance and manages it.
 */
function handleObjectCreation(
  sender: WebContents,
  className: string,
  args: unknown[]
): { objectId: number; isEventTarget: boolean; extensions?: ExtensionMetadata } {
  const ClassConstructor = (registeredClassMap as Record<string, new (...args: any[]) => any>)[className];
  if (!ClassConstructor) {
    throw new Error(`Class '${className}' is not registered in classMap`);
  }

  // Create object instance
  const instance = new ClassConstructor(...args);
  const objectId = nextObjectId++;

  // Create and attach metadata. Initial senders Set contains only the requesting WebContents.
  const metadata: ObjectMetadataMain = { objectId, senders: new Set([sender]) };
  (instance as any)[OBJECT_METADATA_SYMBOL] = metadata;

  // Store in object map
  objectMap[objectId] = instance;

  // Check if object is EventTarget and override dispatchEvent if needed
  const isEventTarget = instance instanceof EventTarget;
  if (isEventTarget) {
    overrideDispatchEvent(instance as EventTarget);
  }

  // Read extension metadata from class static property
  const extensions = (ClassConstructor as any)[EXTENSION_METADATA] as ExtensionMetadata | undefined;

  return { objectId, isEventTarget, extensions };
}

/**
 * Gets or creates a singleton object instance.
 * If a singleton for the given class already exists, returns its object ID.
 * Otherwise, creates a new instance and registers it as a singleton.
 */
function handleGetSingleton(
  sender: WebContents,
  className: string,
  args: unknown[]
): { objectId: number; isEventTarget: boolean; extensions?: ExtensionMetadata } {
  // Check if singleton already exists
  const existingObjectId = singletonMap[className];
  if (existingObjectId !== undefined) {
    const instance = objectMap[existingObjectId];
    if (instance) {
      const metadata = (instance as any)[OBJECT_METADATA_SYMBOL] as ObjectMetadataMain;
      // Subscribe this sender to broadcasts (no-op if already subscribed).
      metadata.senders.add(sender);

      const isEventTarget = instance instanceof EventTarget;

      // Read extension metadata from class
      const ClassConstructor = (registeredClassMap as Record<string, any>)[className];
      const extensions = (ClassConstructor as any)?.[EXTENSION_METADATA] as ExtensionMetadata | undefined;

      return { objectId: existingObjectId, isEventTarget, extensions };
    }
  }

  // Singleton doesn't exist, create new instance
  const result = handleObjectCreation(sender, className, args);

  // Register as singleton
  singletonMap[className] = result.objectId;

  return result;
}

/**
 * Handles method calls on managed objects.
 */
async function handleMethodCall(
  objectId: number,
  method: string,
  args: unknown[]
): Promise<unknown> {
  const instance = objectMap[objectId];
  if (!instance) {
    throw new Error(`Object with ID ${objectId} not found`);
  }

  const methodFn = (instance as any)[method];
  if (typeof methodFn !== 'function') {
    throw new Error(`Method '${method}' not found on object with ID ${objectId}`);
  }

  // Call the method and return the result
  return methodFn.apply(instance, args);
}

/**
 * Handles method calls with MessagePort transfer (fire-and-forget).
 * Ports are passed as the last argument to the method as MessagePortMain[].
 */
function handleMethodCallWithPort(
  objectId: number,
  method: string,
  args: unknown[],
  ports: Electron.MessagePortMain[]
): void {
  const instance = objectMap[objectId];
  if (!instance) {
    console.warn(`Object with ID ${objectId} not found for callWithPort`);
    return;
  }

  const methodFn = (instance as any)[method];
  if (typeof methodFn !== 'function') {
    console.warn(`Method '${method}' not found on object with ID ${objectId}`);
    return;
  }

  // Call the method with args + ports as last argument
  methodFn.apply(instance, [...args, ports]);
}

/**
 * Handles object release requests.
 */
function handleObjectRelease(objectIds: number[]): void {
  for (const objectId of objectIds) {
    delete objectMap[objectId];
  }
}

/**
 * Cleans up references to a destroyed WebContents.
 * - Non-singleton objects whose owner matches `wc` are released.
 * - Singleton objects keep living, but `wc` is removed from their senders set so
 *   future dispatches do not target the dead WebContents.
 * Invoked when a WebContents is destroyed (e.g., window closed).
 */
function releaseObjectsForWebContents(wc: WebContents): void {
  const singletonIds = new Set(Object.values(singletonMap));
  for (const key of Object.keys(objectMap)) {
    const objectId = Number(key);
    const instance = objectMap[objectId];
    const metadata = (instance as any)?.[OBJECT_METADATA_SYMBOL] as ObjectMetadataMain | undefined;
    if (!metadata) {
      continue;
    }
    if (singletonIds.has(objectId)) {
      metadata.senders.delete(wc);
      continue;
    }
    if (metadata.senders.has(wc)) {
      delete objectMap[objectId];
    }
  }
}

/**
 * Registers a destroyed listener on a WebContents to auto-release its objects.
 */
function watchWebContents(wc: WebContents): void {
  wc.once('destroyed', () => {
    releaseObjectsForWebContents(wc);
  });
}

/**
 * Overrides the dispatchEvent method of an EventTarget to broadcast events to all
 * subscribed renderer WebContents.
 */
function overrideDispatchEvent(eventTarget: EventTarget): void {
  const metadata = (eventTarget as any)[OBJECT_METADATA_SYMBOL] as ObjectMetadataMain;

  const originalDispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);

  eventTarget.dispatchEvent = function (event: Event): boolean {
    // Call original dispatchEvent first
    const result = originalDispatchEvent(event);

    // Broadcast to every currently-subscribed WebContents.
    // Senders may be empty (singleton created via main proxy with no renderer attached yet);
    // the loop simply no-ops in that case and may receive subscribers later.
    for (const sender of metadata.senders) {
      try {
        if (!sender.isDestroyed()) {
          sender.send(IPC_CHANNEL, {
            type: 'event',
            objectId: metadata.objectId,
            eventType: event.type,
            detail: (event as any).detail,
          });
        }
      } catch (error) {
        console.warn('Failed to forward event to renderer:', error);
      }
    }

    return result;
  };
}

/**
 * Type for singleton object that provides convenient access to singleton instances.
 * Properties correspond to class names in ClassMap.
 */
export type SingletonObject = { readonly [K in keyof ClassMap]: InstanceType<ClassMap[K]> };

/**
 * Singleton object proxy for convenient singleton access in main process.
 * Properties correspond to class names in ClassMap.
 * Each property access returns the singleton instance for that class.
 *
 * @example
 * // Get singleton instance
 * const logger = singleton.Logger;
 *
 * // Type-safe access
 * const config = singleton.Config;
 */
export const singleton: SingletonObject = new Proxy({} as SingletonObject, {
  get(_target, prop: string | symbol) {
    if (typeof prop === 'string') {
      const classNameStr = prop;

      // Check if singleton already exists
      const existingObjectId = singletonMap[classNameStr];
      if (existingObjectId !== undefined) {
        const instance = objectMap[existingObjectId];
        if (instance) {
          return instance;
        }
      }

      // Create new singleton with empty args
      const ClassConstructor = (registeredClassMap as Record<string, new (...args: any[]) => any>)[classNameStr];
      if (!ClassConstructor) {
        throw new Error(`Class '${classNameStr}' is not registered in classMap`);
      }

      const instance = new ClassConstructor();
      const objectId = nextObjectId++;

      // Initialize metadata with an empty senders Set: no renderer has subscribed yet,
      // and renderers will be appended as they call getSingleton.
      const metadata: ObjectMetadataMain = { objectId, senders: new Set() };
      (instance as any)[OBJECT_METADATA_SYMBOL] = metadata;

      objectMap[objectId] = instance;
      singletonMap[classNameStr] = objectId;

      // Override dispatchEvent up front so future subscribers receive events.
      if (instance instanceof EventTarget) {
        overrideDispatchEvent(instance as EventTarget);
      }

      return instance;
    }
    return undefined;
  }
});

/**
 * Internal testing helpers. Not part of the public API.
 * Exposed for E2E tests that need to observe main-process state.
 */
export const __testing__ = {
  /** Returns the list of currently managed object IDs. */
  getManagedObjectIds(): number[] {
    return Object.keys(objectMap).map(Number);
  },
  /** Returns the list of object IDs registered as singletons. */
  getSingletonObjectIds(): number[] {
    return Object.values(singletonMap);
  },
  /**
   * Returns the number of WebContents subscribed to a singleton's events,
   * or 0 if the singleton does not exist.
   */
  getSingletonSenderCount(className: string): number {
    const objectId = singletonMap[className];
    if (objectId === undefined) {
      return 0;
    }
    const instance = objectMap[objectId];
    if (!instance) {
      return 0;
    }
    const metadata = (instance as any)[OBJECT_METADATA_SYMBOL] as ObjectMetadataMain | undefined;
    return metadata?.senders.size ?? 0;
  },
};

/**
 * Initializes the electron-objproxy system in the main process.
 *
 * @param options - Configuration options including the class map
 */
export async function initObjProxy(options: InitObjProxyOptions): Promise<void> {
  registeredClassMap = options.classMap;

  // Register IPC handlers
  ipcMain.handle(IPC_CHANNEL, handleInvokeRequest);
  ipcMain.on(IPC_CHANNEL, handleSendRequest);

  // Register preload script for all sessions
  const preloadPath = join(__dirname, '../preload/index.cjs');

  // Handle future sessions
  app.on('session-created', (session) => {
    session.registerPreloadScript({
      filePath: preloadPath,
      type: 'frame',
    });
  });

  // Auto-release objects when their owning WebContents is destroyed
  app.on('web-contents-created', (_event, wc) => {
    watchWebContents(wc);
  });

  // Handle sessions for existing webContents
  const allWebContents = webContents.getAllWebContents();
  for (const wc of allWebContents) {
    const wcSession = wc.session;
    if (wcSession) {
      wcSession.registerPreloadScript({
        filePath: preloadPath,
        type: 'frame',
      });
    }
    watchWebContents(wc);
  }
}
