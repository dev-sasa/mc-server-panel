'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startPanel } = require('./helpers');

let p, admin;
before(async () => { p = await startPanel(); admin = await p.admin(); });
after(async () => { await p.stop(); });

const mk = async (name, role) => {
  const r = await admin.post('/api/users', { username: name, password: 'passwort123', role });
  assert.equal(r.status, 200, r.text);
  return p.client().login(name, 'passwort123');
};

test('Betrachter darf nur lesen', async () => {
  const v = await mk('viewer1', 'viewer');
  assert.equal((await v.get('/api/status')).status, 200);
  assert.equal((await v.post('/api/server/start')).status, 403);
  assert.equal((await v.get('/api/files')).status, 403);
  assert.equal((await v.get('/api/users')).status, 403);
  assert.equal((await v.get('/api/audit')).status, 403);
  assert.equal((await v.get('/api/backups')).status, 403);
});

test('Moderator darf Spieler/Server steuern, aber nicht Benutzer und Einstellungen', async () => {
  const m = await mk('mod1', 'moderator');
  assert.equal((await m.get('/api/users')).status, 403);
  assert.equal((await m.get('/api/audit')).status, 403);
  assert.equal((await m.post('/api/users', { username: 'x1', password: 'passwort123', role: 'viewer' })).status, 403);
  assert.equal((await m.get('/api/players')).status, 200);
});

test('Eigene Rolle: nur die gewählten Rechte gelten', async () => {
  const roles = await admin.get('/api/roles');
  const perm = roles.json.perms[0].id || roles.json.perms[0];
  const created = await admin.post('/api/roles', { name: 'Datei-Helfer', perms: ['files'] });
  assert.equal(created.status, 200, created.text);
  const id = created.json.role.id;
  const u = await mk('filer', id);
  assert.equal((await u.get('/api/files')).status, 200);
  assert.equal((await u.get('/api/backups')).status, 403);
  assert.equal((await u.post('/api/server/start')).status, 403);
  assert.ok(perm);
});

test('Rollen: eingebaute nicht änderbar, Namen eindeutig, Löschen nur ohne Benutzer', async () => {
  assert.equal((await admin.put('/api/roles/admin', { name: 'x' })).status, 400);
  const a = await admin.post('/api/roles', { name: 'Test A', perms: [] });
  assert.equal(a.status, 200);
  assert.notEqual((await admin.post('/api/roles', { name: 'Test A', perms: [] })).status, 200);
  const id = a.json.role.id;
  await mk('uA', id);
  assert.notEqual((await admin.del('/api/roles/' + id)).status, 200);
  assert.equal((await admin.del('/api/users/uA')).status, 200);
  assert.equal((await admin.del('/api/roles/' + id)).status, 200);
});

test('Rechteausweitung ist verboten: nur Rollen vergeben, deren Rechte man selbst hat', async () => {
  const r = await admin.post('/api/roles', { name: 'Benutzer-Chef', perms: ['users'] });
  assert.equal(r.status, 200, r.text);
  const boss = await mk('boss', r.json.role.id);
  assert.equal((await boss.post('/api/users', { username: 'weg1', password: 'passwort123', role: 'admin' })).status, 403);
  assert.equal((await boss.post('/api/users', { username: 'weg2', password: 'passwort123', role: 'moderator' })).status, 403);
  assert.ok((await boss.put('/api/users/boss', { role: 'admin' })).status >= 400);
  assert.equal((await boss.put('/api/users/admin', { password: 'neuespasswort1' })).status, 403);
});

test('Hauptbenutzer ist geschützt', async () => {
  const other = await mk('admin2', 'admin');
  assert.equal((await other.del('/api/users/admin')).status, 403);
  assert.equal((await other.put('/api/users/admin', { role: 'viewer' })).status, 403);
  assert.equal((await admin.del('/api/users/admin')).status, 400);
});
