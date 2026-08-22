import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import {
  companyContactOptionsQueryOptions,
  companyEnrichmentCapabilityQueryOptions,
  companyQueryOptions,
  useAssignCompanyContact,
  useRemoveCompanyContact,
  useUpdateCompany,
  type CompanyContactDto,
} from "./company-api";
import { companyContactColumns } from "./company-columns";

export function useCompanyDetailController(companyId: string) {
  const { data: company } = useSuspenseQuery(companyQueryOptions(companyId));
  const { data: enrichmentCapability } = useSuspenseQuery(
    companyEnrichmentCapabilityQueryOptions(),
  );
  const { data: contactOptions } = useSuspenseQuery(companyContactOptionsQueryOptions());
  const [editOpen, setEditOpen] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [enrichmentOpen, setEnrichmentOpen] = useState(false);
  const updateCompany = useUpdateCompany();
  const removeContact = useRemoveCompanyContact();
  const assignContact = useAssignCompanyContact();
  const assignedIds = new Set(company.contacts.map((contact) => contact.id));

  async function remove(contact: CompanyContactDto): Promise<void> {
    await removeContact.mutateAsync({ id: company.id, contactId: contact.id });
    toast.success("会社との関連を解除しました");
  }

  async function update(values: { name: string; domain?: string }): Promise<void> {
    await updateCompany.mutateAsync({
      id: company.id,
      name: values.name,
      domain: values.domain || null,
    });
    toast.success("会社を更新しました");
    setEditOpen(false);
  }

  async function assign(values: { contactId: string; isPrimary: boolean }): Promise<void> {
    await assignContact.mutateAsync({ id: company.id, ...values });
    toast.success("連絡先を会社へ追加しました");
    setAddContactOpen(false);
  }

  async function applyEnrichment(values: { name?: string; domain?: string }): Promise<void> {
    await updateCompany.mutateAsync({ id: company.id, ...values });
    toast.success("取得した会社情報を反映しました");
  }

  return {
    company,
    enrichmentEnabled: enrichmentCapability.enabled,
    availableContacts: contactOptions.items.filter((contact) => !assignedIds.has(contact.id)),
    columns: companyContactColumns((contact) => void remove(contact)),
    editOpen,
    setEditOpen,
    addContactOpen,
    setAddContactOpen,
    enrichmentOpen,
    setEnrichmentOpen,
    update,
    assign,
    applyEnrichment,
  };
}
