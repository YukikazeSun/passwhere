import type { PasswordHistoryItem } from "../types";
import { createId, nowIso } from "./utils";

export function updatePasswordHistory(
  currentPassword: string,
  nextPassword: string,
  history: PasswordHistoryItem[],
  keepCurrent: boolean,
  timestamp = nowIso(),
) {
  let nextHistory = history.filter((item) => item.password !== nextPassword);

  if (keepCurrent && currentPassword && currentPassword !== nextPassword) {
    const existing = nextHistory.find((item) => item.password === currentPassword);
    nextHistory = nextHistory.filter((item) => item.password !== currentPassword);
    nextHistory.unshift(
      existing
        ? { ...existing, changedAt: timestamp }
        : { id: createId("history"), password: currentPassword, changedAt: timestamp },
    );
  }

  return nextHistory.slice(0, 3);
}
