import { AddonInterface } from 'stremio-addon-sdk';

declare global {
  namespace Express {
    interface Request {
      addonInterface?: AddonInterface;
      configToken?: string;
      userConfig?: any;
    }
  }
}
