import { UserRound } from "lucide-react";
import { type ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { type Contact } from "@openengage/core/contacts";

export type BulkAction =
  | "add_tag"
  | "remove_tag"
  | "add_segment"
  | "remove_segment"
  | "archive"
  | "restore";

export function ControlledSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  className?: string;
}): ReactNode {
  return (
    <Select
      items={options}
      value={value || null}
      onValueChange={(nextValue) => onValueChange(nextValue ?? "")}
    >
      <SelectTrigger className={cn("min-w-40", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * Avatar tints in the list view. Picked by a hash of the contact id so a row
 * keeps its colour across pages and refetches — the point is recognisability in
 * a dense table, not encoding anything about the contact.
 */
const AVATAR_TINTS = [
  "oklch(0.58 0.16 25)",
  "oklch(0.55 0.13 163)",
  "oklch(0.5 0.1 255)",
  "oklch(0.6 0.12 75)",
  "oklch(0.52 0.11 300)",
  "oklch(0.5 0.06 40)",
];

function avatarTint(contact: Contact): string | undefined {
  if (contact.status === "anonymous") return "oklch(0.72 0.012 40)";
  let hash = 0;
  for (const character of contact.id) hash = (hash + character.charCodeAt(0)) % AVATAR_TINTS.length;
  return AVATAR_TINTS[hash];
}

export function ContactAvatar({
  contact,
  large = false,
  tinted = false,
}: {
  contact: Contact;
  large?: boolean;
  /** Fills the avatar with the contact's stable tint, for the dense list rows. */
  tinted?: boolean;
}): ReactNode {
  const initials = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .map((value) => value!.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <Avatar
      size={large ? "lg" : "default"}
      className={cn(large && "size-14", tinted && "size-6.5")}
    >
      <AvatarFallback
        className={cn(large && "text-lg", tinted && "text-[10.5px] font-semibold text-white")}
        style={tinted ? { backgroundColor: avatarTint(contact) } : undefined}
      >
        {initials || <UserRound />}
      </AvatarFallback>
    </Avatar>
  );
}

const STATUS_TONES: Record<Contact["status"], string> = {
  active: "var(--color-success)",
  archived: "var(--color-muted-foreground)",
  anonymous: "var(--color-warning)",
};

export const CONTACT_STATUS_LABELS: Record<Contact["status"], string> = {
  active: "有効",
  archived: "アーカイブ",
  anonymous: "匿名",
};

/** Dot-and-label status, the badge-free form the dense list rows use. */
export function ContactStatusDot({ status }: { status: Contact["status"] }): ReactNode {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: STATUS_TONES[status] }}
      />
      {CONTACT_STATUS_LABELS[status]}
    </span>
  );
}

export function ContactScoreBadge({ score }: { score: number }): ReactNode {
  return (
    <span
      className={cn(
        "inline-block min-w-9 rounded-sm px-1.5 py-0.5 text-center text-[11.5px] font-semibold tabular-nums",
        score >= 50 && "bg-success/15 text-success",
        score >= 20 && score < 50 && "bg-warning/20 text-warning-foreground",
        score < 20 && "bg-secondary text-muted-foreground",
      )}
    >
      {score}
    </span>
  );
}

export function ContactStatusBadge({ status }: { status: Contact["status"] }): ReactNode {
  const classes = (
    {
      active: "bg-success text-success-foreground",
      archived: "",
      anonymous: "bg-warning text-warning-foreground",
    } satisfies Record<Contact["status"], string>
  )[status];
  return (
    <Badge variant="secondary" className={classes}>
      {CONTACT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}): ReactNode {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

export function contactName(contact: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  externalId?: string | null;
}): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.email ||
    contact.externalId ||
    "匿名Contact"
  );
}

/** Surname-first join with no fallback, shared by contactOptionLabel and the company contact list so both stay in the same order. */
export function contactSurnameFirstName(contact: {
  firstName: string | null;
  lastName: string | null;
}): string {
  return [contact.lastName, contact.firstName].filter(Boolean).join(" ");
}

export function contactOptionLabel(contact: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string {
  const name = contactSurnameFirstName(contact);
  return name
    ? `${name}${contact.email ? `（${contact.email}）` : ""}`
    : (contact.email ?? "名前未設定");
}
