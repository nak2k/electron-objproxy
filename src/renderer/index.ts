import type { ClassMap } from '../common/types.js';
import { createObject as createProxyObject, getSingleton as getProxySingleton, getSingletonSync as getProxySingletonSync } from './proxy-manager.js';

/**
 * Creates a remote object instance in the main process.
 *
 * This function serves as the entry point for the Renderer Process API,
 * internally calling the proxy-manager's createObject function.
 *
 * @param className - The name of the class to instantiate, must be registered in ClassMap
 * @param init - Constructor parameters for the class (optional)
 * @returns Promise that resolves to the created proxy object
 */
export async function createObject<
  T extends keyof ClassMap,
  A extends ConstructorParameters<ClassMap[T]>
>(className: T, init?: A): Promise<InstanceType<ClassMap[T]>> {
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
 * @param init - Constructor parameters for the class (optional, used only on first creation)
 * @returns Promise that resolves to the singleton proxy object
 */
export async function getSingleton<
  T extends keyof ClassMap,
  A extends ConstructorParameters<ClassMap[T]>
>(className: T, init?: A): Promise<InstanceType<ClassMap[T]>> {
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
 * @param init - Constructor parameters for the class (optional, used only on first creation)
 * @returns The singleton proxy object
 */
export function getSingletonSync<
  T extends keyof ClassMap,
  A extends ConstructorParameters<ClassMap[T]>
>(className: T, init?: A): InstanceType<ClassMap[T]> {
  return getProxySingletonSync(className, init);
}

/**
 * Type for singleton object that provides convenient access to singleton instances.
 * Properties correspond to class names in ClassMap.
 */
export type SingletonObject = { readonly [K in keyof ClassMap]: InstanceType<ClassMap[K]> };

/**
 * Singleton object proxy for convenient singleton access.
 * Properties correspond to class names in ClassMap.
 * Each property access returns the singleton instance for that class.
 *
 * @example
 * // Get singleton instance (synchronous)
 * const logger = singleton.Logger;
 *
 * // Type-safe access
 * const config = singleton.Config;
 */
export const singleton: SingletonObject = new Proxy({} as SingletonObject, {
  get(_target, prop: string | symbol) {
    if (typeof prop === 'string') {
      return getProxySingletonSync(prop as keyof ClassMap);
    }
    return undefined;
  }
});