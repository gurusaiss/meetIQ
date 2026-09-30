import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Business logic under ../src uses explicit .ts extensions in relative
  // imports (rewriteRelativeImportExtensions convention). Next's bundler
  // resolves an already-extensioned specifier as a literal path match, so
  // these files are reused completely unchanged — no duplication, no port.
  outputFileTracingRoot: process.cwd() + "/..",
  experimental: {
    // Enables forbidden()/unauthorized() from next/navigation, so RBAC
    // checks in Server Components can return a genuine HTTP 403/401 instead
    // of a 200 response whose body merely says "forbidden".
    authInterrupts: true,
    // proxy.ts buffers request bodies (default 10 MB); allow audio uploads up to the 25 MB cap.
    proxyClientMaxBodySize: "30mb",
  },
};

export default nextConfig;
