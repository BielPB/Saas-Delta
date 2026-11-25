import type { MetadataRoute } from "next";

// Not a security control: the portal is protected by unguessable tokens validated server-side.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: ["/aprovacao/", "/app/", "/api/"] }] };
}
