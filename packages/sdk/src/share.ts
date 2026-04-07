import type { ShareRequest } from "./types.ts";

type ShareBridgeWindow = Window & {
  __oasizShareRequest?: (request: ShareRequest) => Promise<void>;
};

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function getBridgeWindow(): ShareBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as ShareBridgeWindow;
}

function warnMissingBridge(methodName: string): void {
  if (isDevelopment()) {
    console.warn(
      "[oasiz/sdk] " +
        methodName +
        " share bridge is unavailable. This is expected in local development.",
    );
  }
}

function isValidImageReference(image: string): boolean {
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(image)) {
    return true;
  }

  try {
    const parsed = new URL(image);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateRequest(options: ShareRequest): ShareRequest {
  const text = typeof options.text === "string" ? options.text.trim() : "";
  const hasText = text.length > 0;
  const hasScore = options.score !== undefined;
  const hasImage = typeof options.image === "string" && options.image.length > 0;

  if (!hasText && !hasScore && !hasImage) {
    throw new Error("Share request requires text, score, or image.");
  }

  if (hasScore) {
    if (
      typeof options.score !== "number" ||
      !Number.isInteger(options.score) ||
      options.score < 0
    ) {
      throw new Error("Share score must be a non-negative integer.");
    }
  }

  if (hasImage && !isValidImageReference(options.image!)) {
    throw new Error(
      "Share image must be an http(s) URL or a data:image/... base64 string.",
    );
  }

  return {
    ...(hasText ? { text } : {}),
    ...(hasScore ? { score: options.score } : {}),
    ...(hasImage ? { image: options.image } : {}),
  };
}

export async function share(options: ShareRequest): Promise<void> {
  const request = validateRequest(options);
  const bridge = getBridgeWindow();

  if (typeof bridge?.__oasizShareRequest !== "function") {
    warnMissingBridge("__oasizShareRequest");
    throw new Error("Share bridge unavailable");
  }

  await bridge.__oasizShareRequest(request);
}
