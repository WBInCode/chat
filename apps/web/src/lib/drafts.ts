const PREFIX = "chatv2-draft-";

export function getDraft(channelId: string): string {
  try {
    return localStorage.getItem(PREFIX + channelId) ?? "";
  } catch {
    return "";
  }
}

export function setDraft(channelId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(PREFIX + channelId, text);
    else localStorage.removeItem(PREFIX + channelId);
  } catch {
    // localStorage unavailable (private mode etc.) — drafts just won't persist
  }
}

export function clearDraft(channelId: string): void {
  try {
    localStorage.removeItem(PREFIX + channelId);
  } catch {
    // ignore
  }
}

export function hasDraft(channelId: string): boolean {
  try {
    return !!localStorage.getItem(PREFIX + channelId);
  } catch {
    return false;
  }
}
