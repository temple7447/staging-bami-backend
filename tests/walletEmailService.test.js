/**
 * Wallet Email Service Tests
 *
 * Tests all 5 email-sending functions in walletEmailService.
 * The underlying emailService.sendEmail is mocked so no real email is sent
 * and tests stay fast and isolated.
 */

jest.mock('../utils/emailService', () => ({
  sendEmail: jest.fn()
}));

const { sendEmail } = require('../utils/emailService');
const {
  sendWalletCreatedEmail,
  sendDepositEmail,
  sendWithdrawalEmail,
  sendTransactionNotificationEmail,
  sendWalletPayoutEmail
} = require('../utils/walletEmailService');

// ─── fixtures ────────────────────────────────────────────────────────────────

const mockUser = { name: 'Adewale Bami', email: 'adewale@test.com', role: 'manager' };

const mockTransaction = {
  _id: 'txn_001',
  reference: 'REF-2024-001',
  status: 'completed',
  newBalance: 95_000
};

beforeEach(() => {
  sendEmail.mockReset();
});

// ─── Suite 1: sendWalletCreatedEmail ─────────────────────────────────────────

describe('sendWalletCreatedEmail', () => {

  test('S01: returns true when sendEmail resolves', async () => {
    sendEmail.mockResolvedValueOnce(true);
    const result = await sendWalletCreatedEmail(mockUser);
    expect(result).toBe(true);
  });

  test('S02: returns false when sendEmail rejects', async () => {
    sendEmail.mockRejectedValueOnce(new Error('SMTP error'));
    const result = await sendWalletCreatedEmail(mockUser);
    expect(result).toBe(false);
  });

  test('S03: calls sendEmail with the correct recipient address', async () => {
    sendEmail.mockResolvedValueOnce(true);
    await sendWalletCreatedEmail(mockUser);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].email).toBe(mockUser.email);
  });

  test('S04: email subject mentions wallet creation', async () => {
    sendEmail.mockResolvedValueOnce(true);
    await sendWalletCreatedEmail(mockUser);
    const subject = sendEmail.mock.calls[0][0].subject;
    expect(subject.toLowerCase()).toMatch(/wallet/i);
  });

});

// ─── Suite 2: sendDepositEmail ───────────────────────────────────────────────

describe('sendDepositEmail', () => {

  test('S05: returns true when sendEmail resolves', async () => {
    sendEmail.mockResolvedValueOnce(true);
    const result = await sendDepositEmail(mockUser, 50_000, mockTransaction);
    expect(result).toBe(true);
  });

  test('S06: returns false when sendEmail rejects', async () => {
    sendEmail.mockRejectedValueOnce(new Error('timeout'));
    const result = await sendDepositEmail(mockUser, 50_000, mockTransaction);
    expect(result).toBe(false);
  });

  test('S07: calls sendEmail once with correct email', async () => {
    sendEmail.mockResolvedValueOnce(true);
    await sendDepositEmail(mockUser, 30_000, mockTransaction);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].email).toBe(mockUser.email);
  });

  test('S08: does not throw when transaction has no newBalance field', async () => {
    sendEmail.mockResolvedValueOnce(true);
    const txnNoBalance = { _id: 'txn_002', reference: 'REF-002' };
    await expect(sendDepositEmail(mockUser, 10_000, txnNoBalance)).resolves.toBe(true);
  });

});

// ─── Suite 3: sendWithdrawalEmail ────────────────────────────────────────────

describe('sendWithdrawalEmail', () => {

  test('S09: returns true without bank details', async () => {
    sendEmail.mockResolvedValueOnce(true);
    const result = await sendWithdrawalEmail(mockUser, 20_000, mockTransaction);
    expect(result).toBe(true);
  });

  test('S10: returns true with bank details provided', async () => {
    sendEmail.mockResolvedValueOnce(true);
    const bankDetails = { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'A. Bami' };
    const result = await sendWithdrawalEmail(mockUser, 20_000, mockTransaction, bankDetails);
    expect(result).toBe(true);
  });

  test('S11: returns false when sendEmail rejects', async () => {
    sendEmail.mockRejectedValueOnce(new Error('network error'));
    const result = await sendWithdrawalEmail(mockUser, 15_000, mockTransaction);
    expect(result).toBe(false);
  });

  test('S12: email subject mentions withdrawal', async () => {
    sendEmail.mockResolvedValueOnce(true);
    await sendWithdrawalEmail(mockUser, 20_000, mockTransaction);
    const subject = sendEmail.mock.calls[0][0].subject;
    expect(subject.toLowerCase()).toMatch(/withdrawal/i);
  });

});

// ─── Suite 4: sendTransactionNotificationEmail ───────────────────────────────

describe('sendTransactionNotificationEmail', () => {

  test('S13: returns true for a credit transaction type', async () => {
    sendEmail.mockResolvedValueOnce(true);
    const result = await sendTransactionNotificationEmail(mockUser, mockTransaction, 'deposit', 5_000);
    expect(result).toBe(true);
  });

  test('S14: returns true for a debit transaction type', async () => {
    sendEmail.mockResolvedValueOnce(true);
    const result = await sendTransactionNotificationEmail(mockUser, mockTransaction, 'payment', 3_000);
    expect(result).toBe(true);
  });

  test('S15: returns false when sendEmail rejects', async () => {
    sendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    const result = await sendTransactionNotificationEmail(mockUser, mockTransaction, 'refund', 1_000);
    expect(result).toBe(false);
  });

  test('S16: accepts optional description without throwing', async () => {
    sendEmail.mockResolvedValueOnce(true);
    await expect(
      sendTransactionNotificationEmail(mockUser, mockTransaction, 'credit', 2_500, 'Rent received')
    ).resolves.toBe(true);
  });

});

// ─── Suite 5: sendWalletPayoutEmail ──────────────────────────────────────────

describe('sendWalletPayoutEmail', () => {

  test('S17: returns true for payout type', async () => {
    sendEmail.mockResolvedValueOnce(true);
    const result = await sendWalletPayoutEmail(mockUser, 20_000, 'Green Estate', 'payout');
    expect(result).toBe(true);
  });

  test('S18: returns true for payment type', async () => {
    sendEmail.mockResolvedValueOnce(true);
    const result = await sendWalletPayoutEmail(mockUser, 20_000, 'Green Estate', 'payment');
    expect(result).toBe(true);
  });

  test('S19: returns false when sendEmail rejects', async () => {
    sendEmail.mockRejectedValueOnce(new Error('auth error'));
    const result = await sendWalletPayoutEmail(mockUser, 20_000, 'Green Estate');
    expect(result).toBe(false);
  });

  test('S20: works when estateName is undefined', async () => {
    sendEmail.mockResolvedValueOnce(true);
    await expect(sendWalletPayoutEmail(mockUser, 5_000, undefined)).resolves.toBe(true);
  });

  test('S21: calls sendEmail exactly once per invocation', async () => {
    sendEmail.mockResolvedValueOnce(true);
    await sendWalletPayoutEmail(mockUser, 10_000, 'Sunrise Court');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

});
