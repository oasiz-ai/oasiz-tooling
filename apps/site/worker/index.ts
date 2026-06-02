interface Env {
  ASSETS: Fetcher;
}

const BASE_PATH = "/developers";
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const HTML_CACHE_CONTROL = "no-cache, no-store, must-revalidate";

function isDevelopersPath(pathname: string): boolean {
  return pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`);
}

function withoutBasePath(pathname: string): string {
  const stripped = pathname.slice(BASE_PATH.length);
  return stripped || "/";
}

function withCacheHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  if (pathname.startsWith("/assets/")) {
    headers.set("Cache-Control", ASSET_CACHE_CONTROL);
  } else if (headers.get("content-type")?.includes("text/html")) {
    headers.set("Cache-Control", HTML_CACHE_CONTROL);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function assetRequestFor(request: Request, pathname: string): Request {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname;
  return new Request(assetUrl, request);
}

async function serveAsset(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  const response = await env.ASSETS.fetch(assetRequestFor(request, pathname));
  return withCacheHeaders(response, pathname);
}

function shouldServeSpaFallback(request: Request, pathname: string, response: Response): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }
  if (pathname.includes(".")) {
    return false;
  }
  return response.status === 404 || (response.status >= 300 && response.status < 400);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!isDevelopersPath(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === BASE_PATH) {
      url.pathname = `${BASE_PATH}/`;
      return Response.redirect(url.toString(), 308);
    }

    const assetPathname = withoutBasePath(url.pathname);
    const assetResponse = await serveAsset(request, env, assetPathname);
    if (!shouldServeSpaFallback(request, assetPathname, assetResponse)) {
      return assetResponse;
    }

    return serveAsset(request, env, "/index.html");
  },
};
