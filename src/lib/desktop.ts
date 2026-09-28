export type FiscoAIDesktopBridge = {
  isDesktop?: boolean;
  platform?: string;
  version?: string;
};

export function getDesktopBridge(): FiscoAIDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return ((window as Window & { fiscoaiDesktop?: FiscoAIDesktopBridge }).fiscoaiDesktop) ?? null;
}

export function isDesktopApp(): boolean {
  return getDesktopBridge()?.isDesktop === true;
}
