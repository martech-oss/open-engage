import type { Hono } from "hono";

import type { AppEnvironment } from "../env";
import { registerPublicAssetRoutes } from "./asset-routes";
import { registerPublicCustomRedirectRoutes } from "./custom-redirect-routes";
import { registerEmailTrackingRoutes } from "./email-tracking-routes";
import { registerPublicFormHandlerRoutes } from "./form-handler-routes";
import { registerPublicFormRoutes } from "./form-routes";
import { registerPublicLandingRoutes } from "./landing-routes";
import { registerPublicPreferenceRoutes } from "./preference-routes";
import { registerPublicSiteMessageRoutes } from "./site-message-routes";
import { registerPublicTrackingRoutes } from "./tracking-routes";

/**
 * Unauthenticated, browser-facing routes: hosted landing pages and forms, the
 * site tracking beacon, email open/click endpoints, custom redirects, in-app
 * messages, public assets, and unsubscribe / preference pages.
 */
export function registerPublicRoutes(publicApp: Hono<AppEnvironment>): void {
  registerPublicAssetRoutes(publicApp);
  registerPublicLandingRoutes(publicApp);
  registerPublicFormRoutes(publicApp);
  registerPublicFormHandlerRoutes(publicApp);
  registerPublicTrackingRoutes(publicApp);
  registerEmailTrackingRoutes(publicApp);
  registerPublicCustomRedirectRoutes(publicApp);
  registerPublicSiteMessageRoutes(publicApp);
  registerPublicPreferenceRoutes(publicApp);
}
