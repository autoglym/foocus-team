import { TEST_PASSWORD } from './test-constants.js';
import request from 'supertest';
import app from '../app.js';
import prisma from '../db.js';

describe('Channels', () => {
  let authToken: string;
  let userId: number;

  const testUser = {
    email: 'channel-test@example.com',
    password: TEST_PASSWORD,
    name: 'Channel Test User',
  };

  beforeEach(async () => {
    await prisma.message.deleteMany();
    await prisma.channelRead.deleteMany();
    await prisma.channelMember.deleteMany();
    await prisma.channel.deleteMany();
    await prisma.user.deleteMany();

    const res = await request(app).post('/auth/register').send(testUser);
    authToken = res.body.token;
    userId = res.body.user.id;
  });

  describe('POST /channels', () => {
    it('should create a new channel', async () => {
      const res = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'test-new-channel' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('test-new-channel');
      expect(res.body.isPrivate).toBe(false);
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].user.id).toBe(userId);
    });

    it('should create a private channel', async () => {
      const res = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'private-channel', isPrivate: true });

      expect(res.status).toBe(201);
      expect(res.body.isPrivate).toBe(true);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/channels')
        .send({ name: 'general' });

      expect(res.status).toBe(401);
    });

    it('should validate channel name', async () => {
      const res = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('should reject channel names longer than 25 characters', async () => {
      const res = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'this-channel-name-is-way-too-long' });

      expect(res.status).toBe(400);
    });

    it('should accept channel names of exactly 25 characters', async () => {
      const name = 'a'.repeat(25);
      const res = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe(name);
    });
  });

  describe('PATCH /channels/:id (topic and description)', () => {
    it('should accept topic and description on create', async () => {
      const res = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'with-topic', topic: 'Q4-lansering', description: 'Alt om lanseringen i Q4' });

      expect(res.status).toBe(201);
      expect(res.body.topic).toBe('Q4-lansering');
      expect(res.body.description).toBe('Alt om lanseringen i Q4');
    });

    it('should let a member update the topic and clear the description', async () => {
      const created = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'edit-topic', description: 'Old' });

      const res = await request(app)
        .patch(`/channels/${created.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ topic: '  Nytt emne  ', description: '' });

      expect(res.status).toBe(200);
      expect(res.body.topic).toBe('Nytt emne');
      expect(res.body.description).toBeNull();

      const detail = await request(app)
        .get(`/channels/${created.body.id}`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(detail.body.topic).toBe('Nytt emne');
    });

    it('should reject non-members', async () => {
      const created = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'members-only' });

      const other = await request(app).post('/auth/register').send({
        email: 'channel-other@example.com', password: TEST_PASSWORD, name: 'Other',
      });

      const res = await request(app)
        .patch(`/channels/${created.body.id}`)
        .set('Authorization', `Bearer ${other.body.token}`)
        .send({ topic: 'Hijack' });

      expect(res.status).toBe(403);
    });

    it('should reject a topic longer than 250 characters', async () => {
      const created = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'long-topic' });

      const res = await request(app)
        .patch(`/channels/${created.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ topic: 'x'.repeat(251) });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /channels/group-dm', () => {
    const register = async (n: number) => {
      const res = await request(app).post('/auth/register').send({
        email: `gdm-${n}@example.com`, password: TEST_PASSWORD, name: `Group User ${n}`,
      });
      return { id: res.body.user.id as number, token: res.body.token as string };
    };

    it('should create a private group DM with all participants', async () => {
      const [a, b] = [await register(1), await register(2)];

      const res = await request(app)
        .post('/channels/group-dm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userIds: [a.id, b.id] });

      expect(res.status).toBe(201);
      const channel = await prisma.channel.findUnique({
        where: { id: res.body.id },
        include: { members: true },
      });
      expect(channel?.isGroupDM).toBe(true);
      expect(channel?.isPrivate).toBe(true);
      expect(channel?.members.map((m) => m.userId).sort()).toEqual([userId, a.id, b.id].sort());

      const list = await request(app).get('/channels').set('Authorization', `Bearer ${a.token}`);
      const gdm = list.body.find((c: any) => c.id === res.body.id);
      expect(gdm.isGroupDM).toBe(true);
      expect(gdm.participants.map((p: any) => p.id).sort()).toEqual([userId, a.id, b.id].sort());
    });

    it('should reuse the group DM for the same set of people', async () => {
      const [a, b] = [await register(3), await register(4)];
      const first = await request(app)
        .post('/channels/group-dm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userIds: [a.id, b.id] });
      const second = await request(app)
        .post('/channels/group-dm')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ userIds: [b.id, userId] });

      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
    });

    it('should require at least two other people', async () => {
      const a = await register(5);
      const res = await request(app)
        .post('/channels/group-dm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userIds: [a.id, userId] });

      expect(res.status).toBe(400);
    });

    it('should hide the group DM from people outside it', async () => {
      const [a, b, outsider] = [await register(6), await register(7), await register(8)];
      const res = await request(app)
        .post('/channels/group-dm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userIds: [a.id, b.id] });

      const list = await request(app).get('/channels').set('Authorization', `Bearer ${outsider.token}`);
      expect(list.body.find((c: any) => c.id === res.body.id)).toBeUndefined();

      const messages = await request(app)
        .get(`/channels/${res.body.id}/messages`)
        .set('Authorization', `Bearer ${outsider.token}`);
      expect(messages.status).toBe(403);
    });
  });

  describe('GET /channels', () => {
    beforeEach(async () => {
      await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'general' });

      await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'random' });
    });

    it('should list all channels', async () => {
      const res = await request(app)
        .get('/channels')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/channels');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /channels/:id/join', () => {
    let channelId: number;

    beforeEach(async () => {
      // Create another user and channel
      const user2Res = await request(app).post('/auth/register').send({
        email: 'user2@example.com',
        password: TEST_PASSWORD,
        name: 'User 2',
      });

      const channelRes = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${user2Res.body.token}`)
        .send({ name: 'other-channel' });

      channelId = channelRes.body.id;
    });

    it('should join a channel', async () => {
      const res = await request(app)
        .post(`/channels/${channelId}/join`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Joined channel successfully');
    });

    it('should not join a channel twice', async () => {
      await request(app)
        .post(`/channels/${channelId}/join`)
        .set('Authorization', `Bearer ${authToken}`);

      const res = await request(app)
        .post(`/channels/${channelId}/join`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Already a member of this channel');
    });

    it('should return 404 for non-existent channel', async () => {
      const res = await request(app)
        .post('/channels/99999/join')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /channels/:id - non-member sanitization', () => {
    let channelId: number;
    let nonMemberToken: string;

    beforeEach(async () => {
      // User 1 (authToken) creates a public channel — becomes OWNER
      const channelRes = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'public-inspect' });
      channelId = channelRes.body.id;

      // User 2 is a non-member
      const user2Res = await request(app).post('/auth/register').send({
        email: 'nonmember@example.com',
        password: 'password123',
        name: 'Non Member',
      });
      nonMemberToken = user2Res.body.token;
    });

    it('should NOT leak role or joinedAt to non-members of public channels', async () => {
      // Non-member views the public channel
      const res = await request(app)
        .get(`/channels/${channelId}`)
        .set('Authorization', `Bearer ${nonMemberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.members.length).toBeGreaterThan(0);

      for (const member of res.body.members) {
        // Should only contain a sanitized user object
        expect(member).toHaveProperty('user');
        expect(member.user).toHaveProperty('id');
        expect(member.user).toHaveProperty('name');

        // Must NOT leak ChannelMember internal fields
        expect(member).not.toHaveProperty('role');
        expect(member).not.toHaveProperty('joinedAt');
        expect(member).not.toHaveProperty('userId');
        expect(member).not.toHaveProperty('channelId');

        // Must NOT leak avatar (the original sanitization intent)
        expect(member.user).not.toHaveProperty('avatar');
      }
    });

    it('should return full member details to actual members', async () => {
      // Member views the same channel
      const res = await request(app)
        .get(`/channels/${channelId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.members.length).toBeGreaterThan(0);

      // Members should see full details including role and avatar
      const ownerMember = res.body.members[0];
      expect(ownerMember).toHaveProperty('role');
      expect(ownerMember).toHaveProperty('joinedAt');
      expect(ownerMember.user).toHaveProperty('avatar');
    });
  });

  describe('GET /channels/:id/members', () => {
    let channelId: number;

    beforeEach(async () => {
      const channelRes = await request(app)
        .post('/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'test-channel' });

      channelId = channelRes.body.id;
    });

    it('should list channel members', async () => {
      const res = await request(app)
        .get(`/channels/${channelId}/members`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].user.name).toBe(testUser.name);
    });
  });
});
