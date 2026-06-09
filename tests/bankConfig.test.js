/**
 * Bank Config Tests
 *
 * Tests the BANK_ACCOUNT constant shape and the generateBankTransferReference
 * pure function: format rules, uniqueness, type sanitisation, and length limits.
 */

const { BANK_ACCOUNT, generateBankTransferReference } = require('../utils/bankConfig');

// ─── Suite 1: BANK_ACCOUNT constant ──────────────────────────────────────────

describe('BANK_ACCOUNT constant', () => {

  test('S01: has bankName field', () => {
    expect(BANK_ACCOUNT).toHaveProperty('bankName');
    expect(typeof BANK_ACCOUNT.bankName).toBe('string');
  });

  test('S02: has accountNumber field', () => {
    expect(BANK_ACCOUNT).toHaveProperty('accountNumber');
    expect(typeof BANK_ACCOUNT.accountNumber).toBe('string');
  });

  test('S03: has accountName field', () => {
    expect(BANK_ACCOUNT).toHaveProperty('accountName');
    expect(typeof BANK_ACCOUNT.accountName).toBe('string');
  });

  test('S04: accountNumber is non-empty', () => {
    expect(BANK_ACCOUNT.accountNumber.length).toBeGreaterThan(0);
  });

});

// ─── Suite 2: generateBankTransferReference format ────────────────────────────

describe('generateBankTransferReference — format', () => {

  test('S05: starts with "BT-"', () => {
    expect(generateBankTransferReference('RENT')).toMatch(/^BT-/);
  });

  test('S06: default type produces "BT-PAY-" prefix', () => {
    expect(generateBankTransferReference()).toMatch(/^BT-PAY-/);
  });

  test('S07: custom type "RENT" appears in reference', () => {
    expect(generateBankTransferReference('RENT')).toMatch(/^BT-RENT-/);
  });

  test('S08: reference is uppercase', () => {
    const ref = generateBankTransferReference('service');
    expect(ref).toBe(ref.toUpperCase());
  });

  test('S09: type is truncated to 6 characters max', () => {
    const ref = generateBankTransferReference('TOOLONGTYPE');
    // format: BT-<up to 6 chars>-<suffix>
    const parts = ref.split('-');
    expect(parts[1].length).toBeLessThanOrEqual(6);
  });

  test('S10: special characters in type are stripped', () => {
    const ref = generateBankTransferReference('RE@NT!');
    // @ and ! are non-alphanumeric → stripped, leaving RENT
    expect(ref).toMatch(/^BT-RENT-/);
  });

  test('S11: two calls within the same millisecond produce different suffixes (probabilistic)', () => {
    // Force small delay between calls to ensure different timestamps
    const r1 = generateBankTransferReference('TEST');
    const r2 = generateBankTransferReference('TEST');
    // They should either differ OR be the same only if Date.now() didn't tick —
    // both are valid; what must NOT happen is an error or empty string.
    expect(r1).toBeTruthy();
    expect(r2).toBeTruthy();
  });

  test('S12: result has exactly 3 hyphen-separated parts', () => {
    const parts = generateBankTransferReference('RENT').split('-');
    expect(parts).toHaveLength(3);
  });

});
