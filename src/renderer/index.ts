import type { ClassMap } from '../common/types.js';
import { createObject as createProxyObject, getSingleton as getProxySingleton, getSingletonSync as getProxySingletonSync } from './proxy-manager.js';

/**
 * Creates a remote object instance in the main process.
 *
 * This function serves as the entry point for the Renderer Process API,
 * internally calling the proxy-manager's createObject function.
 *
 * @param className - The name of the class to instantiate, must be registered in ClassMap
 * @param init - Constructor parameters for the class
 * @returns Promise that resolves to the created proxy object
 */
export async function createObject<
  T extends keyof ClassMap,
  A extends ConstructorParameters<ClassMap[T]>
>(className: T, init: A): Promise<InstanceType<ClassMap[T]>> {
  return createProxyObject(className, init);
}

/**
 * Gets or creates a singleton object instance in the main process.
 *
 * This function serves as the entry point for the Renderer Process API,
 * internally calling the proxy-manager's getSingleton function.
 * Always returns the same instance for a given class name.
 *
 * @param className - The name of the class to instantiate, must be registered in ClassMap
 * @param init - Constructor parameters for the class (used only on first creation)
 * @returns Promise that resolves to the singleton proxy object
 */
export async function getSingleton<
  T extends keyof ClassMap,
  A extends ConstructorParameters<ClassMap[T]>
>(className: T, init: A): Promise<InstanceType<ClassMap[T]>> {
  return getProxySingleton(className, init);
}

/**
 * Gets or creates a singleton object instance synchronously in the main process.
 *
 * This function serves as the entry point for the Renderer Process API,
 * internally calling the proxy-manager's getSingletonSync function.
 * Always returns the same instance for a given class name.
 *
 * Note: Synchronous IPC blocks the renderer process until the main process responds.
 * Use this function only when necessary, such as during initialization.
 *
 * @param className - The name of the class to instantiate, must be registered in ClassMap
 * @param init - Constructor parameters for the class (used only on first creation)
 * @returns The singleton proxy object
 */
export function getSingletonSync<
  T extends keyof ClassMap,
  A extends ConstructorParameters<ClassMap[T]>
>(className: T, init: A): InstanceType<ClassMap[T]> {
  return getProxySingletonSync(className, init);
}