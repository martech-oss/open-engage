import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { FormInput, FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";

import { CONTACT_PICKER_LIMIT, contactPickerQueryOptions } from "./contact-api";
import { contactOptionLabel } from "./contact-bits";

/**
 * Search box plus select for dialogs that add an existing contact. Candidates
 * come from a server search, so contacts beyond the first page stay reachable;
 * `excludeIds` hides contacts that are already attached.
 */
export function ContactPickerField({
  name = "contactId",
  label = "連絡先",
  excludeIds,
}: {
  name?: string;
  label?: string;
  excludeIds: ReadonlySet<string>;
}): ReactNode {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  useDebouncedSearch({ value: draft.trim(), onCommit: setQuery });
  const result = useQuery(contactPickerQueryOptions(query));
  const candidates = (result.data?.items ?? []).filter((contact) => !excludeIds.has(contact.id));
  const hint = pickerHint({
    pending: result.isPending,
    failed: result.isError,
    empty: candidates.length === 0,
    truncated: (result.data?.total ?? 0) > CONTACT_PICKER_LIMIT,
  });

  return (
    <>
      <FormInput
        label="連絡先を検索"
        name={`${name}-search`}
        type="search"
        value={draft}
        placeholder="名前またはメールアドレス"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      {/* Stays enabled while loading: a disabled control skips required
          validation, so the dialog could submit an empty contact id. */}
      <FormNativeSelect label={label} name={name} required {...(hint ? { description: hint } : {})}>
        <FormSelectOption value="">選択してください</FormSelectOption>
        {candidates.map((contact) => (
          <FormSelectOption key={contact.id} value={contact.id}>
            {contactOptionLabel(contact)}
          </FormSelectOption>
        ))}
      </FormNativeSelect>
    </>
  );
}

function pickerHint(state: {
  pending: boolean;
  failed: boolean;
  empty: boolean;
  truncated: boolean;
}): string | undefined {
  if (state.pending) return "連絡先を読み込んでいます。";
  if (state.failed) return "連絡先を読み込めませんでした。検索し直してください。";
  if (state.empty) return "追加できる連絡先が見つかりません。検索語を変えてください。";
  if (state.truncated) return `上位${CONTACT_PICKER_LIMIT}件を表示しています。検索で絞り込めます。`;
  return undefined;
}
