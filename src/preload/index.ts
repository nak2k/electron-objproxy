import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronObjProxyAPI, CreateObjectRequest, CallMethodRequest, ReleaseObjectsMessage, EventMessage } from '../common/types.js';
import { IPC_CHANNEL } from '../common/constants.js';

/**
 * Event listeners for main process event notifications.
 */
const eventListeners: ((message: EventMessage) => void)[] = [];

/**
 * Implementation of the ElectronObjProxyAPI interface.
 * This object provides low-level IPC communication with the main process.
 */
const electronObjProxyAPI: ElectronObjProxyAPI = {
  /**
   * Sends invoke request to main process.
   */
  async invoke(payload: CreateObjectRequest | CallMethodRequest) {
    return ipcRenderer.invoke(IPC_CHANNEL, payload);
  },

  /**
   * Sends notification to main process.
   */
  send(message: ReleaseObjectsMessage) {
    ipcRenderer.send(IPC_CHANNEL, message);
  },

  /**
   * Registers listener for event notifications from main process.
   */
  onEvent(listener: (message: EventMessage) => void) {
    eventListeners.push(listener);
  },
};

/**
 * Event listener for receiving events from the main process.
 * Handles event notifications and dispatches them to registered listeners.
 */
function handleMainProcessEvent(_event: Electron.IpcRendererEvent, message: any): void {
  if (message.type === 'event') {
    for (const listener of eventListeners) {
      listener(message as EventMessage);
    }
  }
}

// Register event listener for main process events
ipcRenderer.on(IPC_CHANNEL, handleMainProcessEvent);

// Expose the API to the renderer process through contextBridge
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('__electronObjProxy', electronObjProxyAPI);
}
