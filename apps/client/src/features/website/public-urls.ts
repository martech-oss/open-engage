import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";

const getPublicOrigin = createIsomorphicFn()
  .client(() => window.location.origin)
  .server(() => getRequestUrl().origin);

export function websitePublicUrls(workspaceSlug: string, origin = getPublicOrigin()) {
  return {
    signupForm: (slug: string) => `${origin}/f/${workspaceSlug}/${slug}`,
    signupFormEmbed: (slug: string) =>
      `${origin}/api/public/forms/${workspaceSlug}/${slug}/embed.js`,
    landingPage: (slug: string) => `${origin}/p/${workspaceSlug}/${slug}`,
    customRedirect: (slug: string) => `${origin}/r/${workspaceSlug}/${slug}`,
    siteTrackingScript: `${origin}/api/public/site-tracking/${workspaceSlug}/script.js`,
  };
}
