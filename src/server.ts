import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';

import { prisma } from './lib/prisma';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';

// Routes
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import settingsRoutes from './routes/settings';
import whatsappRoutes from './routes/whatsapp';
import contactRoutes from './routes/contact';
import templateRoutes from './routes/template';
import campaignRoutes from './routes/campaign';
import flowRoutes from './routes/flow';
import messageRoutes from './routes/message';
import ticketRoutes from './routes/ticket';
import apiKeyRoutes from './routes/apiKey';
import paymentRoutes from './routes/payment';
import webhookRoutes from './routes/webhook';
import adminRoutes from './routes/admin';
import adminPlansRoutes from './routes/admin/plans';
import adminUsersRoutes from './routes/admin/users';
import handoffRoutes from './routes/handoff';
import retargetRoutes from './routes/retarget';
import formsRoutes from './routes/forms';
import clicksRoutes from './routes/clicks';

// Socket handlers
import { initializeSocket } from './socket';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/flows', flowRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/plans', adminPlansRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/handoff', handoffRoutes);
app.use('/api/retarget', retargetRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/clicks', clicksRoutes);

// Socket.io
initializeSocket(io);

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});