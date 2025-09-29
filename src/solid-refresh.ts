import type { Accessor, Context, JSX } from "solid-js";
import type {
    ESMRuntimeType,
    StandardRuntimeType,
} from "solid-refresh/dist/types/src/shared/types.d.ts";
import { createSignal, DEV } from "solid-js";
import { $DEVCOMP, createMemo, untrack } from "solid-js";

export interface BaseComponent<P> {
    (props: P): JSX.Element;
}

function setComponentProperty<P>(
    component: BaseComponent<P>,
    key: string,
    value: string,
) {
    const descriptor = Object.getOwnPropertyDescriptor(component, key);
    if (descriptor) {
        Object.defineProperty(component, key, {
            ...descriptor,
            value,
        });
    } else {
        Object.defineProperty(component, key, {
            value,
            writable: false,
            enumerable: false,
            configurable: true,
        });
    }
}

function createProxy<C extends BaseComponent<P>, P>(
    source: Accessor<C>,
    name: string,
    location?: string,
): (props: P) => JSX.Element {
    const refreshName = `[solid-refresh]${name}`;
    function HMRComp(props: P): JSX.Element {
        const s = source();
        if (!s || $DEVCOMP in s) {
            return createMemo(
                () => {
                    const c = source();
                    if (c) {
                        return untrack(() => c(props));
                    }
                    return undefined;
                },
                {
                    name: refreshName,
                },
            ) as unknown as JSX.Element;
        }
        // no $DEVCOMP means it did not go through devComponent so source() is a regular function, not a component
        return s(props);
    }

    setComponentProperty(HMRComp, "name", refreshName);
    if (location) {
        setComponentProperty(HMRComp, "location", location);
    }

    return new Proxy(HMRComp, {
        get(_, property) {
            if (property === "location" || property === "name") {
                return (HMRComp as any)[property];
            }
            return source()[property as keyof C];
        },
        set(_, property, value) {
            source()[property as keyof C] = value;
            return true;
        },
    });
}

function isListUpdatedInternal(
    a: Record<string, any>,
    b: Record<string, any>,
): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    // Check if both objects has the same amount of keys
    if (aKeys.length !== bKeys.length) {
        return true;
    }
    // Merge keys
    const keys = new Set([...aKeys, ...bKeys]);
    // Now check if merged keys has the same amount of keys as the other two
    // for example: { a, b } and { a, c } produces { a, b, c }
    if (keys.size !== aKeys.length) {
        return true;
    }
    // Now compare each items
    for (const key of keys) {
        // This covers NaN. No need for Object.is since it's extreme for -0
        if (a[key] !== b[key] || (a[key] !== a[key] && b[key] !== b[key])) {
            return true;
        }
    }
    return false;
}

function isListUpdated(
    a: Record<string, any> | undefined,
    b: Record<string, any> | undefined,
): boolean {
    if (a && b) {
        return isListUpdatedInternal(a, b);
    }
    if (a == null && b != null) {
        return true;
    }
    if (a != null && b == null) {
        return true;
    }
    return false;
}

interface ComponentOptions {
    location?: string;
    // In granular mode. This signature is a hash
    // generated from the component's JS string
    signature?: string;
    // An array of foreign bindings (values that aren't locally declared in the component)
    dependencies?: () => Record<string, any>;
}

// The registration data for the components
export interface ComponentRegistrationData<P> extends ComponentOptions {
    // A compile-time ID generated for the component, this is usually
    // derived from the component's name
    id: string;
    // The component itself
    component: (props: P) => JSX.Element;
    proxy: (props: P) => JSX.Element;
    // This function replaces the previous component
    // with the new component.
    update: (action: () => (props: P) => JSX.Element) => void;
}

// The registration data for the context
export interface ContextRegistrationData<T> {
    // A compile-time ID generated for the context, this is usually
    // derived from the context's name
    id: string;
    // The context instance
    context: Context<T>;
}

export interface Registry {
    components: Map<string, ComponentRegistrationData<any>>;
    contexts: Map<string, ContextRegistrationData<any>>;
}

export function $$registry(): Registry {
    return {
        components: new Map(),
        contexts: new Map(),
    };
}

