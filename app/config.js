// Akrotiraki management app — configuration.
// This file is public (served by GitHub Pages). Put no secrets here:
// the backend verifies every request against the Users tab.
const config = {
  // URL of the deployed Apps Script web app (ends in /exec).
  // Leave empty to run the app in MOCK mode with sample data.
  API_URL: "https://script.google.com/macros/s/AKfycbya0xmtUKCYUBxw6hX43RCsHHNM6JcaWnbfHtKt0VIMqH0BppJ6Cuo-deDG_3qE2BwO/exec",

  // OAuth 2.0 Web client ID from Google Cloud Console
  // (must equal the `client_id` value in the Settings tab of the Sheet).
  // Add https://alxndrspittis.github.io as an authorised JavaScript origin.
  CLIENT_ID: "",

  // Force MOCK mode even when API_URL is set. `?mock=1` in the URL does the same.
  MOCK: false,
};

export default config;
export const { API_URL, CLIENT_ID, MOCK } = config;
