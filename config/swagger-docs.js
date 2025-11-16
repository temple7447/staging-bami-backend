/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Authentication endpoints
 *   - name: Estates
 *     description: Estate management
 *   - name: Units
 *     description: Unit management
 *   - name: Tenants
 *     description: Tenant management
 *   - name: Payments
 *     description: Payment processing
 *   - name: Wallet
 *     description: Wallet management (user wallet)
 *   - name: Distribution
 *     description: Wallet and account distribution (estate wallet)
 *   - name: Upload
 *     description: Image and video upload to Cloudinary
 *
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 *
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful, returns JWT token
 *       401:
 *         description: Invalid credentials
 *
 * /api/estates/{estateId}/units:
 *   post:
 *     summary: Create a new unit
 *     tags: [Units]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - label
 *               - monthlyPrice
 *             properties:
 *               label:
 *                 type: string
 *                 example: "Unit 1"
 *               monthlyPrice:
 *                 type: number
 *                 example: 40000
 *               serviceChargeMonthly:
 *                 type: number
 *                 example: 5000
 *                 description: Service charge per month for this unit
 *               cautionFee:
 *                 type: number
 *                 example: 50000
 *                 description: One-time caution fee for a new tenant in this unit
 *               legalFee:
 *                 type: number
 *                 example: 30000
 *                 description: One-time legal fee for a new tenant in this unit
 *               meterNumber:
 *                 type: string
 *               description:
 *                 type: string
 *               features:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       201:
 *         description: Unit created successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Estate not found
 *
 *   get:
 *     summary: Get all units for an estate
 *     tags: [Units]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [vacant, occupied, maintenance, reserved]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: List of units with pagination
 *       404:
 *         description: Estate not found
 *
 * /api/estates/{estateId}/units/vacant:
 *   get:
 *     summary: Get vacant units for tenant assignment
 *     tags: [Units]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of vacant and reserved units
 *       404:
 *         description: Estate not found
 *
 * /api/estates/{estateId}/tenants:
 *   post:
 *     summary: Create a new tenant and assign to unit
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - unitId
 *               - tenantName
 *             properties:
 *               unitId:
 *                 type: string
 *                 description: ID of the vacant unit
 *               tenantName:
 *                 type: string
 *               tenantEmail:
 *                 type: string
 *               tenantPhone:
 *                 type: string
 *               tenantType:
 *                 type: string
 *                 enum: [new, existing, renewal, transfer]
 *               entryDate:
 *                 type: string
 *                 format: date
 *                 description: Date tenant moved in (optional; defaults to today)
 *               durationMonths:
 *                 type: integer
 *                 example: 12
 *                 description: Number of months from entryDate to calculate nextDueDate automatically
 *               nextDueDate:
 *                 type: string
 *                 format: date
 *                 description: Next rent due date (optional; if durationMonths is provided, this is ignored)
 *     responses:
 *       201:
 *         description: Tenant created and assigned to unit
 *       400:
 *         description: Unit already occupied or validation error
 *       404:
 *         description: Unit or estate not found
 *
 *   get:
 *     summary: Get all tenants for an estate
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of tenants with pagination
 *
 * /api/tenants/{id}:
 *   get:
 *     summary: Get tenant details with history and transactions
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: expand
 *         schema:
 *           type: string
 *           enum: [history, transactions, "history,transactions"]
 *     responses:
 *       200:
 *         description: Tenant details with optional history and transactions
 *       404:
 *         description: Tenant not found
 *
 *   put:
 *     summary: Update tenant information
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Tenant updated successfully
 *       404:
 *         description: Tenant not found
 *
 * /api/tenants/{id}/billing:
 *   get:
 *     summary: Get billing items for a tenant (what they should pay for)
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of billing items the tenant should pay for
 *       404:
 *         description: Tenant not found
 *
 * /api/payments/rent:
 *   post:
 *     summary: Initiate rent payment via Paystack
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tenantId
 *             properties:
 *               tenantId:
 *                 type: string
 *               amount:
 *                 type: number
 *                 description: Optional when durationMonths or duration is provided; otherwise required
 *               durationMonths:
 *                 type: integer
 *                 description: Number of months of rent to charge (e.g. 6, 12, 24)
 *               duration:
 *                 type: string
 *                 enum: ["6_months", "1_year", "2_years"]
 *                 description: Preset duration for convenience; maps to durationMonths internally
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Payment initiated, returns Paystack payment link
 *       400:
 *         description: Invalid amount or tenant not found
 *
 * /api/payments/deposit:
 *   post:
 *     summary: Initiate deposit payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tenantId
 *               - amount
 *             properties:
 *               tenantId:
 *                 type: string
 *               amount:
 *                 type: number
 *     responses:
 *       201:
 *         description: Deposit payment initiated
 *
 * /api/payments/verify/{reference}:
 *   get:
 *     summary: Verify payment status with Paystack
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment verification result
 *       404:
 *         description: Payment not found
 *
 * /api/estates/{estateId}/wallet/balance:
 *   get:
 *     summary: Get wallet account balances (Marketing 50%, Owner 30%, Operations 20%)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Current balance for all three accounts
 *       500:
 *         description: Server error
 *
 * /api/estates/{estateId}/wallet/history:
 *   get:
 *     summary: Get distribution transaction history
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Distribution history for all three accounts
 *
 * /api/estates/{estateId}/wallet/marketing:
 *   get:
 *     summary: Get marketing account details (50%)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Marketing account balance and statistics
 *
 * /api/estates/{estateId}/wallet/owner:
 *   get:
 *     summary: Get owner account details (30%)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Owner account balance and statistics
 *
 * /api/estates/{estateId}/wallet/operations:
 *   get:
 *     summary: Get operations account details (20%)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path\n *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Operations account balance and statistics
 *
 * /api/estates/{estateId}/wallet/withdraw:
 *   post:
 *     summary: Withdraw funds from owner account
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: estateId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Withdrawal processed successfully
 *       400:
 *         description: Insufficient balance
 *
 * /api/auth/register-super-admin:
 *   post:
 *     summary: Register a new super admin
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Super admin registered successfully
 *       400:
 *         description: Validation error
 *
 * /api/auth/logout:
 *   get:
 *     summary: Logout current user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *
 * /api/auth/me:
 *   get:
 *     summary: Get current user details
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user details
 *       401:
 *         description: Unauthorized
 *
 * /api/auth/updatedetails:
 *   put:
 *     summary: Update current user details
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: User details updated
 *
 * /api/auth/updatepassword:
 *   put:
 *     summary: Update user password
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       401:
 *         description: Current password is incorrect
 *
 * /api/auth/forgotpassword:
 *   post:
 *     summary: Request password reset via email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset email sent
 *       404:
 *         description: User not found
 *
 * /api/auth/forgotpassword-otp:
 *   post:
 *     summary: Request OTP for password reset
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent to email
 *
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify OTP for password reset
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *       400:
 *         description: Invalid OTP
 *
 * /api/auth/resetpassword-otp:
 *   post:
 *     summary: Reset password using OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *               - newPassword
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successfully
 *
 * /api/auth/create-admin:
 *   post:
 *     summary: Create a new admin (Super Admin only)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Admin created successfully
 *       403:
 *         description: Not authorized (Super Admin only)
 *
 * /api/auth/admins:
 *   get:
 *     summary: Get all admins (Super Admin only)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all admins
 *       403:
 *         description: Not authorized
 *
 * /api/auth/admin/{id}/status:
 *   put:
 *     summary: Update admin status (Super Admin only)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Admin status updated
 *
 * /api/auth/admin/{id}:
 *   delete:
 *     summary: Delete admin (Super Admin only)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admin deleted successfully
 *       403:
 *         description: Not authorized
 *
 * /api/wallet:
 *   get:
 *     summary: Get current user's wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet details
 *       404:
 *         description: Wallet not found
 *
 *   post:
 *     summary: Create a new wallet for user
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Wallet created successfully
 *
 * /api/wallet/add-funds:
 *   post:
 *     summary: Add funds to wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *     responses:
 *       200:
 *         description: Funds added successfully
 *
 * /api/wallet/deduct-funds:
 *   post:
 *     summary: Deduct funds from wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *     responses:
 *       200:
 *         description: Funds deducted successfully
 *       400:
 *         description: Insufficient wallet balance
 *
 * /api/upload/image:
 *   post:
 *     summary: Upload image to Cloudinary
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Image file (JPEG, PNG, GIF, WebP, SVG) - max 10MB
 *     responses:
 *       201:
 *         description: Image uploaded successfully
 *       400:
 *         description: Invalid file type or size too large
 *
 * /api/upload/video:
 *   post:
 *     summary: Upload video to Cloudinary
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Video file (MP4, WebM, MOV, AVI, MKV, 3GP) - max 200MB
 *     responses:
 *       201:
 *         description: Video uploaded successfully
 *       400:
 *         description: Invalid file type or size too large
 */

module.exports = {};
