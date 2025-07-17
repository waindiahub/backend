# WhatsApp Cloud API Backend

A Node.js backend service for WhatsApp Cloud API integration with comprehensive messaging, contact management, and campaign features.

## Features

- 🔐 **Authentication & Authorization** - JWT-based user authentication
- 📱 **WhatsApp Cloud API Integration** - Send/receive messages, manage webhooks
- 👥 **Contact Management** - Store and organize contacts with tags and attributes
- 📧 **Template Management** - Create and manage WhatsApp message templates
- 🚀 **Campaign System** - Bulk messaging campaigns with scheduling
- 🔄 **Flow Builder** - Automated conversation flows
- 📊 **Analytics & Reporting** - Message delivery tracking and analytics
- 🔗 **Webhook Management** - Secure webhook handling with verification
- 🎫 **Ticket System** - Customer support ticket management
- 🔌 **API Keys Management** - Secure API access control

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT tokens
- **Real-time**: Socket.io
- **Validation**: Zod
- **Security**: bcryptjs, helmet, cors

## Prerequisites

- Node.js (v16 or higher)
- PostgreSQL database
- WhatsApp Business Account with Cloud API access

## Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   Create a `.env` file in the root directory:
   ```env
   # Database
   DATABASE_URL="postgresql://username:password@localhost:5432/whatsapp_db"
   
   # JWT Secret
   JWT_SECRET="your-super-secret-jwt-key"
   
   # Server Configuration
   PORT=5000
   NODE_ENV=development
   
   # WhatsApp Cloud API
   WHATSAPP_ACCESS_TOKEN="your-whatsapp-access-token"
   WHATSAPP_PHONE_NUMBER_ID="your-phone-number-id"
   WHATSAPP_BUSINESS_ACCOUNT_ID="your-business-account-id"
   WHATSAPP_WEBHOOK_SECRET="your-webhook-secret"
   WHATSAPP_VERIFY_TOKEN="your-verify-token"
   
   # Email Configuration (optional)
   SMTP_HOST="smtp.gmail.com"
   SMTP_PORT=587
   SMTP_USER="your-email@gmail.com"
   SMTP_PASS="your-app-password"
   ```

4. **Database Setup**
   ```bash
   # Generate Prisma client
   npx prisma generate
   
   # Run database migrations
   npx prisma db push
   
   # Seed the database (optional)
   npm run seed
   ```

5. **Start the server**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user

### Settings
- `GET /api/settings` - Get user settings
- `PUT /api/settings/profile` - Update user profile
- `PUT /api/settings/whatsapp` - Update WhatsApp settings
- `POST /api/settings/whatsapp/generate-webhook-secret` - Generate webhook secret
- `POST /api/settings/whatsapp/generate-verify-token` - Generate verify token

### WhatsApp
- `POST /api/whatsapp/send-message` - Send WhatsApp message
- `POST /api/whatsapp/webhook` - Webhook endpoint for receiving messages
- `GET /api/whatsapp/accounts` - Get WhatsApp accounts

### Contacts
- `GET /api/contacts` - Get all contacts
- `POST /api/contacts` - Create new contact
- `PUT /api/contacts/:id` - Update contact
- `DELETE /api/contacts/:id` - Delete contact

### Templates
- `GET /api/templates` - Get all templates
- `POST /api/templates` - Create new template
- `PUT /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template

### Campaigns
- `GET /api/campaigns` - Get all campaigns
- `POST /api/campaigns` - Create new campaign
- `PUT /api/campaigns/:id` - Update campaign
- `POST /api/campaigns/:id/start` - Start campaign

## WhatsApp Webhook Setup

1. **Configure Webhook URL** in your WhatsApp Business API dashboard:
   ```
   https://yourdomain.com/api/whatsapp/webhook
   ```

2. **Set Verify Token** - Use the token generated from the settings API

3. **Configure Webhook Secret** - Use the secret generated from the settings API

4. **Subscribe to Events**:
   - messages
   - message_deliveries
   - message_reads
   - message_reactions

## Database Schema

The application uses Prisma ORM with the following main models:
- User
- WhatsAppAccount
- Contact
- Template
- Campaign
- Message
- Flow
- Ticket

## Security Features

- JWT-based authentication
- Password hashing with bcryptjs
- Webhook signature verification
- CORS protection
- Rate limiting
- Input validation with Zod

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Database operations
npx prisma studio    # Open Prisma Studio
npx prisma migrate dev    # Create new migration
npx prisma db seed   # Seed database
```

## Deployment

1. **Environment Variables** - Set all required environment variables
2. **Database** - Ensure PostgreSQL is accessible
3. **Build** - Run `npm run build`
4. **Start** - Run `npm start`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support and questions, please open an issue in the GitHub repository.