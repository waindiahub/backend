import express, { Request, Response } from 'express';
import { query } from 'express-validator';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// Get messages with pagination and filtering
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('contactId').optional().isUUID(),
  query('direction').optional().isIn(['INBOUND', 'OUTBOUND']),
  query('status').optional().isIn(['SENT', 'DELIVERED', 'READ', 'FAILED']),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const contactId = req.query.contactId as string;
    const direction = req.query.direction as string;
    const status = req.query.status as string;

    const skip = (page - 1) * limit;

    const where: any = { userId: req.user!.id };

    if (contactId) where.contactId = contactId;
    if (direction) where.direction = direction;
    if (status) where.status = status;

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              phone: true
            }
          },
          template: {
            select: {
              name: true,
              category: true
            }
          },
          campaign: {
            select: {
              name: true
            }
          }
        },
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' }
      }),
      prisma.message.count({ where })
    ]);

    res.status(200).json({
      messages,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Get message by ID
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const message = await prisma.message.findFirst({
      where: {
        id,
        userId: req.user!.id
      },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        template: {
          select: {
            name: true,
            category: true,
            components: true
          }
        },
        campaign: {
          select: {
            name: true
          }
        }
      }
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.status(200).json(message);
  } catch (error) {
    console.error('Get message error:', error);
    res.status(500).json({ error: 'Failed to get message' });
  }
});

// Get conversation between user and contact
router.get('/conversation/:contactId', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { contactId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const skip = (page - 1) * limit;

    // Verify contact belongs to user
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        userId: req.user!.id
      }
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const [messages, total] = await Promise.all([ 
      prisma.message.findMany({
        where: {
          contactId,
          userId: req.user!.id
        },
        include: {
          template: {
            select: {
              name: true,
              category: true
            }
          }
        },
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' }
      }),
      prisma.message.count({
        where: {
          contactId,
          userId: req.user!.id
        }
      })
    ]);

    res.status(200).json({
      contact,
      messages: messages.reverse(), // Reverse to show oldest first
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

// Get message analytics (✅ FIXED HERE)
router.get('/analytics/overview', authenticate, [
  query('days').optional().isInt({ min: 1, max: 365 }),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get message counts by status
    const messageStats = await prisma.message.groupBy({
      by: ['status'],
      where: {
        userId: req.user!.id,
        timestamp: { gte: startDate }
      },
      _count: { status: true }
    });

    // ✅ Fixed raw SQL query
    const dailyStats = await prisma.$queryRaw`
      SELECT 
        DATE("timestamp") as date,
        COUNT(*) as total,
        COUNT(CASE WHEN "direction" = 'OUTBOUND' THEN 1 END) as sent,
        COUNT(CASE WHEN "direction" = 'INBOUND' THEN 1 END) as received
      FROM "messages" 
      WHERE "userId" = ${req.user!.id} 
        AND "timestamp" >= ${startDate}
      GROUP BY DATE("timestamp")
      ORDER BY date DESC
    `;

    // Get top contacts by message count
    const topContacts = await prisma.message.groupBy({
      by: ['contactId'],
      where: {
        userId: req.user!.id,
        timestamp: { gte: startDate }
      },
      _count: { contactId: true },
      orderBy: { _count: { contactId: 'desc' } },
      take: 10
    });

    const contactIds = topContacts.map(tc => tc.contactId);
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, name: true, phone: true }
    });

    const topContactsWithDetails = topContacts.map(tc => ({
      contact: contacts.find(c => c.id === tc.contactId),
      messageCount: tc._count.contactId
    }));

    res.status(200).json({
      messageStats: messageStats.reduce((acc, stat) => {
        acc[stat.status.toLowerCase()] = stat._count.status;
        return acc;
      }, {} as Record<string, number>),
      dailyStats,
      topContacts: topContactsWithDetails
    });
  } catch (error) {
    console.error('Get message analytics error:', error);
    res.status(500).json({ error: 'Failed to get message analytics' });
  }
});

export default router;
