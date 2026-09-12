import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useEffect, type CSSProperties, type ReactNode } from "react";

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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  activeSection,
  isNavTabActive,
  navigationSections,
  settingsSection,
} from "@/layouts/navigation";
import { WorkspaceSwitcher } from "@/layouts/workspace-switcher";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/lib/workspace";
import type { WorkspaceOption } from "@/lib/workspace-session";

/** Keep navigation stable so the work surface owns the available width. */
const SIDEBAR_WIDTH = "14rem";

const NAV_ITEM_CLASS = "h-10 rounded-md px-3 py-2 text-sm font-medium";

export function AppShell({
  user,
  workspace,
  workspaces,
}: {
  user: { name: string; email: string };
  workspace: Workspace;
  workspaces: readonly WorkspaceOption[];
}): ReactNode {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search });
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
      <SidebarRouteSync pathname={pathname} />
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border p-0">
          <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} />
        </SidebarHeader>
        <SidebarContent className="gap-0 px-3 py-4">
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
        className="min-h-0 min-w-0 overflow-hidden outline-none"
      >
        <div
          className={cn(
            "min-h-10 shrink-0 items-center border-b",
            section?.tabs.length ? "flex" : "flex md:hidden",
          )}
        >
          <SidebarTrigger className="ml-3 shrink-0 md:hidden" aria-label="ナビゲーションを開く" />
          {section && section.tabs.length > 0 ? (
            <nav
              aria-label={`${section.label}の画面`}
              className="flex min-h-10 min-w-0 flex-1 gap-5 overflow-x-auto px-4 md:px-6"
            >
              {section.tabs.map((tab) => {
                const active = isNavTabActive(pathname, section, tab, search);
                return (
                  <Link
                    key={`${tab.to}-${tab.search?.view ?? ""}`}
                    to={tab.to}
                    search={tab.search ?? {}}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 shrink-0 items-center border-b-2 px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      active
                        ? "border-primary font-medium text-primary"
                        : "border-transparent text-text-secondary hover:text-foreground",
                    )}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <span className="px-3 text-sm font-medium">{section?.label ?? "OpenEngage"}</span>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
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

function SidebarRouteSync({ pathname }: { pathname: string }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);
  return null;
}
