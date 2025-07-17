import express, { Response } from 'express';
import { body } from 'express-validator';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// Get user settings
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true
      }
    });

    const whatsappAccount = await prisma.whatsAppAccount.findFirst({
      where: { userId: req.user!.id },
      select: {
        id: true,
        phoneNumberId: true,
        accessToken: true,
        businessAccountId: true,
        displayName: true,
        webhookUrl: true,
        webhookSecret: true,
        verifyToken: true,
        status: true,
        isActive: true
      }
    });

    const settings = {
      profile: {
        name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
        email: user?.email,
        phone: user?.phone
      },
      whatsapp: whatsappAccount ? {
        phoneNumberId: whatsappAccount.phoneNumberId,
        accessToken: whatsappAccount.accessToken,
        businessAccountId: whatsappAccount.businessAccountId,
        displayName: whatsappAccount.displayName,
        webhookUrl: whatsappAccount.webhookUrl,
        webhookSecret: whatsappAccount.webhookSecret,
        verifyToken: whatsappAccount.verifyToken,
        status: whatsappAccount.status,
        isActive: whatsappAccount.isActive
      } : null
    };

    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update profile settings
router.put('/profile', authenticate, [
  body('firstName').optional().trim().isLength({ min: 1 }),
  body('lastName').optional().trim().isLength({ min: 1 }),
  body('phone').optional().isMobilePhone('any')
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, phone } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        firstName,
        lastName,
        phone
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true
      }
    });

    res.json({
      message: 'Profile updated successfully',
      profile: {
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update WhatsApp settings
router.put('/whatsapp', authenticate, [
  body('phoneNumberId').optional().trim(),
  body('accessToken').optional().trim(),
  body('businessAccountId').optional().trim(),
  body('webhookUrl').optional().isURL(),
  body('webhookSecret').optional().trim(),
  body('verifyToken').optional().trim()
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { phoneNumberId, accessToken, businessAccountId, webhookUrl, webhookSecret, verifyToken } = req.body;

    // Find existing WhatsApp account
    let whatsappAccount = await prisma.whatsAppAccount.findFirst({
      where: { userId: req.user!.id }
    });

    const updateData: any = {};
    if (phoneNumberId) updateData.phoneNumberId = phoneNumberId;
    if (accessToken) updateData.accessToken = accessToken;
    if (businessAccountId) updateData.businessAccountId = businessAccountId;
    if (webhookUrl) updateData.webhookUrl = webhookUrl;
    if (webhookSecret) updateData.webhookSecret = webhookSecret;
    if (verifyToken) updateData.verifyToken = verifyToken;

    if (whatsappAccount) {
      // Update existing account
      whatsappAccount = await prisma.whatsAppAccount.update({
        where: { id: whatsappAccount.id },
        data: updateData
      });
    } else if (phoneNumberId && accessToken && businessAccountId) {
      // Create new account
      whatsappAccount = await prisma.whatsAppAccount.create({
        data: {
          userId: req.user!.id,
          phoneNumberId,
          accessToken,
          businessAccountId,
          displayName: 'WhatsApp Business',
          webhookUrl,
          webhookSecret,
          verifyToken,
          status: 'CONNECTED'
        }
      });
    } else {
      return res.status(400).json({ error: 'Phone Number ID, Access Token, and Business Account ID are required for new accounts' });
    }

    res.json({
      message: 'WhatsApp settings updated successfully',
      whatsapp: {
        phoneNumberId: whatsappAccount.phoneNumberId,
        accessToken: whatsappAccount.accessToken,
        businessAccountId: whatsappAccount.businessAccountId,
        displayName: whatsappAccount.displayName,
        webhookUrl: whatsappAccount.webhookUrl,
        webhookSecret: whatsappAccount.webhookSecret,
        verifyToken: whatsappAccount.verifyToken,
        status: whatsappAccount.status,
        isActive: whatsappAccount.isActive
      }
    });
  } catch (error) {
    console.error('Update WhatsApp settings error:', error);
    res.status(500).json({ error: 'Failed to update WhatsApp settings' });
  }
});

// Generate webhook secret
router.post('/whatsapp/generate-webhook-secret', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const webhookSecret = crypto.randomBytes(32).toString('hex');

    let whatsappAccount = await prisma.whatsAppAccount.findFirst({
      where: { userId: req.user!.id }
    });

    if (whatsappAccount) {
      await prisma.whatsAppAccount.update({
        where: { id: whatsappAccount.id },
        data: { webhookSecret }
      });
    }

    res.json({
      message: 'Webhook secret generated successfully',
      webhookSecret
    });
  } catch (error) {
    console.error('Generate webhook secret error:', error);
    res.status(500).json({ error: 'Failed to generate webhook secret' });
  }
});

// Generate verify token
router.post('/whatsapp/generate-verify-token', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const verifyToken = crypto.randomBytes(16).toString('hex');

    let whatsappAccount = await prisma.whatsAppAccount.findFirst({
      where: { userId: req.user!.id }
    });

    if (whatsappAccount) {
      await prisma.whatsAppAccount.update({
        where: { id: whatsappAccount.id },
        data: { verifyToken }
      });
    }

    res.json({
      message: 'Verify token generated successfully',
      verifyToken
    });
  } catch (error) {
    console.error('Generate verify token error:', error);
    res.status(500).json({ error: 'Failed to generate verify token' });
  }
});

// Test WhatsApp connection
router.post('/whatsapp/test-connection', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const whatsappAccount = await prisma.whatsAppAccount.findFirst({
      where: { userId: req.user!.id }
    });

    if (!whatsappAccount) {
      return res.status(404).json({ error: 'WhatsApp account not found' });
    }

    // Test the connection by making a request to WhatsApp API
    const axios = require('axios');
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${whatsappAccount.phoneNumberId}`,
      {
        headers: {
          'Authorization': `Bearer ${whatsappAccount.accessToken}`
        }
      }
    );

    res.json({
      message: 'WhatsApp connection test successful',
      data: response.data
    });
  } catch (error: any) {
    console.error('Test WhatsApp connection error:', error);
    
    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Invalid WhatsApp access token' });
    }
    
    res.status(500).json({ error: 'WhatsApp connection test failed' });
  }
});

export default router;