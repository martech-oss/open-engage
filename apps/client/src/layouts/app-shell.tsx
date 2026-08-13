import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { authClient } from "@/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { contactOptionsQueryOptions } from "@/features/contacts/contact-api";
import { activeSection, navigationSections, settingsSection } from "@/layouts/navigation";
import { WorkspaceSwitcher } from "@/layouts/workspace-switcher";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/lib/workspace";

/** 212px in the design doc — narrow enough that the 13px nav labels set the width. */
const SIDEBAR_WIDTH = "13.25rem";

/** Saved segments listed under the nav, matching the design's short shortcut list. */
const SIDEBAR_SEGMENT_LIMIT = 4;

const NAV_ITEM_CLASS = "h-auto rounded-[7px] px-2.5 py-2 text-[13px] font-medium";

export function AppShell({
  user,
  workspace,
}: {
  user: { name: string; email: string };
  workspace: Workspace;
}): ReactNode {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const section = activeSection(pathname);

  async function signOut(): Promise<void> {
    await authClient.signOut();
    queryClient.clear();
    await router.invalidate({ sync: true });
    await navigate({
      to: "/login",
      search: { redirect: "/dashboard" },
      replace: true,
    });
  }

  return (
    <SidebarProvider
      className="h-svh"
      style={{ "--sidebar-width": SIDEBAR_WIDTH } as CSSProperties}
    >
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-3 focus:ring-ring/50 focus:outline-none"
      >
        メインコンテンツへ移動
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border p-0">
          <WorkspaceSwitcher workspace={workspace} />
        </SidebarHeader>
        <SidebarContent className="gap-0 px-2 py-2.5">
          <SidebarMenu className="gap-0.5">
            {navigationSections.map((item) => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  render={<Link to={item.to} />}
                  tooltip={item.label}
                  className={NAV_ITEM_CLASS}
                  {...(section?.to === item.to ? { "data-active": "true" } : {})}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <SavedSegments />
        </SidebarContent>
        <SidebarFooter className="gap-0.5 border-t border-sidebar-border p-2">
          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to={settingsSection.to} />}
                tooltip={settingsSection.label}
                className={NAV_ITEM_CLASS}
                {...(section?.to === settingsSection.to ? { "data-active": "true" } : {})}
              >
                <settingsSection.icon />
                <span>{settingsSection.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <AccountMenu user={user} onSignOut={signOut} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset
        id="main-content"
        tabIndex={-1}
        className="min-h-0 overflow-hidden outline-none"
      >
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * The design's shortcut list under the nav. Rendered from the segments the
 * contacts filters already load, so it stays absent — rather than showing
 * placeholder rows — until a workspace actually has saved segments.
 */
function SavedSegments(): ReactNode {
  const { state } = useSidebar();
  const { data } = useQuery(contactOptionsQueryOptions());
  const segments = data?.segments.slice(0, SIDEBAR_SEGMENT_LIMIT) ?? [];
  if (state === "collapsed" || segments.length === 0) return null;

  return (
    <div className="mt-3.5 flex flex-col group-data-[collapsible=icon]:hidden">
      <div className="px-2.5 pb-1.5 font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        保存したセグメント
      </div>
      {segments.map((segment) => (
        <Link
          key={segment.id}
          to="/contacts"
          search={{ segmentId: segment.id }}
          className="flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="truncate">{segment.name}</span>
          <span className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
            {segment.memberCount.toLocaleString()}
          </span>
        </Link>
      ))}
    </div>
  );
}

function AccountMenu({
  user,
  onSignOut,
}: {
  user: { name: string; email: string };
  onSignOut: () => Promise<void>;
}): ReactNode {
  const { isMobile } = useSidebar();
  const displayName = user.name.trim() || user.email;
  const fallback = displayName.charAt(0).toUpperCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                tooltip="アカウントメニュー"
                className={cn(
                  "h-auto gap-2.5 rounded-[7px] px-2.5 py-1.5",
                  "data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground",
                )}
              />
            }
          >
            <Avatar className="size-6.5">
              <AvatarFallback className="text-[11px]">{fallback}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left">
              <span className="truncate text-xs leading-tight font-medium text-foreground">
                {displayName}
              </span>
              <span className="truncate text-[10px] leading-tight text-muted-foreground">
                {user.email}
              </span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>アカウント</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void onSignOut()}>
                <LogOut />
                ログアウト
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
