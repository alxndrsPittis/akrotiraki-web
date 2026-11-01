// API client for the Apps Script backend (see akrotiraki-ops/docs/API.md).
export class ApiError extends Error {
  constructor(code, message, data) {
    super(message || code);
    this.code = code;
    this.data = data;
  }
}

let cfg = { mock: false, url: '', getToken: async () => '', onUnauthorized: () => {} };
let mockModule = null;

export function configureApi(c) { cfg = { ...cfg, ...c }; }

export async function call(action, payload = {}) {
  const token = await cfg.getToken();
  let json;
  if (cfg.mock) {
    mockModule ||= await import('./mock.js');
    json = await mockModule.handle(token, action, JSON.parse(JSON.stringify(payload)));
  } else {
    let res;
    try {
      res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token, action, payload }),
        redirect: 'follow',
        cache: 'no-store',
      });
    } catch {
      throw new ApiError('network', 'You appear to be offline.');
    }
    try {
      json = await res.json();
    } catch {
      throw new ApiError('server', `Unexpected response from server (${res.status}).`);
    }
  }
  if (!json || json.ok !== true) {
    const err = new ApiError(json?.error || 'server', json?.message || 'Something went wrong.', json?.data);
    if (err.code === 'unauthorized') cfg.onUnauthorized(err);
    throw err;
  }
  return json.data;
}
