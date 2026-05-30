import { clerkMiddleware } from "@clerk/nextjs/server";

// Parse Clerk authentication tokens/cookies for API routes without enforcing redirects at the middleware layer.
// The API routes themselves will check auth() and return 401 JSON responses if needed.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
