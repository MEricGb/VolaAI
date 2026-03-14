const BASE = import.meta.env.VITE_API_URL ?? '/api';

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }

  return res.json();
}

// ── WhatsApp Groups ───────────────────────────────────────

export const getGroups = () =>
  request('GET', '/whatsapp/groups');

export const getPublicConfig = () =>
  request('GET', '/whatsapp/public-config');

export const getAdminOverview = () =>
  request('GET', '/whatsapp/admin/overview');

export const createGroup = (name, ownerPhone, ownerName, memberPhones = []) =>
  request('POST', '/whatsapp/groups', { name, ownerPhone, ownerName, memberPhones });

export const addGroupMembers = (groupId, memberPhones) =>
  request('POST', `/whatsapp/groups/${groupId}/members`, { memberPhones });

export const sendGroupMessage = (groupId, body, senderPhone) =>
  request('POST', `/whatsapp/groups/${groupId}/messages`, { body, senderPhone });
