// Define a generic type for objects with a get() method
export type Gettable<T> = { get(): T };

// Proxy type that combines the original object and its get() result
export type Proxy<T extends Gettable<any>> = T & ReturnType<T['get']>;

class Handler<T extends Gettable<any>> implements ProxyHandler<T> {
    private cache: WeakMap<object, Proxy<any>>;

    constructor() {
        // Cache for already created proxies
        this.cache = new WeakMap();
    }

    get(shared: T, prop: string | symbol) {
        if (typeof (shared as any)[prop] === "function") {
            return wrap((shared as any)[prop].bind(shared), this.cache);
        }

        const ptr = shared.get();
        if (typeof ptr[prop] === "function") {
            return wrap(ptr[prop].bind(ptr), this.cache);
        }

        if (prop === Target) {
            return shared;
        }

        if (prop === Pointer) {
            return ptr;
        }

        return proxy(ptr[prop], this.cache);
    }

    set(shared: T, prop: string | symbol, value: any) {
        shared.get()[prop] = value;
        return true;
    }
}

export function proxy<T>(ret: T, cache?: WeakMap<object, Proxy<any>>): T {
    if (typeof ret === "object" && ret !== null && 
        (ret as any).constructor.name.match(/_exports_(.*)Shared/)) {
        return SharedPointer(ret as any, cache);
    }
    return ret;
}

export function wrap<T extends (...args: any[]) => any>(
    func: T, 
    cache?: WeakMap<object, Proxy<any>>
): T {
    return function(...args: Parameters<T>): ReturnType<T> {
        return proxy(func(...args) as any, cache);
    } as T;
}

function SharedPointer<T extends Gettable<any>>(
    obj: T, 
    cache?: WeakMap<object, Proxy<any>>
): Proxy<T> {
    // If what we get passed is already a proxy, return it unchanged
    if ((obj as any)[Target]) {
        return obj as Proxy<T>;
    }

    // If we already have a proxy for that object
    if (cache && cache.has(obj)) {
        return cache.get(obj) as Proxy<T>;
    }

    // Create new proxy
    const proxyObj = new Proxy(obj, new Handler()) as Proxy<T>;

    // Set it on cache
    if (cache) {
        cache.set(obj, proxyObj);
    }

    // Return proxy
    return proxyObj;
}

// Symbols for special proxy methods
export const Target = Symbol("target");
export const Pointer = Symbol("pointer");

// Method to get the original pointer from a proxy
export function getPointer<T extends Gettable<any>>(ptr: Proxy<T>): T {
    return ptr[Pointer];
};

// Wrap native module exports ending with 'Shared'
export function wrapNativeModule (module: { exports: Record<string, any> }) {
    for (const [key, value] of Object.entries(module.exports)) {
        if (key.match(/Shared$/)) {
            module.exports[key] = function(...args: any[]) {
                return SharedPointer(new value(...args));
            };
        }
    }
};

export { SharedPointer } ;