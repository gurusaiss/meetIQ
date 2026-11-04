import type { MetadataRoute } from "next";

// Everything behind sign-in is private; only the public entry pages may be indexed.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: ["/login", "/signup"], disallow: "/" } };
}
