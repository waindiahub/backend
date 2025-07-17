import express from 'express';
import { body, query } from 'express-validator';
import axios from 'axios';

import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// Get campaigns
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED']),
  query('category').optional().isIn(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const category = req.query.category as string;

    const skip = (page - 1) * limit;

    const where: any = { userId: req.user!.id };
    if (status) where.status = status;
    if (category) where.category = category;

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        include: {
          template: {
            select: {
              name: true,
              category: true
            }
          },
          whatsappAccount: {
            select: {
              displayName: true,
              phoneNumberId: true
            }
          },
          _count: {
            select: { contacts: true }
          }
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.campaign.count({ where })
    ]);

    res.json({
      campaigns: campaigns.map(campaign => ({
        ...campaign,
        contactCount: campaign._count.contacts
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ error: 'Failed to get campaigns' });
  }
});

// Create campaign
router.post('/', authenticate, [
  body('whatsappAccountId').isUUID(),
  body('name').trim().isLength({ min: 1 }),
  body('templateId').optional().isUUID(),
  body('contactIds').isArray({ min: 1 }),
  body('scheduledAt').optional().isISO8601(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { whatsappAccountId, name, description, templateId, contactIds, scheduledAt } = req.body;

    // Verify WhatsApp account
    const whatsappAccount = await prisma.whatsAppAccount.findFirst({
      where: {
        id: whatsappAccountId,
        userId: req.user!.id
      }
    });

    if (!whatsappAccount) {
      return res.status(404).json({ error: 'WhatsApp account not found' });
    }

    // Verify template if provided
    if (templateId) {
      const template = await prisma.template.findFirst({
        where: {
          id: templateId,
          userId: req.user!.id,
          status: 'APPROVED'
        }
      });

      if (!template) {
        return res.status(404).json({ error: 'Template not found or not approved' });
      }
    }

    // Verify contacts belong to user
    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: contactIds },
        userId: req.user!.id
      }
    });

    if (contacts.length !== contactIds.length) {
      return res.status(400).json({ error: 'Some contacts not found' });
    }

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        userId: req.user!.id,
        whatsappAccountId,
        templateId,
        name,
        description,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: scheduledAt ? 'SCHEDULED' : 'DRAFT',
        totalContacts: contacts.length
      }
    });

    // Add contacts to campaign
    const campaignContacts = contacts.map(contact => ({
      campaignId: campaign.id,
      contactId: contact.id,
      status: 'PENDING' as const
    }));

    await prisma.campaignContact.createMany({
      data: campaignContacts
    });

    res.status(201).json(campaign);
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// Update campaign
router.put('/:id', authenticate, [
  body('name').optional().trim().isLength({ min: 1 }),
  body('scheduledAt').optional().isISO8601(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { name, description, scheduledAt } = req.body;

    const campaign = await prisma.campaign.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status === 'RUNNING' || campaign.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot edit running or completed campaign' });
    }

    const updatedCampaign = await prisma.campaign.update({
      where: { id },
      data: {
        name,
        description,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: scheduledAt ? 'SCHEDULED' : 'DRAFT'
      }
    });

    res.json(updatedCampaign);
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// Start campaign
router.post('/:id/start', authenticate, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findFirst({
      where: {
        id,
        userId: req.user!.id
      },
      include: {
        template: true,
        whatsappAccount: true,
        contacts: {
          include: { contact: true }
        }
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      return res.status(400).json({ error: 'Campaign cannot be started' });
    }

    // Update campaign status
    await prisma.campaign.update({
      where: { id },
      data: {
        status: 'RUNNING',
        startedAt: new Date()
      }
    });

    // TODO: Process campaign messages in background job
    // For now, we'll just mark it as running
    processCampaignMessages(campaign);

    res.json({ message: 'Campaign started successfully' });
  } catch (error) {
    console.error('Start campaign error:', error);
    res.status(500).json({ error: 'Failed to start campaign' });
  }
});

// Pause campaign
router.post('/:id/pause', authenticate, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'RUNNING') {
      return res.status(400).json({ error: 'Campaign is not running' });
    }

    await prisma.campaign.update({
      where: { id },
      data: { status: 'PAUSED' }
    });

    res.json({ message: 'Campaign paused successfully' });
  } catch (error) {
    console.error('Pause campaign error:', error);
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
});

// Get campaign details
router.get('/:id', authenticate, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findFirst({
      where: {
        id,
        userId: req.user!.id
      },
      include: {
        template: true,
        whatsappAccount: {
          select: {
            displayName: true,
            phoneNumberId: true
          }
        },
        contacts: {
          include: {
            contact: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            }
          }
        }
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json(campaign);
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({ error: 'Failed to get campaign' });
  }
});

// Delete campaign
router.delete('/:id', authenticate, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status === 'RUNNING') {
      return res.status(400).json({ error: 'Cannot delete running campaign' });
    }

    await prisma.campaign.delete({
      where: { id }
    });

    res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// Background function to process campaign messages
async function processCampaignMessages(campaign: any) {
  try {
    // This would typically be handled by a background job queue
    // For demo purposes, we'll process a few messages
    
    for (const campaignContact of campaign.contacts.slice(0, 5)) {
      try {
        // TODO: Send actual WhatsApp message
        // For now, just create message record
        await prisma.message.create({
          data: {
            userId: campaign.userId,
            whatsappAccountId: campaign.whatsappAccountId,
            contactId: campaignContact.contactId,
            campaignId: campaign.id,
            templateId: campaign.templateId,
            direction: 'OUTBOUND',
            type: 'TEMPLATE',
            content: campaign.template?.name || 'Campaign message',
            status: 'SENT'
          }
        });

        // Update campaign contact status
        await prisma.campaignContact.update({
          where: {
            campaignId_contactId: {
              campaignId: campaign.id,
              contactId: campaignContact.contactId
            }
          },
          data: {
            status: 'SENT',
            sentAt: new Date()
          }
        });

        // Update campaign counters
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { sentCount: { increment: 1 } }
        });

      } catch (error) {
        console.error('Failed to send message to contact:', campaignContact.contactId, error);
        
        await prisma.campaignContact.update({
          where: {
            campaignId_contactId: {
              campaignId: campaign.id,
              contactId: campaignContact.contactId
            }
          },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorMessage: 'Failed to send message'
          }
        });

        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { failedCount: { increment: 1 } }
        });
      }
    }

    // Mark campaign as completed if all messages processed
    const pendingCount = await prisma.campaignContact.count({
      where: {
        campaignId: campaign.id,
        status: 'PENDING'
      }
    });

    if (pendingCount === 0) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date()
        }
      });
    }

  } catch (error) {
    console.error('Process campaign messages error:', error);
    
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'FAILED' }
    });
  }
}

export default router;
  