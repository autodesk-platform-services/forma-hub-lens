/**
 * APS OAuth endpoints.
 *
 * Kept in their own module, free of any Next.js import, so code that only needs
 * a URL (the two-legged token helper, tests) doesn't have to pull in the
 * session machinery and `next/headers` with it.
 */

export const AUTHORIZE_URL = "https://developer.api.autodesk.com/authentication/v2/authorize";
export const TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token";
export const USERINFO_URL = "https://api.userprofile.autodesk.com/userinfo";
