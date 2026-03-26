export type Unsubscribe = () => void;

type LifecycleEventName = "oasiz:pause" | "oasiz:resume";

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function addLifecycleListener(
  eventName: LifecycleEventName,
  callback: () => void,
): Unsubscribe {
  if (typeof window === "undefined") {
    if (isDevelopment()) {
      console.warn(
        "[oasiz/sdk] " +
          eventName +
          " listener registered without a browser window. This is expected in local development.",
      );
    }
    return () => {};
  }

  const handler: EventListener = () => callback();
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}

export function onPause(callback: () => void): Unsubscribe {
  return addLifecycleListener("oasiz:pause", callback);
}

export function onResume(callback: () => void): Unsubscribe {
  return addLifecycleListener("oasiz:resume", callback);
}
