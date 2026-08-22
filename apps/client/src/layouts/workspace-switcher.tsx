import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Blocks, Check, ChevronsUpDown, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/auth-client";
import { FormInput } from "@/components/app-ui";
import { FormDialog } from "@/components/app-ui/dialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { getFormString } from "@/lib/form-data";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/lib/workspace";
import {
  activateWorkspace,
  createAndActivateWorkspace,
  listedWorkspaces,
  reloadAfterWorkspaceChange,
} from "@/lib/workspace-session";

export function WorkspaceSwitcher({ workspace }: { workspace: Workspace }): ReactNode {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: organizations } = authClient.useListOrganizations();
  const { busy, error, run } = useFormSubmission("作成できませんでした");
  const [createOpen, setCreateOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const options = listedWorkspaces(workspace, organizations);

  async function reload(): Promise<void> {
    await reloadAfterWorkspaceChange({ queryClient, router, navigate });
  }

  async function switchTo(organizationId: string): Promise<void> {
    if (organizationId === workspace.id || switching || busy) return;
    setSwitching(true);
    const result = await activateWorkspace(organizationId);
    if ("error" in result) {
      toast.error(result.error);
      setSwitching(false);
      return;
    }
    await reload();
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = getFormString(new FormData(event.currentTarget), "name");
    await run(async () => {
      const result = await createAndActivateWorkspace(name);
      if ("error" in result) {
        throw new Error(result.error);
      }
      setCreateOpen(false);
      await reload();
    });
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  tooltip={workspace.name}
                  className={cn(
                    "h-auto gap-2.5 rounded-none px-3 py-3.5",
                    "data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground",
                  )}
                />
              }
            >
              <div className="flex size-6.5 shrink-0 items-center justify-center rounded-[7px] bg-primary text-primary-foreground">
                <Blocks className="size-[15px]" />
              </div>
              <span className="min-w-0 flex-1 truncate text-left text-[13px] font-bold text-foreground">
                {workspace.name}
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={isMobile ? "bottom" : "right"}
              align="start"
              className="min-w-56"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>ワークスペース</DropdownMenuLabel>
                {options.map((option) => {
                  const current = option.id === workspace.id;
                  return (
                    <DropdownMenuItem
                      key={option.id}
                      disabled={switching || busy}
                      onClick={() => void switchTo(option.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.name}</span>
                      {current ? <Check /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={switching || busy} onClick={() => setCreateOpen(true)}>
                  <Plus />
                  新しいワークスペース
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="ワークスペースを作成"
        description="OrganizationがOpenEngageのWorkspaceになります。"
        onSubmit={(event) => void submit(event)}
        busy={busy}
        error={error}
        submitLabel="作成して開始"
      >
        <FormInput label="ワークスペース名" name="name" required />
      </FormDialog>
    </>
  );
}
