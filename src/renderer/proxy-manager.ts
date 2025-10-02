import type { ClassMap, ElectronObjProxyAPI } from '../common/types.js';
import { OBJECT_METADATA } from '../common/constants.js';

/**
 * Access to the ElectronObjProxyAPI provided by the preload script.
 */
const api = (window as any).__electronObjProxy as ElectronObjProxyAPI;

if (!api) {
  throw new Error('ElectronObjProxyAPI is not available. initObjProxy() must be called in the main process.');
}

/**
 * Metadata interface for objects in the renderer process.
 */
interface ObjectMetadataRenderer {
  /** Unique identifier for the object */
  objectId: number;
}

/**
 * Type representing objects in the renderer process.
 * Can be either a plain object or an EventTarget-derived object.
 */
type ObjectRenderer = {} | EventTarget;

/**
 * Map to manage proxy objects using WeakRef for automatic cleanup.
 */
const objectMap: Record<number, WeakRef<ObjectRenderer>> = {};

/**
 * Map to manage singleton proxy objects with strong references.
 * These proxies are never garbage collected until page reload.
 */
const singletonProxyMap: Record<string, ObjectRenderer> = {};

/**
 * Creates a proxy object from an IPC response containing objectId and isEventTarget.
 * This is a helper function shared by createObject and getSingleton.
 *
 * @param objectId - The unique identifier for the remote object
 * @param isEventTarget - Whether the remote object is an EventTarget
 * @returns The created proxy object
 */
function createProxyFromResponse(objectId: number, isEventTarget: boolean): ObjectRenderer {
  // Create base object based on whether it's an EventTarget
  const target: ObjectRenderer = isEventTarget ? new EventTarget() : {};

  // Create metadata object
  const metadata: ObjectMetadataRenderer = { objectId };

  // Create method cache scoped to this proxy instance
  const methodCache: Record<string, Function> = {};

  // Create proxy with custom behavior
  const proxy = new Proxy(target, {
    get(target, prop, receiver) {
      // Ignore 'then' property to avoid thenable assimilation
      if (prop === 'then') {
        return undefined;
      }

      // Return metadata for special symbol
      if (prop === OBJECT_METADATA) {
        return metadata;
      }

      // For string properties, check if they exist on target first
      if (typeof prop === 'string') {
        if (!methodCache[prop]) {
          // Check if the property exists on the target object
          const targetValue = Reflect.get(target, prop);
          if (typeof targetValue === 'function') {
            // If it's a function on the target, bind it to the target
            methodCache[prop] = targetValue.bind(target);
          } else {
            // Otherwise, create a remote method call
            methodCache[prop] = async function (...args: unknown[]) {
              return api.invoke({
                type: 'call',
                objectId,
                method: prop,
                args,
              });
            };
          }
        }

        return methodCache[prop];
      }

      return Reflect.get(target, prop, receiver);
    },
  });

  // Register the proxy in objectMap using WeakRef
  objectMap[objectId] = new WeakRef(proxy);

  return proxy;
}

/**
 * Creates a remote object instance in the main process and returns a proxy.
 *
 * @param className - The name of the class to instantiate
 * @param init - Constructor parameters for the class
 * @returns Promise that resolves to the created proxy object
 */
export async function createObject<
  T extends keyof ClassMap,
  A extends ConstructorParameters<ClassMap[T]>
>(className: T, init: A): Promise<InstanceType<ClassMap[T]>> {
  // Send object creation request to main process via preload API
  const response = await api.invoke({
    type: 'new',
    className: className as string,
    args: init,
  });

  const { objectId, isEventTarget } = response;

  // Create and register proxy object
  const proxy = createProxyFromResponse(objectId, isEventTarget);

  return proxy as InstanceType<ClassMap[T]>;
}

/**
 * Gets or creates a singleton object instance in the main process and returns a proxy.
 * If a singleton for the given class name already exists in the renderer process,
 * returns the cached proxy. Otherwise, requests the singleton from the main process.
 *
 * @param className - The name of the class to instantiate
 * @param init - Constructor parameters for the class (optional, used only on first creation)
 * @returns Promise that resolves to the singleton proxy object
 */
