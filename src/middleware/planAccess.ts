import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from './auth';

export const checkPlanAccess = (feature: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        include: { plan: true }
      });

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Super admins have access to everything
      if (user.role === 'SUPER_ADMIN') {
        return next();
      }

      // Check if user has a plan
      if (!user.plan) {
        return res.status(403).json({ 
          error: 'No active plan',
          feature,
          upgradeRequired: true
        });
      }

      // Check if plan includes the feature
      const planFeatures = user.plan.features as string[];
      if (!planFeatures.includes(feature)) {
        return res.status(403).json({ 
          error: 'Feature not available in your plan',
          feature,
          currentPlan: user.plan.name,
          upgradeRequired: true
        });
      }

      // Check plan expiry
      if (user.planEndDate && user.planEndDate < new Date()) {
        return res.status(403).json({ 
          error: 'Plan expired',
          expiredAt: user.planEndDate,
          renewalRequired: true
        });
      }

      next();
    } catch (error) {
      console.error('Plan access check error:', error);
      res.status(500).json({ error: 'Failed to check plan access' });
    }
  };
};

export const checkUsageLimit = (resource: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        include: { plan: true }
      });

      if (!user || !user.plan) {
        return res.status(403).json({ error: 'No active plan' });
      }

      const planLimits = user.plan.limits as Record<string, number>;
      const quotaUsed = user.quotaUsed as Record<string, number>;

      const limit = planLimits[resource];
      const used = quotaUsed[resource] || 0;

      // -1 means unlimited
      if (limit !== -1 && used >= limit) {
        return res.status(403).json({ 
          error: 'Usage limit exceeded',
          resource,
          limit,
          used,
          upgradeRequired: true
        });
      }

      next();
    } catch (error) {
      console.error('Usage limit check error:', error);
      res.status(500).json({ error: 'Failed to check usage limit' });
    }
  };
};

export const incrementUsage = async (userId: string, resource: string, amount: number = 1) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { quotaUsed: true }
    });

    if (!user) return;

    const quotaUsed = user.quotaUsed as Record<string, number>;
    quotaUsed[resource] = (quotaUsed[resource] || 0) + amount;

    await prisma.user.update({
      where: { id: userId },
      data: { quotaUsed }
    });
  } catch (error) {
    console.error('Increment usage error:', error);
  }
};