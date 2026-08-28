import type { MetadataRoute } from "next";

/** Public document pages are the only content meant to be indexed -
 * everything else requires auth and has no value to a crawler anyway. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/p/"],
        disallow: ["/workspace/", "/login", "/register", "/invitations/"],
      },
    ],
  };
}
