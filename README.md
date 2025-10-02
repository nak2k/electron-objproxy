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
const myObject = await createObject('MyClass', arg1, arg2);
const another = await createObject('MyClass', arg1, arg2); // Different instance
```

**Singleton objects** - Returns the same instance across all calls:

```typescript
// renderer.ts
import { getSingleton, getSingletonSync } from 'electron-objproxy/renderer';

// Get or create a singleton instance
const singleton = await getSingleton('MyClass', arg1, arg2);
const same = await getSingleton('MyClass', arg1, arg2); // Same instance

// Synchronous version (blocks renderer process - use only when necessary)
const syncSingleton = getSingletonSync('MyClass', arg1, arg2);

// Note: Constructor arguments are only used on first creation
```

### 4. Method Calls and Event Handling

Once you have created an object, you can call its methods and listen to events:

```typescript
// Call methods on the remote object
const result = await myObject.someMethod(param1, param2);

// Listen to events if the object extends EventTarget
myObject.addEventListener('custom-event', (event) => {
  console.log('Received event:', event);
});
```

## License

MIT License