export async function getSingleton<
  T extends keyof ClassMap,
  A extends ConstructorParameters<ClassMap[T]>
>(className: T, init?: A): Promise<InstanceType<ClassMap[T]>> {
  const classNameStr = className as string;

  // Return cached singleton proxy if it exists
  if (singletonProxyMap[classNameStr]) {
    return singletonProxyMap[classNameStr] as InstanceType<ClassMap[T]>;
  }

  // Send singleton retrieval request to main process via preload API
  const response = await api.invoke({
    type: 'getSingleton',
    className: classNameStr,
    args: init ?? [],
  });

  const { objectId, isEventTarget } = response;

  // Create and register proxy object
  const proxy = createProxyFromResponse(objectId, isEventTarget);

  // Also register in singleton map for caching
  singletonProxyMap[classNameStr] = proxy;

  return proxy as InstanceType<ClassMap[T]>;
}

/**
 * Gets or creates a singleton object instance synchronously in the main process and returns a proxy.
 * If a singleton for the given class name already exists in the renderer process,
 * returns the cached proxy. Otherwise, requests the singleton from the main process synchronously.
 *
 * @param className - The name of the class to instantiate
 * @param init - Constructor parameters for the class (optional, used only on first creation)
 * @returns The singleton proxy object
 */
export function getSingletonSync<
  T extends keyof ClassMap,
  A extends ConstructorParameters<ClassMap[T]>
>(className: T, init?: A): InstanceType<ClassMap[T]> {
  const classNameStr = className as string;

  // Return cached singleton proxy if it exists
  if (singletonProxyMap[classNameStr]) {
    return singletonProxyMap[classNameStr] as InstanceType<ClassMap[T]>;
  }

  // Send synchronous singleton retrieval request to main process via preload API
  const response = api.sendSync({
    type: 'getSingletonSync',
    className: classNameStr,
    args: init ?? [],
  });

  const { objectId, isEventTarget } = response;

  // Create and register proxy object
  const proxy = createProxyFromResponse(objectId, isEventTarget);

  // Also register in singleton map for caching
  singletonProxyMap[classNameStr] = proxy;

  return proxy as InstanceType<ClassMap[T]>;
}

/**
 * Dispatches an event to the corresponding proxy object.
 *
 * @param objectId - ID of the object that should receive the event
 * @param eventType - Type of the event to dispatch
 * @param detail - Event detail information
 */
export function dispatchEvent(objectId: number, eventType: string, detail: unknown): void {
  const weakRef = objectMap[objectId];
  if (!weakRef) {
    return;
  }

  const proxy = weakRef.deref();
  if (!proxy || !(proxy instanceof EventTarget)) {
    return;
  }

  // Create and dispatch custom event
  const event = new CustomEvent(eventType, { detail });
  proxy.dispatchEvent(event);
}

/**
 * Releases objects from the object map and notifies the main process.
 *
 * @param objectIds - Array of object IDs to release
 */
function releaseObjects(objectIds: number[]): void {
  if (objectIds.length === 0) {
    return;
  }

  // Remove from objectMap
  for (const objectId of objectIds) {
    delete objectMap[objectId];
  }

  // Notify main process via preload API
  api.send({
    type: 'release',
    objectIds,
  });
}

/**
 * Performs cleanup of unreferenced objects from the objectMap.
 * This function is called periodically to clean up WeakRef entries
 * that have been garbage collected.
 * Note: singletonProxyMap is not subject to cleanup.
 */
function cleanupObjects(): void {
  const releasedObjectIds: number[] = [];

  for (const [objectIdStr, weakRef] of Object.entries(objectMap)) {
    if (!weakRef.deref()) {
      const objectId = parseInt(objectIdStr, 10);
      releasedObjectIds.push(objectId);
    }
  }

  if (releasedObjectIds.length > 0) {
    releaseObjects(releasedObjectIds);
  }
}

// Set up periodic cleanup every minute
setInterval(cleanupObjects, 60 * 1000);

// Initialize event handling from main process
api.onEvent((message) => {
  if (message.type === 'event') {
    dispatchEvent(message.objectId, message.eventType, message.detail);
  }
});
