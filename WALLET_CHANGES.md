# Wallet System Changes - GBP Currency Update

## Summary
Created a complete wallet system with GBP (British Pounds) as the default currency.

## Files Created

### 1. Models
- **`models/Wallet.js`** - Wallet schema with GBP as default currency
  - `userId` - Reference to User
  - `balance` - Current wallet balance
  - `currency` - Default: 'GBP' (supports GBP, USD, EUR)
  - `totalEarnings` - Total funds added
  - `totalSpent` - Total funds deducted
  - `transactions` - Array of transaction references
  - `lastUpdated` - Last update timestamp

### 2. Controllers
- **`controllers/walletController.js`** - Wallet operations
  - `getWallet()` - Fetch user's wallet (includes £ symbol)
  - `createWallet()` - Create new wallet (default GBP)
  - `addFunds()` - Add funds to wallet
  - `deductFunds()` - Deduct funds (with validation)
  - `updateCurrency()` - Change wallet currency

### 3. Routes
- **`routes/wallet.js`** - Wallet API endpoints
  - `GET /api/wallet` - Get wallet balance
  - `POST /api/wallet` - Create wallet
  - `POST /api/wallet/add-funds` - Add funds
  - `POST /api/wallet/deduct-funds` - Deduct funds
  - `PUT /api/wallet/currency` - Update currency

### 4. Migration Script
- **`scripts/migrateCurrencyToGBP.js`** - Migrate existing wallets from USD to GBP

## Files Modified

### `server.js`
- Added wallet route: `app.use('/api/wallet', require('./routes/wallet'))`
- Updated API documentation with wallet endpoints

## Running the Migration

To update all existing wallet documents from USD to GBP:

```bash
node scripts/migrateCurrencyToGBP.js
```

Output will show:
- Number of documents matched
- Number of documents modified
- Confirmation of currency update

## API Endpoints

### Get Wallet
```
GET /api/wallet
Headers: Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "_id": "...",
    "userId": "...",
    "balance": 0,
    "currency": "GBP",
    "currencySymbol": "£",
    "totalEarnings": 0,
    "totalSpent": 0,
    "transactions": [],
    "lastUpdated": "2025-11-09T12:30:10.538Z",
    "createdAt": "2025-11-09T12:30:10.543Z",
    "updatedAt": "2025-11-09T12:30:10.543Z"
  }
}
```

### Create Wallet
```
POST /api/wallet
Headers: Authorization: Bearer {token}
Body: {
  "userId": "user_id",
  "currency": "GBP"  // optional, defaults to GBP
}
```

### Add Funds
```
POST /api/wallet/add-funds
Headers: Authorization: Bearer {token}
Body: {
  "amount": 50.00
}
```

### Deduct Funds
```
POST /api/wallet/deduct-funds
Headers: Authorization: Bearer {token}
Body: {
  "amount": 25.00
}
```

```

## Currency Support

The wallet system supports three currencies:
- **GBP** (£) - Default and primary
- **USD** ($)
- **EUR** (€)

## Next Steps

1. Run the migration script to convert existing USD wallets to GBP
2. Test all wallet endpoints
3. Update frontend to use the new wallet API
4. Ensure currency display shows £ for GBP amounts
