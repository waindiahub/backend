import express, { Request, Response } from 'express';
import { body, query } from 'express-validator';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { emitToUser, emitToAdmins } from '../socket';

const router = express.Router();

// Get handoff requests
router.get('/', authenticate, [
  query('status').optional().isIn(['pending', 'assigned', 'resolved']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req: AuthRequest, res: Response) => {  // Typing `res` as `Response`
  try {
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const where: any = { isBotHandoff: true };

    // Regular users see only their handoffs, admins see all
    if (req.user!.role === 'USER') {
      where.userId = req.user!.id;
    }

    if (status === 'pending') {
      where.assignedAgentId = null;
    } else if (status === 'assigned') {
      where.assignedAgentId = { not: null };
    }

    const [handoffs, total] = await Promise.all([
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
          assignedAgent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          user: {  // Ensuring that `user` is included here
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          }
        },
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' }
      }),
      prisma.message.count({ where })
    ]);

    res.json({
      handoffs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get handoffs error:', error);
    res.status(500).json({ error: 'Failed to get handoffs' });
  }
});

// Trigger bot handoff
router.post('/trigger', authenticate, [
  body('messageId').isUUID(),
  body('reason').optional().isString(),
], validateRequest, async (req: AuthRequest, res: Response) => {  // Typing `res` as `Response`
  try {
    const { messageId, reason } = req.body;

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        userId: req.user!.id
      },
      include: {
        contact: true,
        user: true  // Ensuring `user` is included here
      }
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Update message to mark as handoff
    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        isBotHandoff: true,
        handoffReason: reason || 'Manual handoff triggered'
      },
      include: {
        contact: true,
        user: true  // Ensuring `user` is included here as well
      }
    });

    // Notify admins via socket
    emitToAdmins(req.app.get('io'), 'handoff_triggered', {
      message: updatedMessage,
      contact: message.contact,
      user: message.user,  // Now `message.user` should exist
      reason
    });

    res.json({ message: 'Handoff triggered successfully', handoff: updatedMessage });
  } catch (error) {
    console.error('Trigger handoff error:', error);
    res.status(500).json({ error: 'Failed to trigger handoff' });
  }
});

// Assign handoff to agent
router.post('/:id/assign', authenticate, [
  body('agentId').optional().isUUID(),
], validateRequest, async (req: AuthRequest, res: Response) => {  // Typing `res` as `Response`
  try {
    const { id } = req.params;
    const { agentId } = req.body;

    // Use current user as agent if not specified
    const assignedAgentId = agentId || req.user!.id;

    const handoff = await prisma.message.update({
      where: { id },
      data: { assignedAgentId },
      include: {
        contact: true,
        assignedAgent: true,
        user: true  // Ensuring `user` is included
      }
    });

    // Notify user that their chat was assigned
    emitToUser(req.app.get('io'), handoff.userId, 'handoff_assigned', {
      handoff,
      agent: handoff.assignedAgent
    });

    res.json({ message: 'Handoff assigned successfully', handoff });
  } catch (error) {
    console.error('Assign handoff error:', error);
    res.status(500).json({ error: 'Failed to assign handoff' });
  }
});

// Resolve handoff
router.post('/:id/resolve', authenticate, async (req: AuthRequest, res: Response) => {  // Typing `res` as `Response`
  try {
    const { id } = req.params;

    const handoff = await prisma.message.update({
      where: { id },
      data: {
        isBotHandoff: false,
        assignedAgentId: null
      },
      include: {
        contact: true,
        user: true  // Ensuring `user` is included
      }
    });

    // Notify user that handoff is resolved
    emitToUser(req.app.get('io'), handoff.userId, 'handoff_resolved', {
      handoff
    });

    res.json({ message: 'Handoff resolved successfully', handoff });
  } catch (error) {
    console.error('Resolve handoff error:', error);
    res.status(500).json({ error: 'Failed to resolve handoff' });
  }
});

// Auto-detect handoff keywords in messages
export async function checkHandoffKeywords(messageContent: string, messageId: string) {
  const handoffKeywords = [
    'human', 'agent', 'support', 'help', 'talk to someone',
    'customer service', 'representative', 'live chat', 'speak to agent'
  ];

  const shouldHandoff = handoffKeywords.some(keyword => 
    messageContent.toLowerCase().includes(keyword)
  );

  if (shouldHandoff) {
    await prisma.message.update({
      where: { id: messageId },
      data: {
        isBotHandoff: true,
        handoffReason: 'Auto-detected handoff keywords'
      }
    });

    return true;
  }

  return false;
}

export default router;
