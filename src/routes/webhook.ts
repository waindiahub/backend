import express, { Request, Response } from 'express';
import { body, query } from 'express-validator';
import crypto from 'crypto';
import axios from 'axios';

import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

// Ensure WebhookEvent is imported
import { WebhookEvent } from '@prisma/client'; // Prisma enum for Webhook events

const router = express.Router();

// Get webhooks
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [webhooks, total] = await Promise.all([
      prisma.webhook.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.webhook.count()
    ]);

    res.json({
      webhooks,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get webhooks error:', error);
    res.status(500).json({ error: 'Failed to get webhooks' });
  }
});

// Create webhook
router.post('/', authenticate, [
  body('url').isURL(),
  body('events').isArray({ min: 1 }),
  body('secret').optional().isString(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { url, events, secret } = req.body;

    // Validate events
    const validEvents: WebhookEvent[] = [
      WebhookEvent.MESSAGE_RECEIVED,
      WebhookEvent.MESSAGE_DELIVERED,
      WebhookEvent.MESSAGE_READ,
      WebhookEvent.TEMPLATE_APPROVED,
      WebhookEvent.TEMPLATE_REJECTED,
      WebhookEvent.CAMPAIGN_COMPLETED,
      WebhookEvent.PAYMENT_SUCCESS,
      WebhookEvent.PAYMENT_FAILED
    ];

    const invalidEvents = events.filter((event: string) => !validEvents.includes(event as WebhookEvent));

    if (invalidEvents.length > 0) {
      return res.status(400).json({
        error: 'Invalid events',
        invalidEvents
      });
    }

    const webhook = await prisma.webhook.create({
      data: {
        url,
        events: events as WebhookEvent[], // Ensure events are cast to WebhookEvent[] type
        secret: secret || crypto.randomBytes(32).toString('hex'),
        isActive: true
      }
    });

    res.status(201).json(webhook);
  } catch (error) {
    console.error('Create webhook error:', error);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// Update webhook
router.put('/:id', authenticate, [
  body('url').optional().isURL(),
  body('events').optional().isArray({ min: 1 }),
  body('isActive').optional().isBoolean(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { url, events, isActive } = req.body;

    const webhook = await prisma.webhook.findUnique({
      where: { id }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const updateData: any = {};

    if (url) updateData.url = url;
    if (events) {
      // Validate events
      const validEvents: WebhookEvent[] = [
        WebhookEvent.MESSAGE_RECEIVED,
        WebhookEvent.MESSAGE_DELIVERED,
        WebhookEvent.MESSAGE_READ,
        WebhookEvent.TEMPLATE_APPROVED,
        WebhookEvent.TEMPLATE_REJECTED,
        WebhookEvent.CAMPAIGN_COMPLETED,
        WebhookEvent.PAYMENT_SUCCESS,
        WebhookEvent.PAYMENT_FAILED
      ];

      const invalidEvents = events.filter((event: string) => !validEvents.includes(event as WebhookEvent));

      if (invalidEvents.length > 0) {
        return res.status(400).json({
          error: 'Invalid events',
          invalidEvents
        });
      }

      updateData.events = events as WebhookEvent[]; // Ensure events are cast to WebhookEvent[] type
    }
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedWebhook = await prisma.webhook.update({
      where: { id },
      data: updateData
    });

    res.json(updatedWebhook);
  } catch (error) {
    console.error('Update webhook error:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// Delete webhook
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const webhook = await prisma.webhook.findUnique({
      where: { id }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    await prisma.webhook.delete({
      where: { id }
    });

    res.json({ message: 'Webhook deleted successfully' });
  } catch (error) {
    console.error('Delete webhook error:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// Test webhook
router.post('/:id/test', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const webhook = await prisma.webhook.findUnique({
      where: { id }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const testPayload = {
      event: 'TEST',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook'
      }
    };

    const signature = generateWebhookSignature(JSON.stringify(testPayload), webhook.secret!);

    try {
      const response = await axios.post(webhook.url, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature
        },
        timeout: 10000
      });

      res.json({
        success: true,
        status: response.status,
        message: 'Webhook test successful'
      });
    } catch (error) {
      res.json({
        success: false,
        error: axios.isAxiosError(error) ? error.message : 'Unknown error',
        message: 'Webhook test failed'
      });
    }
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({ error: 'Failed to test webhook' });
  }
});

// Trigger webhook for specific events
export async function triggerWebhook(event: WebhookEvent, data: any) { // Enforce WebhookEvent type here
  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        events: {
          has: event // Now event is properly typed as WebhookEvent
        }
      }
    });

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data
    };

    for (const webhook of webhooks) {
      try {
        const signature = generateWebhookSignature(JSON.stringify(payload), webhook.secret!);

        await axios.post(webhook.url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature
          },
          timeout: 10000
        });

        console.log(`Webhook ${webhook.id} triggered successfully for event ${event}`);
      } catch (error) {
        console.error(`Failed to trigger webhook ${webhook.id} for event ${event}:`, error);
      }
    }
  } catch (error) {
    console.error('Trigger webhook error:', error);
  }
}

function generateWebhookSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

export default router;
