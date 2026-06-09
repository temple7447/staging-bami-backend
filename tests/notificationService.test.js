/**
 * Notification Service Tests
 *
 * 10 scenarios for createNotification:
 *   - Guard clauses (missing required fields)
 *   - Happy path: correct arguments passed to Notification.create
 *   - Default values for type and metadata
 *   - Error resilience: returns null instead of throwing on DB failure
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../models/Notification', () => ({
  create: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logError: jest.fn().mockReturnValue({}),
  logInfo:  jest.fn(),
  logWarning: jest.fn(),
}));

// ─── Load module under test ───────────────────────────────────────────────────

const Notification = require('../models/Notification');
const { createNotification } = require('../utils/notificationService');

// ─── Suite: createNotification ───────────────────────────────────────────────

describe('createNotification', () => {

  test('S01: returns null when user is missing', async () => {
    const result = await createNotification({ title: 'Hello', message: 'World' });
    expect(result).toBeNull();
    expect(Notification.create).not.toHaveBeenCalled();
  });

  test('S02: returns null when title is missing', async () => {
    const result = await createNotification({ user: 'uid', message: 'World' });
    expect(result).toBeNull();
    expect(Notification.create).not.toHaveBeenCalled();
  });

  test('S03: returns null when message is missing', async () => {
    const result = await createNotification({ user: 'uid', title: 'Hello' });
    expect(result).toBeNull();
    expect(Notification.create).not.toHaveBeenCalled();
  });

  test('S04: calls Notification.create with user, title, message, isActive: true', async () => {
    const mockNotif = { _id: 'nid', user: 'uid', title: 'T', message: 'M' };
    Notification.create.mockResolvedValue(mockNotif);
    await createNotification({ user: 'uid', title: 'T', message: 'M' });
    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'uid', title: 'T', message: 'M', isActive: true })
    );
  });

  test('S05: uses "system" as default type when type is not provided', async () => {
    Notification.create.mockResolvedValue({ _id: 'nid' });
    await createNotification({ user: 'uid', title: 'T', message: 'M' });
    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'system' })
    );
  });

  test('S06: uses empty object {} as default metadata when metadata is not provided', async () => {
    Notification.create.mockResolvedValue({ _id: 'nid' });
    await createNotification({ user: 'uid', title: 'T', message: 'M' });
    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} })
    );
  });

  test('S07: returns the created notification document', async () => {
    const mockNotif = { _id: 'nid', title: 'Pay now', message: 'Rent due' };
    Notification.create.mockResolvedValue(mockNotif);
    const result = await createNotification({ user: 'uid', title: 'Pay now', message: 'Rent due' });
    expect(result).toBe(mockNotif);
  });

  test('S08: accepts a custom type and passes it to Notification.create', async () => {
    Notification.create.mockResolvedValue({ _id: 'nid' });
    await createNotification({ user: 'uid', title: 'T', message: 'M', type: 'payment' });
    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment' })
    );
  });

  test('S09: passes metadata object to Notification.create', async () => {
    const meta = { paymentId: 'pid', amount: 50000 };
    Notification.create.mockResolvedValue({ _id: 'nid' });
    await createNotification({ user: 'uid', title: 'T', message: 'M', metadata: meta });
    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: meta })
    );
  });

  test('S10: returns null (does not throw) when Notification.create rejects', async () => {
    Notification.create.mockRejectedValue(new Error('DB connection lost'));
    await expect(
      createNotification({ user: 'uid', title: 'T', message: 'M' })
    ).resolves.toBeNull();
  });

});
