import express, { Request, Response } from 'express';
import { body, query } from 'express-validator';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { checkPlanAccess } from '../middleware/planAccess';

const router = express.Router();

// Get retarget campaigns
router.get('/', authenticate, checkPlanAccess('retargeting'), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [campaigns, total] = await Promise.all([
      prisma.retargetCampaign.findMany({
        where: { userId: req.user!.id },
        include: {
          template: {
            select: {
              name: true,
              status: true
            }
          }
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.retargetCampaign.count({ where: { userId: req.user!.id } })
    ]);

    res.json({
      campaigns,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get retarget campaigns error:', error);
    res.status(500).json({ error: 'Failed to get retarget campaigns' });
  }
});

// Create retarget campaign
router.post('/', authenticate, checkPlanAccess('retargeting'), [
  body('name').trim().isLength({ min: 1 }),
  body('filters').isObject(),
  body('templateId').optional().isUUID(),
  body('message').optional().isString(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { name, filters, templateId, message } = req.body;

    // Build contact query based on filters
    const contactWhere: any = { userId: req.user!.id };

    if (filters.unread) {
      contactWhere.isUnread = true;
    }

    if (filters.noReply) {
      contactWhere.hasReplied = false;
    }

    if (filters.clicked) {
      contactWhere.clickLogs = {
        some: {}
      };
    }

    if (filters.tags && filters.tags.length > 0) {
      contactWhere.tags = {
        some: {
          tag: {
            name: { in: filters.tags }
          }
        }
      };
    }

    if (filters.lastMessageBefore) {
      contactWhere.lastMessageAt = {
        lt: new Date(filters.lastMessageBefore)
      };
    }

    if (filters.source) {
      contactWhere.source = filters.source;
    }

    // Count target contacts
    const targetCount = await prisma.contact.count({ where: contactWhere });

    const campaign = await prisma.retargetCampaign.create({
      data: {
        userId: req.user!.id,
        name,
        filters,
        templateId,
        message,
        targetCount,
        status: 'draft'
      }
    });

    res.status(201).json(campaign);
  } catch (error) {
    console.error('Create retarget campaign error:', error);
    res.status(500).json({ error: 'Failed to create retarget campaign' });
  }
});

// Execute retarget campaign
router.post('/:id/execute', authenticate, checkPlanAccess('retargeting'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.retargetCampaign.findFirst({
      where: {
        id,
        userId: req.user!.id
      },
      include: {
        template: true
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'draft') {
      return res.status(400).json({ error: 'Campaign already executed' });
    }

    // Build contact query
    const contactWhere: any = { userId: req.user!.id };
    const filters = campaign.filters as any;

    if (filters.unread) contactWhere.isUnread = true;
    if (filters.noReply) contactWhere.hasReplied = false;
    if (filters.clicked) {
      contactWhere.clickLogs = { some: {} };
    }
    if (filters.tags?.length > 0) {
      contactWhere.tags = {
        some: { tag: { name: { in: filters.tags } } }
      };
    }
    if (filters.lastMessageBefore) {
      contactWhere.lastMessageAt = { lt: new Date(filters.lastMessageBefore) };
    }
    if (filters.source) contactWhere.source = filters.source;

    // Get target contacts
    const contacts = await prisma.contact.findMany({
      where: contactWhere,
      take: 1000 // Limit for safety
    });

    // Update campaign status
    await prisma.retargetCampaign.update({
      where: { id },
      data: {
        status: 'running',
        targetCount: contacts.length
      }
    });

    // Process contacts in background (simplified)
    processRetargetCampaign(campaign, contacts);

    res.json({
      message: 'Retarget campaign started',
      targetCount: contacts.length
    });
  } catch (error) {
    console.error('Execute retarget campaign error:', error);
    res.status(500).json({ error: 'Failed to execute retarget campaign' });
  }
});

// Get retarget analytics
router.get('/analytics', authenticate, checkPlanAccess('retargeting'), async (req: AuthRequest, res: Response) => {
  try {
    const [totalCampaigns, totalSent, avgOpenRate] = await Promise.all([
      prisma.retargetCampaign.count({ where: { userId: req.user!.id } }),
      prisma.retargetCampaign.aggregate({
        where: { userId: req.user!.id },
        _sum: { sentCount: true }
      }),
      // Calculate average open rate from click logs
      prisma.clickLog.count({
        where: {
          message: { userId: req.user!.id }
        }
      })
    ]);

    res.json({
      totalCampaigns,
      totalSent: totalSent._sum.sentCount || 0,
      avgOpenRate: avgOpenRate || 0
    });
  } catch (error) {
    console.error('Get retarget analytics error:', error);
    res.status(500).json({ error: 'Failed to get retarget analytics' });
  }
});

// Background function to process retarget campaign
async function processRetargetCampaign(campaign: any, contacts: any[]) {
  try {
    let sentCount = 0;

    for (const contact of contacts) {
      try {
        // Create message record
        await prisma.message.create({
          data: {
            userId: campaign.userId,
            whatsappAccountId: contact.whatsappAccountId || '', // Get from user's account
            contactId: contact.id,
            direction: 'OUTBOUND',
            type: campaign.templateId ? 'TEMPLATE' : 'TEXT',
            content: campaign.message || campaign.template?.name || 'Retarget message',
            status: 'SENT',
            templateId: campaign.templateId
          }
        });

        sentCount++;

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Failed to send retarget message:', error);
      }
    }

    // Update campaign with final count
    await prisma.retargetCampaign.update({
      where: { id: campaign.id },
      data: {
        status: 'completed',
        sentCount
      }
    });
  } catch (error) {
    console.error('Process retarget campaign error:', error);
    
    await prisma.retargetCampaign.update({
      where: { id: campaign.id },
      data: { status: 'failed' }
    });
  }
}

export default router;
