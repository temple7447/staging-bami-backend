# BamiHost Backend API

A robust Express.js backend application with JWT authentication, role-based access control, email functionality, and admin management system.

## Features

- 🔐 **JWT Authentication** - Secure token-based authentication
- 👑 **Role-Based Access Control** - Super Admin and Admin roles
- 📧 **Email Integration** - Nodemailer with Gmail SMTP
- 🔒 **Security** - Helmet, Rate limiting, CORS protection
- ✅ **Input Validation** - Express-validator for request validation
- 📊 **Error Handling** - Centralized error handling middleware
- 🗄️ **MongoDB Integration** - Mongoose ODM for database operations
- 🚀 **Production Ready** - Compression, logging, and proper error handling

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB with Mongoose
- **Authentication:** JWT (JSON Web Tokens)
- **Email:** Nodemailer (Gmail SMTP)
- **Validation:** Express-validator
- **Security:** Helmet, CORS, Rate limiting
- **Password Hashing:** bcryptjs

## Prerequisites

- Node.js (v14 or higher)
- MongoDB database
- Gmail account with App Password for email functionality

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd BamiHost-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Copy the `.env` file and update the values as needed:
   ```bash
   cp .env .env.local
   ```

4. **Install dependencies:**
   ```bash
   npm install
   ```

5. **Start the development server:**
   ```bash
   npm run dev
   ```

6. **For production:**
   ```bash
   npm start
   ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment | `development` |
| `MONGODB_URI` | MongoDB connection string | Required |
| `JWT_SECRET` | JWT signing secret | Required |
| `JWT_EXPIRE` | JWT expiration time | `30d` |
| `EMAIL_FROM` | Sender email address | Required |
| `EMAIL_USER` | SMTP username | Required |
| `EMAIL_PASSWORD` | SMTP password/app password | Required |
| `EMAIL_SERVICE` | Email service provider | `gmail` |
| `EMAIL_PORT` | SMTP port | `587` |
| `BCRYPT_SALT_ROUNDS` | Password hashing rounds | `12` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `900000` (15min) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `100` |

## API Endpoints

### Authentication

#### Register Super Admin
```http
POST /api/auth/register-super-admin
```

**Body:**
```json
{
  "name": "Super Administrator",
  "email": "admin@example.com",
  "password": "SecurePassword123"
}
```

**Note:** This endpoint is only available if no super admin exists.

#### Login
```http
POST /api/auth/login
```

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### Get Current User
```http
GET /api/auth/me
Authorization: Bearer <token>
```

#### Update Profile
```http
PUT /api/auth/updatedetails
Authorization: Bearer <token>
```

**Body:**
```json
{
  "name": "Updated Name",
  "email": "newemail@example.com"
}
```

#### Change Password
```http
PUT /api/auth/updatepassword
Authorization: Bearer <token>
```

**Body:**
```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123"
}
```

#### Forgot Password
```http
POST /api/auth/forgotpassword
```

**Body:**
```json
{
  "email": "user@example.com"
}
```

#### Reset Password
```http
PUT /api/auth/resetpassword/:resettoken
```

**Body:**
```json
{
  "password": "newpassword123"
}
```

#### Logout
```http
GET /api/auth/logout
Authorization: Bearer <token>
```

### Admin Management (Super Admin Only)

#### Create Admin
```http
POST /api/auth/create-admin
Authorization: Bearer <token>
```

**Body:**
```json
{
  "name": "Admin User",
  "email": "admin@example.com",
  "password": "optional-password",
  "sendCredentials": true
}
```

#### Get All Admins
```http
GET /api/auth/admins
Authorization: Bearer <token>
```

#### Update Admin Status
```http
PUT /api/auth/admin/:id/status
Authorization: Bearer <token>
```

**Body:**
```json
{
  "isActive": true
}
```

#### Delete Admin
```http
DELETE /api/auth/admin/:id
Authorization: Bearer <token>
```

### Utility Endpoints

#### Health Check
```http
GET /health
```

#### API Information
```http
GET /
```

## Response Format

All API responses follow this structure:

**Success Response:**
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... },
  "token": "jwt-token-here" // for auth endpoints
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "Error description",
  "errors": [ ... ] // for validation errors
}
```

## User Roles

### Super Admin
- Can create, read, update, and delete admin users
- Can manage all system settings
- Cannot be deleted or deactivated by other users

### Admin
- Can access admin-only features
- Can be managed by super admin
- Can update their own profile

## Security Features

- **Password Hashing:** bcryptjs with configurable salt rounds
- **JWT Authentication:** Secure token-based authentication
- **Rate Limiting:** Prevents brute force attacks
- **CORS Protection:** Configurable cross-origin resource sharing
- **Input Validation:** Server-side validation for all inputs
- **Helmet Security:** Security headers for production
- **Environment-based Configuration:** Separate configs for dev/prod

## Email Templates

The system includes pre-built email templates for:

- Welcome emails (with/without temporary passwords)
- Password reset emails
- Email verification
- Admin notifications

## Error Handling

Centralized error handling with:
- MongoDB error parsing
- JWT error handling
- Validation error formatting
- Custom error responses
- Development/production error modes

## Development

### Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests (Jest)

### Project Structure

```
├── config/
│   └── database.js          # Database configuration
├── controllers/
│   └── authController.js    # Authentication controllers
├── middleware/
│   ├── auth.js             # Authentication middleware
│   └── error.js            # Error handling middleware
├── models/
│   └── User.js             # User model
├── routes/
│   └── auth.js             # Authentication routes
├── utils/
│   └── emailService.js     # Email utility functions
├── .env                    # Environment variables
├── .gitignore             # Git ignore file
├── package.json           # Dependencies and scripts
├── README.md              # Documentation
└── server.js              # Main application file
```

## Testing

You can test the API endpoints using tools like:
- Postman
- cURL
- Thunder Client (VS Code extension)
- Insomnia

### Sample cURL Commands

**Register Super Admin:**
```bash
curl -X POST http://localhost:5000/api/auth/register-super-admin \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Admin",
    "email": "admin@example.com",
    "password": "SuperAdmin123!"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SuperAdmin123!"
  }'
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Update CORS origins for your frontend domain
3. Use secure HTTPS endpoints
4. Configure proper database security
5. Set strong JWT secrets
6. Enable MongoDB authentication
7. Use process managers like PM2

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Support

For support, email support@bamihost.com or create an issue in the repository.