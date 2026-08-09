import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { enqueueSegmentContactReconciliation } from "../segments/reconciliation-queue";
import {
  CompanyConflictError,
  assignCompanyContact,
  createCompany,
  getCompanyDetail,
  listCompanies,
  removeCompanyContact,
  updateCompany,
} from "./company-service";

export const listCompaniesProcedure = authed.companies.list.handler(({ context, input }) =>
  listCompanies(context.database, context.workspace, {
    ...(input.query ? { query: input.query } : {}),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  }),
);

export const getCompanyProcedure = authed.companies.get.handler(
  async ({ context, input, errors }) => {
    const company = await getCompanyDetail(context.database, context.workspace, input.id);
    if (!company) throw errors.COMPANY_NOT_FOUND();
    return company;
  },
);

export const createCompanyProcedure = authed.companies.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await createCompany(
        context.database,
        context.workspace,
        input,
        context.executionContext,
      );
    } catch (error) {
      if (error instanceof CompanyConflictError) throw errors.COMPANY_CONFLICT({ cause: error });
      throw error;
    }
  },
);

export const updateCompanyProcedure = authed.companies.update.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    try {
      const company = await updateCompany(context.database, context.workspace, id, changes);
      if (!company) throw errors.COMPANY_NOT_FOUND();
      const detail = await getCompanyDetail(context.database, context.workspace, id);
      await enqueueSegmentContactReconciliation(
        context.env.JOBS_QUEUE,
        context.workspace.workspaceId,
        detail?.contacts.map((contact) => contact.id) ?? [],
      );
      return company;
    } catch (error) {
      if (error instanceof CompanyConflictError) throw errors.COMPANY_CONFLICT({ cause: error });
      throw error;
    }
  },
);

export const assignCompanyContactProcedure = authed.companies.assignContact.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const assigned = await assignCompanyContact(context.database, context.workspace, input);
    if (!assigned) throw errors.COMPANY_CONTACT_NOT_FOUND();
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      [input.contactId],
    );
    return ack;
  },
);

export const removeCompanyContactProcedure = authed.companies.removeContact.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const removed = await removeCompanyContact(context.database, context.workspace, input);
    if (!removed) throw errors.COMPANY_CONTACT_NOT_FOUND();
    await enqueueSegmentContactReconciliation(
      context.env.JOBS_QUEUE,
      context.workspace.workspaceId,
      [input.contactId],
    );
    return ack;
  },
);

export const companyProcedures = {
  list: listCompaniesProcedure,
  get: getCompanyProcedure,
  create: createCompanyProcedure,
  update: updateCompanyProcedure,
  assignContact: assignCompanyContactProcedure,
  removeContact: removeCompanyContactProcedure,
};
