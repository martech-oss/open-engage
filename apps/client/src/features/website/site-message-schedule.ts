import { workspaceDateTimeToUtc } from "@openengage/core/shared/time";

export interface SiteMessageScheduleInput {
  startsAt: string | null;
  endsAt: string | null;
}

export function normalizeSiteMessageSchedule(
  input: SiteMessageScheduleInput,
  timeZone: string,
): SiteMessageScheduleInput {
  const startsAt = input.startsAt ? workspaceDateTimeToUtc(input.startsAt, timeZone) : null;
  const endsAt = input.endsAt ? workspaceDateTimeToUtc(input.endsAt, timeZone) : null;
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new Error("終了日時は開始日時より後にしてください");
  }
  return { startsAt, endsAt };
}
