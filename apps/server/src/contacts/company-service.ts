import type {
  Company,
  CompanyContactDto,
  CompanyCreate,
  CompanyDetail,
  CompanyUpdate,
} from "@openengage/core/contacts";
import type { WorkspaceContext } from "@openengage/core/shared";
import { type OpenEngageDatabase } from "@openengage/database/client";
import {
  CompanyRepository,
  type CompanySummary as RepositoryAccountSummary,
} from "@openengage/database/contacts";
import { writeAuditLog } from "@openengage/database/platform";
import { isConstraintError } from "@openengage/database/shared";

/** Raised when a write conflicts with the unique domain constraint. */
export class CompanyConflictError extends Error {
  public constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "CompanyConflictError";
  }
}

export function listCompanies(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { query?: string; limit?: number },
): Promise<RepositoryAccountSummary[]> {
  return new CompanyRepository(database, workspace).listCompanies(input);
}

export async function getCompanyDetail(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<CompanyDetail | null> {
  const repository = new CompanyRepository(database, workspace);
  const company = await repository.getCompany(id);
  if (!company) return null;
  const contacts = await repository.listCompanyContacts(company.id);
  return {
    ...company,
    contacts: contacts.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      stage: row.stage,
      score: row.score,
      status: row.status as CompanyContactDto["status"],
      title: row.title,
      isPrimary: row.isPrimary,
    })),
  };
}

export async function createCompany(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: CompanyCreate,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<Company> {
  let company: Company;
  try {
    company = await new CompanyRepository(database, workspace).createCompany(input);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    throw new CompanyConflictError(error);
  }
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "company.create",
      resourceType: "company",
      resourceId: company.id,
    }),
  );
  return company;
}

export async function updateCompany(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: CompanyUpdate,
): Promise<Company | null> {
  try {
    return await new CompanyRepository(database, workspace).updateCompany(id, input);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    throw new CompanyConflictError(error);
  }
}

/**
 * Attaches a contact to an company. Returns false when either side is missing.
 * Promoting a contact to primary demotes it on every other company in one batch,
 * so a contact is never primary in two places.
 */
export async function assignCompanyContact(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { id: string; contactId: string; title?: string | undefined; isPrimary: boolean },
): Promise<boolean> {
  const repository = new CompanyRepository(database, workspace);
  if (!(await repository.hasAssignableContact(input.id, input.contactId))) return false;
  await repository.assignContact({
    companyId: input.id,
    contactId: input.contactId,
    title: input.title ?? null,
    isPrimary: input.isPrimary,
  });
  return true;
}

export function removeCompanyContact(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: { id: string; contactId: string },
): Promise<boolean> {
  return new CompanyRepository(database, workspace).removeContact(input.id, input.contactId);
}
