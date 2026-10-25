export {};

declare global {
  interface Window {
    __FISCOAI_AGENT__?: {
      importXmlBatch?: (files: Array<{name?: string; path?: string; xml?: string}>) => Promise<unknown>;
      getArchive?: () => unknown;
    };
    fiscoaiDesktop?: {
      isDesktop?: boolean;
      platform?: string;
      version?: string;
      agentApi?: boolean;
    };
  }
}
