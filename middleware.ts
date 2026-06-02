import { clerkMiddleware } from "@clerk/nextjs/server";

// Routes are public by default (dev still uses ?account_id=); we don't call
// auth.protect() here. Account gating happens in app/page.tsx.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals and static files, run on everything else + API routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|map)).*)",
    "/(api|trpc)(.*)",
  ],
};
