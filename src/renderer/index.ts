import type { ClassMap } from '../common/types.js';
import { createObject as createProxyObject } from './proxy-manager.js';

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