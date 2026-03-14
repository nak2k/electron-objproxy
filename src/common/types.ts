/**
 * Map of class names to their constructors for object proxying.
 * This interface should be extended by users via ambient module declaration
 * to register their classes for remote object creation.
 *
 * @example
 * ```ts
 * declare module 'electron-objproxy/types' {
 *   interface ClassMap {
 *     MyJob: typeof MyJob;
 *     AnotherJob: typeof AnotherJob;
 *   }
 * }
 * ```
 */
export interface ClassMap {
  // Empty map to be extended by the user via Ambient Declaration
}

/**
 * API interface exposed from the preload script to the renderer process
 * for low-level IPC communication with the main process.
 */
export interface ElectronObjProxyAPI {
  /**
   * Sends invoke request to main process for object creation.
   *
   * @param payload - Create object request payload
   * @returns Promise that resolves to create object response
   */
  invoke(payload: CreateObjectRequest): Promise<CreateObjectResponse>;

  /**
   * Sends invoke request to main process for singleton retrieval.
   *
   * @param payload - Get singleton request payload
   * @returns Promise that resolves to create object response
   */
  invoke(payload: GetSingletonRequest): Promise<CreateObjectResponse>;

  /**
   * Sends invoke request to main process for method calls.
   *
   * @param payload - Call method request payload
   * @returns Promise that resolves to method call result
   */
  invoke(payload: CallMethodRequest): Promise<any>;

  /**
   * Sends notification to main process for object release.
   *
   * @param message - Release objects message
   */
  send(message: ReleaseObjectsMessage): void;

  /**
   * Sends synchronous request to main process for singleton retrieval.
   *
   * @param message - Get singleton sync request
   * @returns Singleton sync response
   */
  sendSync(message: GetSingletonSyncRequest): GetSingletonSyncResponse;

  /**
   * Registers listener for event notifications from main process.
   *
   * @param listener - Function to handle event messages
   */
  onEvent(listener: (message: EventMessage) => void): void;
}

/**
 * Request payload for creating objects in main process.
 */
export interface CreateObjectRequest {
  type: 'new';
  className: string;
  args: unknown[];
}

/**
 * Response payload for object creation.
 */
export interface CreateObjectResponse {
  objectId: number;
  isEventTarget: boolean;
  extensions?: ExtensionMetadata;
}

/**
 * Request payload for getting singleton objects from main process.
 */
export interface GetSingletonRequest {
  type: 'getSingleton';
  className: string;
  args: unknown[];
}

/**
 * Request payload for calling methods on remote objects.
 */
export interface CallMethodRequest {
  type: 'call';
  objectId: number;
  method: string;
  args: unknown[];
}

/**
 * Message for notifying main process about object release.
 */
export interface ReleaseObjectsMessage {
  type: 'release';
  objectIds: number[];
}

/**
 * Message for event notifications from main process.
 */
export interface EventMessage {
  type: 'event';
  objectId: number;
  eventType: string;
  detail: unknown;
}

/**
 * Request payload for getting singleton objects synchronously from main process.
 */
export interface GetSingletonSyncRequest {
  type: 'getSingletonSync';
  className: string;
  args: unknown[];
}

/**
 * Response payload for synchronous singleton retrieval.
 */
export interface GetSingletonSyncResponse {
  objectId: number;
  isEventTarget: boolean;
  extensions?: ExtensionMetadata;
}

/**
 * Extension metadata that enables additional features for proxied objects.
 * Set as a static property on classes using the EXTENSION_METADATA symbol.
 */
export interface ExtensionMetadata {
  /** MessagePort transfer support configuration */
  messagePort?: MessagePortExtension;
}

/**
 * Configuration for MessagePort transfer support.
 */
export interface MessagePortExtension {
  /** Method names that accept MessagePort transfers */
  methods: string[];
}

/**
 * Common interface for MessagePort that works in both Main and Renderer processes.
 * In Main Process, the actual runtime type is MessagePortMain.
 * In Renderer Process, the actual runtime type is MessagePort (DOM).
 * Use this in method signatures for classes registered in ClassMap.
 */
export interface TransferablePort {
  /** Sends a message through the port */
  postMessage(message: any, transfer?: any[]): void;
  /** Closes the port */
  close(): void;
  /** Starts receiving messages */
  start(): void;
}

/**
 * Message payload for method calls with MessagePort transfer.
 */
export interface CallWithPortMessage {
  type: 'callWithPort';
  /** Target object ID */
  objectId: number;
  /** Method name to call */
  method: string;
  /** Method arguments (excluding MessagePort) */
  args: unknown[];
}