export function $$component<P>(
    registry: Registry,
    id: string,
    component: (props: P) => JSX.Element,
    options: ComponentOptions = {},
): (props: P) => JSX.Element {
    const [comp, setComp] = createSignal(component, { internal: true });
    const proxy = createProxy<(props: P) => JSX.Element, P>(
        comp,
        id,
        options.location,
    );
    registry.components.set(id, {
        id,
        component,
        proxy,
        update: setComp,
        ...options,
    });
    return proxy;
}

export function $$context<T>(
    registry: Registry,
    id: string,
    context: Context<T>,
): Context<T> {
    registry.contexts.set(id, {
        id,
        context,
    });
    return context;
}

function patchComponent<P>(
    oldData: ComponentRegistrationData<P>,
    newData: ComponentRegistrationData<P>,
) {
    // Check if incoming module has signature
    if (newData.signature) {
        // Compare signatures
        const oldDeps = oldData.dependencies?.();
        const newDeps = newData.dependencies?.();
        if (
            newData.signature !== oldData.signature ||
            isListUpdated(newDeps, oldDeps)
        ) {
            // Replace signatures and dependencies
            oldData.dependencies = newDeps ? () => newDeps : undefined;
            oldData.signature = newData.signature;
            // Remount
            oldData.update(() => newData.component);
        }
    } else {
        // No granular update, remount
        oldData.update(() => newData.component);
    }

    // Always rely on the first proxy
    // This is to allow modules newly importing
    // the updated version to still be able
    // to render the latest version despite
    // not receiving the first proxy
    newData.update(() => oldData.proxy);
}

function patchComponents(oldData: Registry, newData: Registry) {
    const components = new Set([
        ...oldData.components.keys(),
        ...newData.components.keys(),
    ]);
    for (const key of components) {
        const oldComponent = oldData.components.get(key);
        const newComponent = newData.components.get(key);

        if (oldComponent) {
            if (newComponent) {
                patchComponent(oldComponent, newComponent);
            } else {
                // We need to invalidate
                return true;
            }
        } else if (newComponent) {
            oldData.components.set(key, newComponent);
        }
    }
    return false;
}

function patchContext<T>(
    oldData: ContextRegistrationData<T>,
    newData: ContextRegistrationData<T>,
) {
    oldData.context.defaultValue = newData.context.defaultValue;
    newData.context.id = oldData.context.id;
    newData.context.Provider = oldData.context.Provider;
}

function patchContexts(oldData: Registry, newData: Registry) {
    const contexts = new Set([
        ...oldData.contexts.keys(),
        ...newData.contexts.keys(),
    ]);
    for (const key of contexts) {
        const oldContext = oldData.contexts.get(key);
        const newContext = newData.contexts.get(key);

        if (oldContext) {
            if (newContext) {
                patchContext(oldContext, newContext);
            } else {
                // We need to invalidate
                return true;
            }
        } else if (newContext) {
            oldData.contexts.set(key, newContext);
        }
    }
    return false;
}

function patchRegistry(oldRegistry: Registry, newRegistry: Registry) {
    const shouldInvalidateByContext = patchContexts(oldRegistry, newRegistry);
    const shouldInvalidateByComponents = patchComponents(
        oldRegistry,
        newRegistry,
    );
    // In the future we may add other HMR features here
    return shouldInvalidateByComponents || shouldInvalidateByContext;
}

const SOLID_REFRESH = "solid-refresh";
const SOLID_REFRESH_PREV = "solid-refresh-prev";

type HotData = {
    [key in typeof SOLID_REFRESH | typeof SOLID_REFRESH_PREV]: Registry;
};

// interface ESMHot {
// 	data: HotData;
// 	accept: (cb: (module?: unknown) => void) => void;
// 	invalidate: () => void;
// 	decline: () => void;
// }

// interface StandardHot {
// 	data: HotData;
// 	accept: (cb?: () => void) => void;
// 	dispose: (cb: (data: HotData) => void) => void;
// 	invalidate?: () => void;
// 	decline?: () => void;
// }

type ESMDecline = [type: ESMRuntimeType, inline?: boolean];
type StandardDecline = [type: StandardRuntimeType, inline?: boolean];
type Decline = ESMDecline | StandardDecline;

