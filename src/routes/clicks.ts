import express from 'express';
import { body, query } from 'express-validator';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { Response } from 'express';
  

const router = express.Router();

// Track click (public endpoint for WhatsApp buttons)
router.post('/track', [
  body('messageId').isUUID(),
  body('contactPhone').isMobilePhone('en-US'),
  body('buttonId').isString(),
  body('buttonText').isString(),
  body('url').optional().isURL(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { messageId, contactPhone, buttonId, buttonText, url } = req.body;

    // Find message and contact
    const [message, contact] = await Promise.all([
      prisma.message.findUnique({
        where: { id: messageId },
        include: { user: true }
      }),
      prisma.contact.findFirst({
        where: { phone: contactPhone }
      })
    ]);

    if (!message || !contact) {
      return res.status(404).json({ error: 'Message or contact not found' });
    }

    // Create click log
    const clickLog = await prisma.clickLog.create({
      data: {
        messageId,
        contactId: contact.id,
        buttonId,
        buttonText,
        url
      }
    });

    // Update contact as having clicked
    await prisma.contact.update({
      where: { id: contact.id },
      data: { lastMessageAt: new Date() }
    });

    // Emit real-time notification
    req.app.get('io').to(`user:${message.userId}`).emit('button_clicked', {
      clickLog,
      contact,
      message
    });

    res.json({ message: 'Click tracked successfully' });
  } catch (error) {
    console.error('Track click error:', error);
    res.status(500).json({ error: 'Failed to track click' });
  }
});

// Get click analytics
router.get('/analytics', authenticate, [
  query('days').optional().isInt({ min: 1, max: 365 }),
  query('messageId').optional().isUUID(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const messageId = req.query.messageId as string;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const where: any = {
      message: { userId: req.user!.id },
      clickedAt: { gte: startDate }
    };

    if (messageId) {
      where.messageId = messageId;
    }

    const [totalClicks, uniqueClickers, topButtons, dailyClicks] = await Promise.all([
      prisma.clickLog.count({ where }),
      prisma.clickLog.groupBy({
        by: ['contactId'],
        where,
        _count: { contactId: true }
      }),
      prisma.clickLog.groupBy({
        by: ['buttonText'],
        where,
        _count: { buttonText: true },
        orderBy: { _count: { buttonText: 'desc' } },
        take: 10
      }),
      prisma.$queryRaw`
        SELECT 
          DATE(clicked_at) as date,
          COUNT(*) as clicks,
          COUNT(DISTINCT contact_id) as unique_clicks
        FROM click_logs cl
        JOIN messages m ON cl.message_id = m.id
        WHERE m.user_id = ${req.user!.id}
          AND cl.clicked_at >= ${startDate}
        GROUP BY DATE(clicked_at)
        ORDER BY date DESC
      `
    ]);

    res.json({
      totalClicks,
      uniqueClickers: uniqueClickers.length,
      topButtons: topButtons.map(button => ({
        buttonText: button.buttonText,
        clicks: button._count.buttonText
      })),
      dailyClicks
    });
  } catch (error) {
    console.error('Get click analytics error:', error);
    res.status(500).json({ error: 'Failed to get click analytics' });
  }
});

// Get click heatmap data
router.get('/heatmap', authenticate, [
  query('campaignId').optional().isUUID(),
  query('templateId').optional().isUUID(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const campaignId = req.query.campaignId as string;
    const templateId = req.query.templateId as string;

    const where: any = {
      message: { userId: req.user!.id }
    };

    if (campaignId) {
      where.message.campaignId = campaignId;
    }

    if (templateId) {
      where.message.templateId = templateId;
    }

    const clickData = await prisma.clickLog.findMany({
      where,
      include: {
        message: {
          select: {
            id: true,
            content: true,
            templateId: true,
            campaignId: true
          }
        },
        contact: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        }
      },
      orderBy: { clickedAt: 'desc' }
    });

    // Group by button position/text for heatmap
    const heatmapData = clickData.reduce((acc, click) => {
      const key = `${click.buttonId}-${click.buttonText}`;
      if (!acc[key]) {
        acc[key] = {
          buttonId: click.buttonId,
          buttonText: click.buttonText,
          clicks: 0,
          uniqueClickers: new Set()
        };
      }
      acc[key].clicks++;
      acc[key].uniqueClickers.add(click.contactId);
      return acc;
    }, {} as Record<string, any>);

    // Convert to array and add unique clicker count
    const heatmap = Object.values(heatmapData).map((item: any) => ({
      ...item,
      uniqueClickers: item.uniqueClickers.size
    }));

    res.json({ heatmap, totalClicks: clickData.length });
  } catch (error) {
    console.error('Get click heatmap error:', error);
    res.status(500).json({ error: 'Failed to get click heatmap' });
  }
});

export default router;