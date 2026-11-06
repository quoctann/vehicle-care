// Base URL prepended to every API path and to the Google OAuth start URL.
// In production this should be left empty so all requests stay same-origin
// through the frontend nginx proxy. Setting it to a separate public API
// hostname breaks auth because:
//   - session cookies are SameSite=Lax and are only sent to the origin that
//     set them,
//   - the CSRF double-submit cookie is read from document.cookie and must
//     belong to the same origin as the API request.
// The Google OAuth callback is a browser redirect, so it also stays on the
// same public application origin.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '';