export function $$decline(...[type, inline]: Decline) {
    switch (type) {
        case "esm": {
            // Snowpack's ESM assumes invalidate as a normal page reload
            // decline should be better
            if (inline) {
                // @ts-expect-error not implemented in bun
                import.meta.hot.invalidate();
            }
            break;
        }
        case "vite": {
            // Vite is no-op on decline, just call invalidate
            if (inline) {
                try {
                    // @ts-expect-error not implemented in bun, and will throw an error.
                    import.meta.hot.invalidate();
                } catch (error) {
                    console.warn(error);
                }
            } else {
                import.meta.hot.accept(() => {
                    // @ts-expect-error not implemented in bun
                    import.meta.hot.invalidate();
                });
            }
            break;
        }
        case "rspack-esm":
        case "webpack5": {
            if (inline) {
                // @ts-expect-error not implemented in bun
                import.meta.hot.invalidate!();
            } else {
                import.meta.hot.decline();
            }
            break;
        }
        case "standard": {
            // Some implementations do not have decline/invalidate
            if (inline) {
                // @ts-expect-error not implemented in bun
                if (import.meta.hot.invalidate) {
                    // @ts-expect-error not implemented in bun
                    import.meta.hot.invalidate();
                } else {
                    window.location.reload();
                }
                // @ts-expect-error
            } else if (import.meta.hot.decline) {
                import.meta.hot.decline();
            } else {
                import.meta.hot.accept(() => {
                    // @ts-expect-error not implemented in bun
                    if (import.meta.hot.invalidate) {
                        // @ts-expect-error not implemented in bun
                        import.meta.hot.invalidate();
                    } else {
                        window.location.reload();
                    }
                });
            }
            break;
        }
    }
}

let warned = false;

function shouldWarnAndDecline() {
    const result = DEV && Object.keys(DEV).length;

    if (result) {
        return false;
    }

    if (!warned) {
        console.warn(
            "To use solid-refresh, you need to use the dev build of SolidJS. Make sure your build system supports package.json conditional exports and has the 'development' condition turned on.",
        );
        warned = true;
    }
    return true;
}

function $$refreshESM(type: ESMRuntimeType, registry: Registry) {
    if (shouldWarnAndDecline()) {
        $$decline(type);
    } else if (import.meta.hot.data) {
        import.meta.hot.data[SOLID_REFRESH] =
            import.meta.hot.data[SOLID_REFRESH] || registry;
        import.meta.hot.data[SOLID_REFRESH_PREV] = registry;

        import.meta.hot.accept((mod) => {
            if (
                mod == null ||
                patchRegistry(
                    import.meta.hot.data[SOLID_REFRESH],
                    import.meta.hot.data[SOLID_REFRESH_PREV],
                )
            ) {
                try {
                    // @ts-expect-error not implemented in bun
                    import.meta.hot.invalidate();
                } catch (error) {
                    console.warn(error);
                }
            }
        });
    } else {
        // I guess just decline if hot.data doesn't exist
        $$decline(type);
    }
}

function $$refreshStandard(type: StandardRuntimeType, registry: Registry) {
    if (shouldWarnAndDecline()) {
        $$decline(type);
    } else {
        if (import.meta.hot.data && import.meta.hot.data[SOLID_REFRESH]) {
            if (patchRegistry(import.meta.hot.data[SOLID_REFRESH], registry)) {
                $$decline(type, true);
            }
        }
        import.meta.hot.dispose((data: HotData) => {
            data[SOLID_REFRESH] = import.meta.hot.data
                ? import.meta.hot.data[SOLID_REFRESH]
                : registry;
        });
        import.meta.hot.accept();
    }
}

type ESMRefresh = [type: ESMRuntimeType, hot: never, registry: Registry];
type StandardRefresh = [
    type: StandardRuntimeType,
    hot: never,
    registry: Registry,
];

type Refresh = ESMRefresh | StandardRefresh;

export function $$refresh(...[type, _hot, registry]: Refresh) {
    switch (type) {
        case "esm":
        case "vite": {
            $$refreshESM(type, registry);
            break;
        }
        case "standard":
        case "webpack5":
        case "rspack-esm": {
            $$refreshStandard(type, registry);
            break;
        }
    }
}
