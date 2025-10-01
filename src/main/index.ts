import { app, ipcMain, webContents, type WebContents } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { ClassMap, CreateObjectRequest, GetSingletonRequest, CallMethodRequest, ReleaseObjectsMessage } from '../common/types.js';
import { IPC_CHANNEL } from '../common/constants.js';

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
  /** WebContents that requested the object creation, used for event forwarding */
  sender: WebContents;
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
  _event: Electron.IpcMainEvent,
  message: ReleaseObjectsMessage
): void {
  switch (message.type) {
    case 'release': {
      const { objectIds } = message;
      handleObjectRelease(objectIds);
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
): { objectId: number; isEventTarget: boolean } {
  const ClassConstructor = (registeredClassMap as Record<string, new (...args: any[]) => any>)[className];
  if (!ClassConstructor) {
    throw new Error(`Class '${className}' is not registered in classMap`);
  }

  // Create object instance
  const instance = new ClassConstructor(...args);
  const objectId = nextObjectId++;

  // Create and attach metadata
  const metadata: ObjectMetadataMain = { objectId, sender };
  (instance as any)[OBJECT_METADATA_SYMBOL] = metadata;

  // Store in object map
  objectMap[objectId] = instance;

  // Check if object is EventTarget and override dispatchEvent if needed
  const isEventTarget = instance instanceof EventTarget;
  if (isEventTarget) {
    overrideDispatchEvent(instance as EventTarget);
  }

  return { objectId, isEventTarget };
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
): { objectId: number; isEventTarget: boolean } {
  // Check if singleton already exists
  const existingObjectId = singletonMap[className];
  if (existingObjectId !== undefined) {
    const instance = objectMap[existingObjectId];
    if (instance) {
      const isEventTarget = instance instanceof EventTarget;
      return { objectId: existingObjectId, isEventTarget };
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
 * Handles object release requests.
 */
function handleObjectRelease(objectIds: number[]): void {
  for (const objectId of objectIds) {
    delete objectMap[objectId];
  }
}

/**
 * Overrides the dispatchEvent method of an EventTarget to forward events to renderer.
 */
function overrideDispatchEvent(eventTarget: EventTarget): void {
  const metadata = (eventTarget as any)[OBJECT_METADATA_SYMBOL] as ObjectMetadataMain;
  if (!metadata) {
    return;
  }

  const originalDispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);

  eventTarget.dispatchEvent = function (event: Event): boolean {
    // Call original dispatchEvent first
    const result = originalDispatchEvent(event);

    // Forward event to renderer process
    try {
      if (!metadata.sender.isDestroyed()) {
        metadata.sender.send(IPC_CHANNEL, {
          type: 'event',
          objectId: metadata.objectId,
          eventType: event.type,
          detail: (event as any).detail,
        });
      }
    } catch (error) {
      console.warn('Failed to forward event to renderer:', error);
    }

    return result;
  };
}

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
  }
}
