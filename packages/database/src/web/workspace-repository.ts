import { WorkspaceRepository } from "../shared/repository-base";
import { LandingPageRepository } from "./landing-page-repository";
import { SignupFormRepository } from "./signup-form-repository";
import { SiteMessageRepository } from "./site-message-repository";
import { SiteTrackingRepository } from "./tracking-repository";
import { VisitorMessageRepository } from "./visitor-message-repository";

export type { LandingPageUpdateOutcome } from "./landing-page-repository";

/** Compatibility facade over focused website repositories. */
export class WebRepository extends WorkspaceRepository {
  private readonly forms = new SignupFormRepository(this.database, this.context);
  private readonly pages = new LandingPageRepository(this.database, this.context);
  private readonly tracking = new SiteTrackingRepository(this.database, this.context);
  private readonly messages = new SiteMessageRepository(this.database, this.context);
  private readonly visitors = new VisitorMessageRepository(this.database, this.context);

  public listSignupForms(...args: Parameters<SignupFormRepository["listSignupForms"]>) {
    return this.forms.listSignupForms(...args);
  }
  public createSignupForm(...args: Parameters<SignupFormRepository["createSignupForm"]>) {
    return this.forms.createSignupForm(...args);
  }
  public updateSignupForm(...args: Parameters<SignupFormRepository["updateSignupForm"]>) {
    return this.forms.updateSignupForm(...args);
  }
  public archiveSignupForm(...args: Parameters<SignupFormRepository["archiveSignupForm"]>) {
    return this.forms.archiveSignupForm(...args);
  }
  public listLandingPages(...args: Parameters<LandingPageRepository["listLandingPages"]>) {
    return this.pages.listLandingPages(...args);
  }
  public createLandingPage(...args: Parameters<LandingPageRepository["createLandingPage"]>) {
    return this.pages.createLandingPage(...args);
  }
  public updateLandingPage(...args: Parameters<LandingPageRepository["updateLandingPage"]>) {
    return this.pages.updateLandingPage(...args);
  }
  public archiveLandingPage(...args: Parameters<LandingPageRepository["archiveLandingPage"]>) {
    return this.pages.archiveLandingPage(...args);
  }
  public getTracking(...args: Parameters<SiteTrackingRepository["getTracking"]>) {
    return this.tracking.getTracking(...args);
  }
  public saveTrackingSettings(...args: Parameters<SiteTrackingRepository["saveTrackingSettings"]>) {
    return this.tracking.saveTrackingSettings(...args);
  }
  public listSiteMessages(...args: Parameters<SiteMessageRepository["listSiteMessages"]>) {
    return this.messages.listSiteMessages(...args);
  }
  public createSiteMessage(...args: Parameters<SiteMessageRepository["createSiteMessage"]>) {
    return this.messages.createSiteMessage(...args);
  }
  public updateSiteMessage(...args: Parameters<SiteMessageRepository["updateSiteMessage"]>) {
    return this.messages.updateSiteMessage(...args);
  }
  public archiveSiteMessage(...args: Parameters<SiteMessageRepository["archiveSiteMessage"]>) {
    return this.messages.archiveSiteMessage(...args);
  }
  public findActiveContactIdByEmail(
    ...args: Parameters<VisitorMessageRepository["findActiveContactIdByEmail"]>
  ) {
    return this.visitors.findActiveContactIdByEmail(...args);
  }
  public findVisitorContactId(
    ...args: Parameters<VisitorMessageRepository["findVisitorContactId"]>
  ) {
    return this.visitors.findVisitorContactId(...args);
  }
  public listActiveSiteMessagesForVisitor(
    ...args: Parameters<VisitorMessageRepository["listActiveSiteMessagesForVisitor"]>
  ) {
    return this.visitors.listActiveSiteMessagesForVisitor(...args);
  }
  public incrementSiteMessageCounter(
    ...args: Parameters<VisitorMessageRepository["incrementSiteMessageCounter"]>
  ) {
    return this.visitors.incrementSiteMessageCounter(...args);
  }
  public recordSiteMessageEvent(
    ...args: Parameters<VisitorMessageRepository["recordSiteMessageEvent"]>
  ) {
    return this.visitors.recordSiteMessageEvent(...args);
  }
}
