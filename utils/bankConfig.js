/**
 * Business bank account details for manual / bank-transfer payments.
 * All payment instructions reference this account.
 */
const BANK_ACCOUNT = {
  bankName: 'UBA',
  accountNumber: '1027525073',
  accountName: 'UNITED TRADING INTEGRATED VENTURES ACC 1',
};

/**
 * Generate a short, human-readable reference for a bank transfer.
 * Format: BT-<TYPE>-<TIMESTAMP_BASE36>
 * e.g.  BT-RENT-M5X3KQ
 */
function generateBankTransferReference(type = 'PAY') {
  const tag = String(type).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `BT-${tag}-${suffix}`;
}

module.exports = { BANK_ACCOUNT, generateBankTransferReference };
