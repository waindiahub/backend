import express, { Request, Response } from 'express';
import { body, query } from 'express-validator';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// Get API keys
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [apiKeys, total] = await Promise.all([
      prisma.apiKey.findMany({
        where: { userId: req.user!.id },
        select: {
          id: true,
          name: true,
          key: true,
          scopes: true,
          isActive: true,
          lastUsedAt: true,
          expiresAt: true,
          createdAt: true
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.apiKey.count({ where: { userId: req.user!.id } })
    ]);

    // Mask API keys for security
    const maskedApiKeys = apiKeys.map(key => ({
      ...key,
      key: `${key.key.substring(0, 8)}...${key.key.substring(key.key.length - 4)}`
    }));

    res.json({
      apiKeys: maskedApiKeys,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get API keys error:', error);
    res.status(500).json({ error: 'Failed to get API keys' });
  }
});

// Create API key
router.post('/', authenticate, [
  body('name').trim().isLength({ min: 1 }),
  body('scopes').isArray({ min: 1 }),
  body('expiresAt').optional().isISO8601(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { name, scopes, expiresAt } = req.body;

    // Validate scopes
    const validScopes = [
      'CONTACTS_READ', 'CONTACTS_WRITE',
      'MESSAGES_READ', 'MESSAGES_WRITE',
      'TEMPLATES_READ', 'TEMPLATES_WRITE',
      'CAMPAIGNS_READ', 'CAMPAIGNS_WRITE',
      'ANALYTICS_READ'
    ];

    const invalidScopes = scopes.filter((scope: string) => !validScopes.includes(scope));
    if (invalidScopes.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid scopes', 
        invalidScopes 
      });
    }

    // Generate API key
    const key = `wap_${crypto.randomBytes(32).toString('hex')}`;

    const apiKey = await prisma.apiKey.create({
      data: {
        userId: req.user!.id,
        name,
        key,
        scopes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: true
      }
    });

    res.status(201).json({
      ...apiKey,
      message: 'API key created successfully. Please save it securely as it won\'t be shown again.'
    });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Update API key
router.put('/:id', authenticate, [
  body('name').optional().trim().isLength({ min: 1 }),
  body('scopes').optional().isArray({ min: 1 }),
  body('isActive').optional().isBoolean(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, scopes, isActive } = req.body;

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    const updateData: any = {};

    if (name) updateData.name = name;
    if (scopes) {
      // Validate scopes
      const validScopes = [
        'CONTACTS_READ', 'CONTACTS_WRITE',
        'MESSAGES_READ', 'MESSAGES_WRITE',
        'TEMPLATES_READ', 'TEMPLATES_WRITE',
        'CAMPAIGNS_READ', 'CAMPAIGNS_WRITE',
        'ANALYTICS_READ'
      ];

      const invalidScopes = scopes.filter((scope: string) => !validScopes.includes(scope));
      if (invalidScopes.length > 0) {
        return res.status(400).json({ 
          error: 'Invalid scopes', 
          invalidScopes 
        });
      }

      updateData.scopes = scopes;
    }
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedApiKey = await prisma.apiKey.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        scopes: true,
        isActive: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true
      }
    });

    res.json(updatedApiKey);
  } catch (error) {
    console.error('Update API key error:', error);
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// Delete API key
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    await prisma.apiKey.delete({
      where: { id }
    });

    res.json({ message: 'API key deleted successfully' });
  } catch (error) {
    console.error('Delete API key error:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Regenerate API key
router.post('/:id/regenerate', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    // Generate new key
    const newKey = `wap_${crypto.randomBytes(32).toString('hex')}`;

    const updatedApiKey = await prisma.apiKey.update({
      where: { id },
      data: { key: newKey }
    });

    res.json({
      ...updatedApiKey,
      message: 'API key regenerated successfully. Please save it securely as it won\'t be shown again.'
    });
  } catch (error) {
    console.error('Regenerate API key error:', error);
    res.status(500).json({ error: 'Failed to regenerate API key' });
  }
});

export default router;
