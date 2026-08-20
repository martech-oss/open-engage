import { DatabaseRepository } from "../shared/repository-base";
import { AutomationsReportsRepository } from "./automations-repository";
import { ContactsReportsRepository } from "./contacts-repository";
import { DashboardReportsRepository } from "./dashboard-repository";
import { DealsReportsRepository } from "./deals-repository";
import { EmailsReportsRepository } from "./emails-repository";
import { SiteReportsRepository } from "./site-repository";

export * from "./types";

/** Compatibility facade for the report domains. */
export class ReportsRepository extends DatabaseRepository {
  private readonly deals = new DealsReportsRepository(this.database);
  private readonly contacts = new ContactsReportsRepository(this.database);
  private readonly automations = new AutomationsReportsRepository(this.database);
  private readonly emails = new EmailsReportsRepository(this.database);
  private readonly site = new SiteReportsRepository(this.database);
  private readonly dashboard = new DashboardReportsRepository(this.database);

  public listDealCurrencies(...args: Parameters<DealsReportsRepository["listDealCurrencies"]>) {
    return this.deals.listDealCurrencies(...args);
  }
  public dealsSummary(...args: Parameters<DealsReportsRepository["dealsSummary"]>) {
    return this.deals.dealsSummary(...args);
  }
  public contactsSummary(...args: Parameters<ContactsReportsRepository["contactsSummary"]>) {
    return this.contacts.contactsSummary(...args);
  }
  public automationsSummary(
    ...args: Parameters<AutomationsReportsRepository["automationsSummary"]>
  ) {
    return this.automations.automationsSummary(...args);
  }
  public emailsSummary(...args: Parameters<EmailsReportsRepository["emailsSummary"]>) {
    return this.emails.emailsSummary(...args);
  }
  public siteSummary(...args: Parameters<SiteReportsRepository["siteSummary"]>) {
    return this.site.siteSummary(...args);
  }
  public dashboardSummary(...args: Parameters<DashboardReportsRepository["dashboardSummary"]>) {
    return this.dashboard.dashboardSummary(...args);
  }
}
