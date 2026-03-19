declare module 'stremio-addon-sdk' {
  export class addonBuilder {
    manifest: Record<string, any>;
    constructor(manifest: Record<string, any>);
    defineCatalogHandler(handler: (args: any) => Promise<{ metas: any[] }>): void;
    defineStreamHandler(handler: (args: any) => Promise<{ streams: any[] }>): void;
    defineMetaHandler(handler: (args: any) => Promise<{ meta: any }>): void;
    getInterface(): AddonInterface;
  }
  export interface AddonInterface {
    manifest: Record<string, any>;
    _cleanManifest?: Record<string, any> | null;
    addonInstance?: any;
    _logoSources?: string[];
    [key: string]: any;
  }
  export function getRouter(iface: AddonInterface): any;
}
