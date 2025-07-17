import express, { Request, Response } from 'express';
import { body, query } from 'express-validator';
import { prisma } from '../../lib/prisma';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validation';
import { logAuditAction } from '../../services/audit';

const router = express.Router();

router.use(authenticate);
router.use(authorize(['ADMIN', 'SUPER_ADMIN']));

// Get all users with usage stats
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString(),
  query('planId').optional().isUUID(),
  query('isActive').optional().isBoolean(),
], validateRequest, async (req: AuthRequest, res: Response) => {  // Typing `res` as `Response`
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const planId = req.query.planId as string;
    const isActive = req.query.isActive;

    const skip = (page - 1) * limit;
    const where: any = {};

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (planId) where.planId = planId;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          plan: true,
          _count: {
            select: {
              contacts: true,
              messages: true,
              campaigns: true,
              templates: true
            }
          }
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      users: users.map(user => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        isEmailVerified: user.isEmailVerified,
        plan: user.plan,
        quotaUsed: user.quotaUsed,
        planStartDate: user.planStartDate,
        planEndDate: user.planEndDate,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        usage: {
          contacts: user._count.contacts,
          messages: user._count.messages,
          campaigns: user._count.campaigns,
          templates: user._count.templates
        }
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Update user plan
router.put('/:id/plan', [
  body('planId').isUUID(),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
], validateRequest, async (req: AuthRequest, res: Response) => {  // Typing `res` as `Response`
  try {
    const { id } = req.params;
    const { planId, startDate, endDate } = req.body;

    const [user, plan] = await Promise.all([
      prisma.user.findUnique({ where: { id } }),
      prisma.plan.findUnique({ where: { id: planId } })
    ]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        planId,
        planStartDate: startDate ? new Date(startDate) : new Date(),
        planEndDate: endDate ? new Date(endDate) : null,
        quotaUsed: {} // Reset quota when changing plan
      },
      include: { plan: true }
    });

    // Log audit action
    await logAuditAction(req.user!.id, 'UPDATE_USER_PLAN', 'user', {
      userId: id,
      oldPlanId: user.planId,
      newPlanId: planId
    });

    res.json(updatedUser);
  } catch (error) {
    console.error('Update user plan error:', error);
    res.status(500).json({ error: 'Failed to update user plan' });
  }
});

// Suspend/reactivate user
router.put('/:id/status', [
  body('isActive').isBoolean(),
  body('reason').optional().isString(),
], validateRequest, async (req: AuthRequest, res: Response) => {  // Typing `res` as `Response`
  try {
    const { id } = req.params;
    const { isActive, reason } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: { isActive }
    });

    // Log audit action
    await logAuditAction(req.user!.id, isActive ? 'ACTIVATE_USER' : 'SUSPEND_USER', 'user', {
      userId: id,
      reason
    });

    res.json(user);
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Get user detailed analytics
router.get('/:id/analytics', async (req: AuthRequest, res: Response) => {  // Typing `res` as `Response`
  try {
    const { id } = req.params;

    const [user, messageStats, campaignStats, recentActivity] = await Promise.all([
      prisma.user.findUnique({
        where: { id },
        include: {
          plan: true,
          _count: {
            select: {
              contacts: true,
              messages: true,
              campaigns: true,
              templates: true,
              flows: true
            }
          }
        }
      }),
      prisma.message.groupBy({
        by: ['status'],
        where: { userId: id },
        _count: { status: true }
      }),
      prisma.campaign.groupBy({
        by: ['status'],
        where: { userId: id },
        _count: { status: true }
      }),
      prisma.auditLog.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user,
      messageStats: messageStats.reduce((acc, stat) => {
        acc[stat.status.toLowerCase()] = stat._count.status;
        return acc;
      }, {} as Record<string, number>),
      campaignStats: campaignStats.reduce((acc, stat) => {
        acc[stat.status.toLowerCase()] = stat._count.status;
        return acc;
      }, {} as Record<string, number>),
      recentActivity
    });
  } catch (error) {
    console.error('Get user analytics error:', error);
    res.status(500).json({ error: 'Failed to get user analytics' });
  }
});

// Reset user quota
router.post('/:id/reset-quota', async (req: AuthRequest, res: Response) => {  // Typing `res` as `Response`
  try {
    const { id } = req.params;

    const user = await prisma.user.update({
      where: { id },
      data: { quotaUsed: {} }
    });

    // Log audit action
    await logAuditAction(req.user!.id, 'RESET_USER_QUOTA', 'user', {
      userId: id
    });

    res.json({ message: 'User quota reset successfully', user });
  } catch (error) {
    console.error('Reset user quota error:', error);
    res.status(500).json({ error: 'Failed to reset user quota' });
  }
});

export default router;
