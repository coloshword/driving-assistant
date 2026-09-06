import Config from 'react-native-config';

export const DEFAULT_API_BASE_URL = (Config.API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const APP_API_KEY = Config.APP_API_KEY || '';
export const SPOTIFY_CLIENT_ID = Config.SPOTIFY_CLIENT_ID || '';

/** Custom URL scheme registered in Info.plist; OAuth flows bounce back here. */
export const APP_URL_SCHEME = 'drivingassistant';
export const OAUTH_REDIRECT = (provider: string) => `${APP_URL_SCHEME}://oauth/${provider}`;
