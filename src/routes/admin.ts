import express from 'express';
import { Response } from 'express';
  
import { query, body } from 'express-validator';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// All admin routes require admin access
router.use(authenticate);
router.use(authorize(['ADMIN', 'SUPER_ADMIN']));

// Get dashboard statistics
router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalMessages,
      totalCampaigns,
      totalTemplates,
      pendingTemplates,
      totalPayments,
      recentUsers
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.message.count(),
      prisma.campaign.count(),
      prisma.template.count(),
      prisma.template.count({ where: { status: 'PENDING' } }),
      prisma.payment.count({ where: { status: 'COMPLETED' } }),
      prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true
        }
      })
    ]);

    // Get message stats for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const messageStats = await prisma.message.groupBy({
      by: ['status'],
      where: {
        timestamp: { gte: thirtyDaysAgo }
      },
      _count: { status: true }
    });

    // Get daily user registrations for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyRegistrations = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM users 
      WHERE created_at >= ${sevenDaysAgo}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    res.json({
      overview: {
        totalUsers,
        activeUsers,
        totalMessages,
        totalCampaigns,
        totalTemplates,
        pendingTemplates,
        totalPayments
      },
      messageStats: messageStats.reduce((acc, stat) => {
        acc[stat.status.toLowerCase()] = stat._count.status;
        return acc;
      }, {} as Record<string, number>),
      dailyRegistrations,
      recentUsers
    });
  } catch (error) {
    console.error('Get admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

// Get all users with pagination
router.get('/users', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString(),
  query('role').optional().isIn(['USER', 'ADMIN', 'SUPER_ADMIN']),
  query('isActive').optional().isBoolean(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const role = req.query.role as string;
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

    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          isEmailVerified: true,
          createdAt: true,
          lastLogin: true,
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
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Update user
router.put('/users/:id', [
  body('firstName').optional().trim().isLength({ min: 1 }),
  body('lastName').optional().trim().isLength({ min: 1 }),
  body('role').optional().isIn(['USER', 'ADMIN', 'SUPER_ADMIN']),
  body('isActive').optional().isBoolean(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, role, isActive } = req.body;

    // Prevent non-super-admin from modifying super-admin users
    if (req.user!.role !== 'SUPER_ADMIN') {
      const targetUser = await prisma.user.findUnique({
        where: { id },
        select: { role: true }
      });

      if (targetUser?.role === 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Cannot modify super admin users' });
      }

      // Prevent promoting to super admin
      if (role === 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Cannot promote to super admin' });
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        firstName,
        lastName,
        role,
        isActive
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true
      }
    });

    res.json(user);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user
router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Prevent deleting self
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Prevent non-super-admin from deleting super-admin users
    if (req.user!.role !== 'SUPER_ADMIN') {
      const targetUser = await prisma.user.findUnique({
        where: { id },
        select: { role: true }
      });

      if (targetUser?.role === 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Cannot delete super admin users' });
      }
    }

    await prisma.user.delete({
      where: { id }
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get all templates for approval
router.get('/templates', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['PENDING', 'APPROVED', 'REJECTED']),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;

    const [templates, total] = await Promise.all([
      prisma.template.findMany({
        where,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true
            }
          }
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.template.count({ where })
    ]);

    res.json({
      templates,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get admin templates error:', error);
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

// Get system analytics
router.get('/analytics', [
  query('days').optional().isInt({ min: 1, max: 365 }),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get daily message counts
    const dailyMessages = await prisma.$queryRaw`
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as total,
        COUNT(CASE WHEN direction = 'OUTBOUND' THEN 1 END) as sent,
        COUNT(CASE WHEN direction = 'INBOUND' THEN 1 END) as received
      FROM messages 
      WHERE timestamp >= ${startDate}
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
    `;

    // Get daily user registrations
    const dailyRegistrations = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM users 
      WHERE created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    // Get campaign performance
    const campaignStats = await prisma.campaign.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: startDate }
      },
      _count: { status: true }
    });

    // Get payment stats
    const paymentStats = await prisma.payment.groupBy({
      by: ['status', 'gateway'],
      where: {
        createdAt: { gte: startDate }
      },
      _sum: { amount: true },
      _count: { status: true }
    });

    res.json({
      dailyMessages,
      dailyRegistrations,
      campaignStats: campaignStats.reduce((acc, stat) => {
        acc[stat.status.toLowerCase()] = stat._count.status;
        return acc;
      }, {} as Record<string, number>),
      paymentStats
    });
  } catch (error) {
    console.error('Get admin analytics error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

export default router;