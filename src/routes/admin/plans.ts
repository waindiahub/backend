import express from 'express';
import { body, query } from 'express-validator';
import { prisma } from '../../lib/prisma';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validation';

const router = express.Router();

// All routes require admin access
router.use(authenticate);
router.use(authorize(['ADMIN', 'SUPER_ADMIN']));

// Get all plans
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [plans, total] = await Promise.all([
      prisma.plan.findMany({
        include: {
          _count: {
            select: { users: true }
          }
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.plan.count()
    ]);

    res.json({
      plans: plans.map(plan => ({
        ...plan,
        userCount: plan._count.users
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Failed to get plans' });
  }
});

// Create plan
router.post('/', [
  body('name').trim().isLength({ min: 1 }),
  body('price').isFloat({ min: 0 }),
  body('currency').optional().isIn(['USD', 'INR', 'EUR']),
  body('interval').isIn(['month', 'year']),
  body('features').isArray(),
  body('limits').isObject(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { name, description, price, currency = 'USD', interval, features, limits } = req.body;

    const plan = await prisma.plan.create({
      data: {
        name,
        description,
        price,
        currency,
        interval,
        features,
        limits,
        isActive: true
      }
    });

    res.status(201).json(plan);
  } catch (error) {
    console.error('Create plan error:', error);
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// Update plan
router.put('/:id', [
  body('name').optional().trim().isLength({ min: 1 }),
  body('price').optional().isFloat({ min: 0 }),
  body('features').optional().isArray(),
  body('limits').optional().isObject(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { name, description, price, currency, interval, features, limits, isActive } = req.body;

    const plan = await prisma.plan.update({
      where: { id },
      data: {
        name,
        description,
        price,
        currency,
        interval,
        features,
        limits,
        isActive
      }
    });

    res.json(plan);
  } catch (error) {
    console.error('Update plan error:', error);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// Delete plan
router.delete('/:id', async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;

    // Check if plan has active users
    const userCount = await prisma.user.count({
      where: { planId: id }
    });

    if (userCount > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete plan with active users',
        userCount 
      });
    }

    await prisma.plan.delete({
      where: { id }
    });

    res.json({ message: 'Plan deleted successfully' });
  } catch (error) {
    console.error('Delete plan error:', error);
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

// Get plan usage analytics
router.get('/:id/analytics', async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;

    const [plan, users, revenue] = await Promise.all([
      prisma.plan.findUnique({
        where: { id },
        include: {
          _count: { select: { users: true } }
        }
      }),
      prisma.user.findMany({
        where: { planId: id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          createdAt: true,
          quotaUsed: true
        }
      }),
      prisma.payment.aggregate({
        where: {
          user: { planId: id },
          status: 'COMPLETED'
        },
        _sum: { amount: true }
      })
    ]);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({
      plan,
      users,
      totalRevenue: revenue._sum.amount || 0,
      userCount: plan._count.users
    });
  } catch (error) {
    console.error('Get plan analytics error:', error);
    res.status(500).json({ error: 'Failed to get plan analytics' });
  }
});

export default router;