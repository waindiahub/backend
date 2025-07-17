import express from 'express';
import { body, query } from 'express-validator';
import axios from 'axios';

import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// Get templates
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['PENDING', 'APPROVED', 'REJECTED']),
  query('category').optional().isIn(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const category = req.query.category as string;

    const skip = (page - 1) * limit;

    const where: any = { userId: req.user!.id };

    if (status) where.status = status;
    if (category) where.category = category;

    const [templates, total] = await Promise.all([
      prisma.template.findMany({
        where,
        include: {
          whatsappAccount: {
            select: {
              displayName: true,
              phoneNumberId: true
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
    console.error('Get templates error:', error);
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

// Create template
router.post('/', authenticate, [
  body('whatsappAccountId').isUUID(),
  body('name').trim().isLength({ min: 1 }),
  body('category').isIn(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  body('language').isLength({ min: 2, max: 5 }),
  body('components').isArray({ min: 1 }),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { whatsappAccountId, name, category, language, components, variables = [] } = req.body;

    // Verify WhatsApp account belongs to user
    const whatsappAccount = await prisma.whatsAppAccount.findFirst({
      where: {
        id: whatsappAccountId,
        userId: req.user!.id
      }
    });

    if (!whatsappAccount) {
      return res.status(404).json({ error: 'WhatsApp account not found' });
    }

    // Create template in database
    const template = await prisma.template.create({
      data: {
        userId: req.user!.id,
        whatsappAccountId,
        name,
        category,
        language,
        components,
        variables,
        status: 'PENDING'
      }
    });

    // Submit template to WhatsApp for approval
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${whatsappAccount.businessAccountId}/message_templates`,
        {
          name,
          category: category.toLowerCase(),
          language,
          components
        },
        {
          headers: {
            'Authorization': `Bearer ${whatsappAccount.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (whatsappError) {
      console.error('WhatsApp template submission error:', whatsappError);
      // Continue with local template creation even if WhatsApp submission fails
    }

    res.status(201).json(template);
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Update template
router.put('/:id', authenticate, [
  body('name').optional().trim().isLength({ min: 1 }),
  body('category').optional().isIn(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  body('components').optional().isArray({ min: 1 }),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { name, category, components, variables } = req.body;

    const template = await prisma.template.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (template.status === 'APPROVED') {
      return res.status(400).json({ error: 'Cannot edit approved template' });
    }

    const updatedTemplate = await prisma.template.update({
      where: { id },
      data: {
        name,
        category,
        components,
        variables,
        status: 'PENDING' // Reset to pending when edited
      }
    });

    res.json(updatedTemplate);
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete template
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const template = await prisma.template.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await prisma.template.delete({
      where: { id }
    });

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Get template by ID
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const template = await prisma.template.findFirst({
      where: {
        id,
        userId: req.user!.id
      },
      include: {
        whatsappAccount: {
          select: {
            displayName: true,
            phoneNumberId: true
          }
        }
      }
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

// Admin: Approve/Reject template
router.put('/:id/status', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), [
  body('status').isIn(['APPROVED', 'REJECTED']),
  body('rejectionReason').optional().isString(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    const template = await prisma.template.findUnique({
      where: { id }
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const updatedTemplate = await prisma.template.update({
      where: { id },
      data: {
        status,
        rejectionReason: status === 'REJECTED' ? rejectionReason : null
      }
    });

    res.json(updatedTemplate);
  } catch (error) {
    console.error('Update template status error:', error);
    res.status(500).json({ error: 'Failed to update template status' });
  }
});

export default router;