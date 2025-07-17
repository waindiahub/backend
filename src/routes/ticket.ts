import express, { Request, Response } from 'express';  // Import Response from express
import { body, query } from 'express-validator';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// Get tickets
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  query('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const priority = req.query.priority as string;

    const skip = (page - 1) * limit;

    const where: any = {};

    // Regular users can only see their own tickets
    if (req.user!.role === 'USER') {
      where.userId = req.user!.id;
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          _count: {
            select: { messages: true }
          }
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.ticket.count({ where })
    ]);

    res.json({
      tickets: tickets.map(ticket => ({
        ...ticket,
        messageCount: ticket._count.messages
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ error: 'Failed to get tickets' });
  }
});

// Create ticket
router.post('/', authenticate, [
  body('subject').trim().isLength({ min: 1 }),
  body('description').trim().isLength({ min: 1 }),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { subject, description, priority = 'MEDIUM' } = req.body;

    const ticket = await prisma.ticket.create({
      data: {
        userId: req.user!.id,
        subject,
        description,
        priority,
        status: 'OPEN'
      }
    });

    res.status(201).json(ticket);
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// Update ticket
router.put('/:id', authenticate, [
  body('subject').optional().trim().isLength({ min: 1 }),
  body('description').optional().trim().isLength({ min: 1 }),
  body('status').optional().isIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  body('assignedTo').optional().isUUID(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { subject, description, status, priority, assignedTo } = req.body;

    const ticket = await prisma.ticket.findUnique({
      where: { id }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Regular users can only update their own tickets and limited fields
    if (req.user!.role === 'USER' && ticket.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updateData: any = {};

    if (subject) updateData.subject = subject;
    if (description) updateData.description = description;

    // Only admins can update status, priority, and assignment
    if (req.user!.role === 'ADMIN' || req.user!.role === 'SUPER_ADMIN') {
      if (status) updateData.status = status;
      if (priority) updateData.priority = priority;
      if (assignedTo !== undefined) updateData.assignedTo = assignedTo;
    }

    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: updateData
    });

    res.json(updatedTicket);
  } catch (error) {
    console.error('Update ticket error:', error);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Get ticket by ID
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const where: any = { id };

    // Regular users can only see their own tickets
    if (req.user!.role === 'USER') {
      where.userId = req.user!.id;
    }

    const ticket = await prisma.ticket.findFirst({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(ticket);
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({ error: 'Failed to get ticket' });
  }
});

// Add message to ticket
router.post('/:id/messages', authenticate, [
  body('content').trim().isLength({ min: 1 }),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    const where: any = { id };

    // Regular users can only message their own tickets
    if (req.user!.role === 'USER') {
      where.userId = req.user!.id;
    }

    const ticket = await prisma.ticket.findFirst({ where });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const message = await prisma.ticketMessage.create({
      data: {
        ticketId: id,
        userId: req.user!.id,
        content,
        isAdmin: req.user!.role === 'ADMIN' || req.user!.role === 'SUPER_ADMIN'
      }
    });

    // Update ticket status if it's closed and user is responding
    if (ticket.status === 'CLOSED' && req.user!.role === 'USER') {
      await prisma.ticket.update({
        where: { id },
        data: { status: 'OPEN' }
      });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Add ticket message error:', error);
    res.status(500).json({ error: 'Failed to add message' });
  }
});

// Delete ticket (admin only)
router.delete('/:id', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const ticket = await prisma.ticket.findUnique({
      where: { id }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    await prisma.ticket.delete({
      where: { id }
    });

    res.json({ message: 'Ticket deleted successfully' });
  } catch (error) {
    console.error('Delete ticket error:', error);
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

export default router;
