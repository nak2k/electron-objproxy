/** Symbol used to store object metadata on proxy objects. */
export const OBJECT_METADATA = Symbol('ELECTRON_OBJ_PROXY_METADATA');

/** Symbol used to declare extension metadata on class static properties. */
export const EXTENSION_METADATA = Symbol('ELECTRON_OBJ_EXTENSION_METADATA');

/** IPC channel name used for all communication between main and renderer processes. */
export const IPC_CHANNEL = '__ELECTRON_OBJ_PROXY__';