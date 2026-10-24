import { TEST_PASSWORD } from './test-constants.js';
import request from 'supertest';
import app from '../app.js';
import prisma from '../db.js';
import { blocksToText } from '../routes/documents.js';

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] });

describe('Documents and folders', () => {
  let owner: { id: number; token: string };
  let member: { id: number; token: string };
  let outsider: { id: number; token: string };
  let channelId: number;

  const register = async (n: string) => {
    const res = await request(app).post('/auth/register').send({ email: `docs-${n}@example.com`, password: TEST_PASSWORD, name: `Docs ${n}` });
    return { id: res.body.user.id as number, token: res.body.token as string };
  };
  const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeEach(async () => {
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await prisma.file.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.message.deleteMany();
    await prisma.channelRead.deleteMany();
    await prisma.channelMember.deleteMany();
    await prisma.channel.deleteMany();
    await prisma.user.deleteMany();

    owner = await register('owner');
    member = await register('member');
    outsider = await register('outsider');
    const ch = await request(app).post('/channels').set(auth(owner)).send({ name: 'docs-team', isPrivate: true });
    channelId = ch.body.id;
    await request(app).post(`/channels/${channelId}/members`).set(auth(owner)).send({ userId: member.id });
  });

  afterAll(async () => {
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await prisma.folder.deleteMany();
  });

  it('extracts plain text from BlockNote blocks, including nested blocks, links and tables', () => {
    const text = blocksToText([
      { type: 'heading', content: [{ type: 'text', text: 'Møtereferat' }], children: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Se ' }, { type: 'link', href: 'https://x', content: [{ type: 'text', text: 'lenke' }] }],
        children: [para('Underpunkt')] },
      { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]] }] }, children: [] },
    ]);
    expect(text).toBe('Møtereferat\nSe lenke\nUnderpunkt\nA | B');
    expect(blocksToText([{ type: 'heading', props: { level: 2 }, content: 'Agenda' }])).toBe('Agenda');
  });

  it('creates folders and documents and lists them per folder', async () => {
    const folder = await request(app).post(`/channels/${channelId}/folders`).set(auth(member)).send({ name: 'Møter' });
    expect(folder.status).toBe(201);

    const doc = await request(app).post(`/channels/${channelId}/documents`).set(auth(member))
      .send({ title: 'Ukesmøte', folderId: folder.body.id, content: [para('Agenda')] });
    expect(doc.status).toBe(201);

    const root = await request(app).get(`/channels/${channelId}/library`).set(auth(owner));
    expect(root.body.folders.map((f: any) => f.name)).toEqual(['Møter']);
    expect(root.body.folders[0]._count.documents).toBe(1);
    expect(root.body.documents).toHaveLength(0);

    const inside = await request(app).get(`/channels/${channelId}/library`).query({ folderId: folder.body.id }).set(auth(owner));
    expect(inside.body.breadcrumb).toEqual([{ id: folder.body.id, name: 'Møter' }]);
    expect(inside.body.documents.map((d: any) => d.title)).toEqual(['Ukesmøte']);

    const stored = await prisma.document.findUnique({ where: { id: doc.body.id } });
    expect(stored?.contentText).toBe('Agenda');
  });

  it('hides everything from people outside the channel', async () => {
    const doc = await request(app).post(`/channels/${channelId}/documents`).set(auth(owner)).send({ title: 'Hemmelig' });

    expect((await request(app).get(`/channels/${channelId}/library`).set(auth(outsider))).status).toBe(404);
    expect((await request(app).get(`/documents/${doc.body.id}`).set(auth(outsider))).status).toBe(404);
    expect((await request(app).put(`/documents/${doc.body.id}`).set(auth(outsider)).send({ title: 'x' })).status).toBe(404);
    expect((await request(app).get(`/documents/${doc.body.id}/versions`).set(auth(outsider))).status).toBe(404);
    expect((await request(app).post(`/channels/${channelId}/folders`).set(auth(outsider)).send({ name: 'x' })).status).toBe(404);

    const all = await request(app).get('/documents').set(auth(outsider));
    expect(all.body).toEqual([]);
    const mine = await request(app).get('/documents').set(auth(member));
    expect(mine.body.map((d: any) => d.title)).toEqual(['Hemmelig']);
  });

  it('rejects duplicate folder names, moving a folder into itself and deleting non-empty folders', async () => {
    const a = await request(app).post(`/channels/${channelId}/folders`).set(auth(owner)).send({ name: 'Prosjekter' });
    expect((await request(app).post(`/channels/${channelId}/folders`).set(auth(owner)).send({ name: 'prosjekter' })).status).toBe(409);

    const b = await request(app).post(`/channels/${channelId}/folders`).set(auth(owner)).send({ name: 'Q4', parentId: a.body.id });
    expect((await request(app).patch(`/folders/${a.body.id}`).set(auth(owner)).send({ parentId: b.body.id })).status).toBe(400);

    expect((await request(app).delete(`/folders/${a.body.id}`).set(auth(owner))).status).toBe(409);
    expect((await request(app).delete(`/folders/${b.body.id}`).set(auth(owner))).status).toBe(200);
    expect((await request(app).delete(`/folders/${a.body.id}`).set(auth(owner))).status).toBe(200);
  });

  it('keeps one version per editing session and a new one when someone else edits', async () => {
    const doc = await request(app).post(`/channels/${channelId}/documents`).set(auth(owner)).send({ title: 'Brief' });
    await request(app).put(`/documents/${doc.body.id}`).set(auth(owner)).send({ content: [para('Utkast 1')] });
    await request(app).put(`/documents/${doc.body.id}`).set(auth(owner)).send({ content: [para('Utkast 2')] });
    let versions = await request(app).get(`/documents/${doc.body.id}/versions`).set(auth(owner));
    expect(versions.body).toHaveLength(1);

    await request(app).put(`/documents/${doc.body.id}`).set(auth(member)).send({ content: [para('Kommentar fra member')] });
    versions = await request(app).get(`/documents/${doc.body.id}/versions`).set(auth(owner));
    expect(versions.body).toHaveLength(2);
    expect(versions.body[0].author.id).toBe(member.id);

    // Restore the owner's version
    const ownerVersion = versions.body[1];
    const restored = await request(app).post(`/documents/${doc.body.id}/versions/${ownerVersion.id}/restore`).set(auth(member));
    expect(restored.status).toBe(200);
    const current = await request(app).get(`/documents/${doc.body.id}`).set(auth(owner));
    expect(current.body.content[0].content[0].text).toBe('Utkast 2');
    expect(current.body.updater.id).toBe(member.id);
  });

  it('moves documents to the trash and restores them', async () => {
    const doc = await request(app).post(`/channels/${channelId}/documents`).set(auth(owner)).send({ title: 'Gammel plan' });
    expect((await request(app).delete(`/documents/${doc.body.id}`).set(auth(member))).status).toBe(200);
    expect((await request(app).get(`/documents/${doc.body.id}`).set(auth(owner))).status).toBe(404);

    const trash = await request(app).get(`/channels/${channelId}/trash`).set(auth(owner));
    expect(trash.body.map((d: any) => d.title)).toEqual(['Gammel plan']);

    expect((await request(app).post(`/documents/${doc.body.id}/restore`).set(auth(owner))).status).toBe(200);
    expect((await request(app).get(`/documents/${doc.body.id}`).set(auth(owner))).status).toBe(200);
  });

  it('makes archived channels read-only', async () => {
    const doc = await request(app).post(`/channels/${channelId}/documents`).set(auth(owner)).send({ title: 'Arkiv' });
    await prisma.channel.update({ where: { id: channelId }, data: { archivedAt: new Date() } });

    const read = await request(app).get(`/documents/${doc.body.id}`).set(auth(owner));
    expect(read.status).toBe(200);
    expect(read.body.readOnly).toBe(true);
    expect((await request(app).put(`/documents/${doc.body.id}`).set(auth(owner)).send({ title: 'Ny' })).status).toBe(403);
  });

  it('uploads files into a folder and shares them with channel members only', async () => {
    const folder = await request(app).post(`/channels/${channelId}/folders`).set(auth(owner)).send({ name: 'Vedlegg' });
    const upload = await request(app).post('/files').set(auth(owner))
      .field('channelId', String(channelId)).field('folderId', String(folder.body.id))
      .attach('file', Buffer.from('notat'), { filename: 'notat.txt', contentType: 'text/plain' });
    expect(upload.status).toBe(201);

    const inside = await request(app).get(`/channels/${channelId}/library`).query({ folderId: folder.body.id }).set(auth(member));
    expect(inside.body.files.map((f: any) => f.originalName)).toEqual(['notat.txt']);

    expect((await request(app).get(`/files/${upload.body.id}`).set(auth(member))).status).toBe(200);
    expect((await request(app).get(`/files/${upload.body.id}`).set(auth(outsider))).status).toBe(404);

    const denied = await request(app).post('/files').set(auth(outsider))
      .field('channelId', String(channelId))
      .attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(denied.status).toBe(404);
  });
});
