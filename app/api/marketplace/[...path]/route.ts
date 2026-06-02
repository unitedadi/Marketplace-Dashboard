import { MARKETPLACE_ACCOUNT_ID, MARKETPLACE_API_BASE } from "@/lib/marketplace";
import { NextRequest } from "next/server";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

async function proxyMarketplaceRequest(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const upstream = new URL(`/marketplace/${params.path.join("/")}`, MARKETPLACE_API_BASE);
  request.nextUrl.searchParams.forEach((value, key) => {
    upstream.searchParams.set(key, value);
  });
  if (!upstream.searchParams.get("account_id")) {
    upstream.searchParams.set("account_id", MARKETPLACE_ACCOUNT_ID);
  }

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const filename = request.headers.get("x-filename");
  if (contentType) headers.set("content-type", contentType);
  if (filename) headers.set("x-filename", filename);

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const response = await fetch(upstream, {
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
    headers,
    method: request.method,
  });

  return new Response(response.body, {
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
    status: response.status,
    statusText: response.statusText,
  });
}

export function GET(request: NextRequest, context: RouteContext) {
  return proxyMarketplaceRequest(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return proxyMarketplaceRequest(request, context);
}

export function PATCH(request: NextRequest, context: RouteContext) {
  return proxyMarketplaceRequest(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext) {
  return proxyMarketplaceRequest(request, context);
}
