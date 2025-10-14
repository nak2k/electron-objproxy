# electron-objproxy

This is an Electron package to manipulate main process objects from renderer process via proxy.

## Installation

```bash
npm install electron-objproxy
```

## Usage

### 1. ClassMap Type Declaration

First, you need to declare the types of classes you want to use in the main process by extending the `ClassMap` interface using ambient module declaration:

```typescript
// In your type definition file (e.g., types/electron-objproxy.d.ts)
declare module 'electron-objproxy/types' {
  interface ClassMap {
    MyClass: typeof MyClass;
    AnotherClass: typeof AnotherClass;
    // Add other classes you want to use remotely
  }
}
```

### 2. Initialize in Main Process

In your application's main process, call `initObjProxy` to register the classes:

```typescript
// main.ts
import { initObjProxy } from 'electron-objproxy/main';
import { MyClass, AnotherClass } from './my-classes';

// Initialize the object proxy with your classes
initObjProxy({
  classMap: {
    MyClass,
    AnotherClass,
  },
});
```

### 3. Create Objects from Renderer Process

You can create objects in two ways:

**Regular objects** - Each call creates a new instance:

```typescript
// renderer.ts
import { createObject } from 'electron-objproxy/renderer';

// Create a new object instance remotely
const myObject = await createObject('MyClass', [arg1, arg2]);
const another = await createObject('MyClass', [arg1, arg2]); // Different instance

// Without constructor arguments
const simple = await createObject('SimpleClass');
```

**Singleton objects** - Returns the same instance across all calls:

```typescript
// renderer.ts
import { getSingleton, getSingletonSync, singleton } from 'electron-objproxy/renderer';

// Get or create a singleton instance
const mySingleton = await getSingleton('MyClass', [arg1, arg2]);
const same = await getSingleton('MyClass'); // Same instance (args ignored after first creation)

// Synchronous version (blocks renderer process - use only when necessary)
const syncSingleton = getSingletonSync('MyClass', [arg1, arg2]);

// Convenient property access (no arguments, synchronous)
const logger = singleton.Logger;
const config = singleton.Config;

// Note: Constructor arguments are only used on first creation
```

### 4. Using Singletons in Main Process

You can also access singletons directly in the main process:

```typescript
// main.ts
import { singleton } from 'electron-objproxy/main';

// Synchronous access to singleton
const logger = singleton.Logger;
logger.log('Hello from main process');

// If accessed from renderer later, events will be forwarded automatically
```

### 5. Method Calls and Event Handling

Once you have created an object, you can call its methods and listen to events:

```typescript
// Call methods on the remote object
const result = await myObject.someMethod(param1, param2);

// Listen to events if the object extends EventTarget
myObject.addEventListener('custom-event', (event) => {
  console.log('Received event:', event);
});
```

## Limitations

- One-way proxying only: Objects can only be created in the main process and proxied to renderer processes, not vice versa
- Async methods only: All method calls are asynchronous and must be awaited in the renderer process
- JSON-serializable arguments only: Method arguments and return values must be JSON-serializable (IPC limitation)
- No property access: Only method calls are supported; property get/set operations require IPC calls which aren't implemented
- EventTarget events only: Event forwarding is only available for objects extending `EventTarget`
- Singleton lifecycle: Singleton objects are never released once created until the application exits
- Context isolation required: Only works with `contextIsolation: true` in Electron's webPreferences

## Related

- [electron-nopreload](https://github.com/nak2k/electron-nopreload) - Expose Electron Renderer Process APIs to Main World with security hooks

## License

MIT License
