import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  assignCompanyContact,
  invalidateCompanyQueries,
  removeCompanyContact,
} from "@/features/companies/company-api";
import { invalidateSegmentQueries } from "@/features/segments/segment-api";
import { getErrorMessage } from "@/lib/errors";
import type { ContactScoreAdjust, ContactUpdate } from "@openengage/core/contacts";

import {
  addContactToSegment,
  adjustContactScore,
  archiveContact,
  assignContactTag,
  contactProfileQueryOptions,
  invalidateContactOptions,
  removeContactFromSegment,
  removeContactTag,
  restoreContact,
  updateContact,
} from "./contact-api";

type DrawerTab = "details" | "activity";

/** Read models outside the contact that a drawer mutation also changes. */
interface AffectedResources {
  companyId?: string;
  segmentId?: string;
}

export function useContactDrawerController(contactId: string, onChanged: () => Promise<void>) {
  const profileQuery = useQuery(contactProfileQueryOptions(contactId));
  const queryClient = useQueryClient();
  const [ui, setUi] = useState({
    contactId,
    activeTab: "activity" as DrawerTab,
    error: "",
    busy: false,
  });
  const currentUi =
    ui.contactId === contactId
      ? ui
      : { contactId, activeTab: "activity" as DrawerTab, error: "", busy: false };

  async function refresh({ companyId, segmentId }: AffectedResources): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: contactProfileQueryOptions(contactId).queryKey }),
      invalidateContactOptions(queryClient),
      ...(companyId ? [invalidateCompanyQueries(queryClient, companyId)] : []),
      ...(segmentId ? [invalidateSegmentQueries(queryClient, segmentId)] : []),
      onChanged(),
    ]);
  }

  async function mutate(
    action: () => Promise<unknown>,
    affected: AffectedResources = {},
  ): Promise<boolean> {
    setUi({ ...currentUi, error: "", busy: true });
    try {
      await action();
      await refresh(affected);
      setUi({ ...currentUi, error: "", busy: false });
      return true;
    } catch (error) {
      setUi({
        ...currentUi,
        error: getErrorMessage(error, "更新できませんでした"),
        busy: false,
      });
      return false;
    }
  }

  const profile = profileQuery.data;
  return {
    profile,
    loading: profileQuery.isLoading,
    loadError: profileQuery.error,
    activeTab: currentUi.activeTab,
    error: currentUi.error,
    busy: currentUi.busy,
    setActiveTab: (activeTab: DrawerTab) => setUi({ ...currentUi, activeTab }),
    clearError: () => setUi({ ...currentUi, error: "" }),
    archive: () => mutate(() => archiveContact(contactId)),
    restore: () => mutate(() => restoreContact(contactId)),
    update: (input: ContactUpdate) => mutate(() => updateContact(contactId, input)),
    adjustScore: (input: ContactScoreAdjust) => mutate(() => adjustContactScore(contactId, input)),
    assignTag: (id: string) => mutate(() => assignContactTag(contactId, id)),
    removeTag: (id: string) => mutate(() => removeContactTag(contactId, id)),
    addSegment: (id: string) => mutate(() => addContactToSegment(contactId, id), { segmentId: id }),
    removeSegment: (id: string) =>
      mutate(() => removeContactFromSegment(contactId, id), { segmentId: id }),
    addCompany: (id: string) =>
      mutate(
        () =>
          assignCompanyContact({
            companyId: id,
            contactId,
            isPrimary: profile?.companies.length === 0,
          }),
        { companyId: id },
      ),
    removeCompany: (id: string) =>
      mutate(() => removeCompanyContact(id, contactId), { companyId: id }),
  };
}
