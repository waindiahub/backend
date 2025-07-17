import express, { Response } from 'express';
import { body, query } from 'express-validator';
import { prisma } from '../lib/prisma';
import { ContactSource } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { checkPlanAccess } from '../middleware/planAccess';

const router = express.Router();

// Get form builders
router.get('/', authenticate, checkPlanAccess('forms'), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [forms, total] = await Promise.all([
      prisma.formBuilder.findMany({
        where: { userId: req.user!.id },
        include: {
          _count: { select: { submissions: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.formBuilder.count({ where: { userId: req.user!.id } }),
    ]);

    res.json({
      forms: forms.map((form) => ({
        ...form,
        submissionCount: form._count.submissions,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get forms error:', error);
    res.status(500).json({ error: 'Failed to get forms' });
  }
});

// Create form builder
router.post('/', authenticate, checkPlanAccess('forms'), [
  body('name').trim().isLength({ min: 1 }),
  body('fields').isArray({ min: 1 }),
  body('settings').optional().isObject(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, fields, settings = {} } = req.body;

    for (const field of fields) {
      if (!field.type || !field.label) {
        return res.status(400).json({ error: 'Each field must have type and label' });
      }
    }

    const form = await prisma.formBuilder.create({
      data: {
        userId: req.user!.id,
        name,
        description,
        fields,
        settings,
        isActive: true,
      },
    });

    res.status(201).json(form);
  } catch (error) {
    console.error('Create form error:', error);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// Update form builder
router.put('/:id', authenticate, checkPlanAccess('forms'), [
  body('name').optional().trim().isLength({ min: 1 }),
  body('fields').optional().isArray({ min: 1 }),
  body('settings').optional().isObject(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, fields, settings, isActive } = req.body;

    const form = await prisma.formBuilder.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const updatedForm = await prisma.formBuilder.update({
      where: { id },
      data: { name, description, fields, settings, isActive },
    });

    res.json(updatedForm);
  } catch (error) {
    console.error('Update form error:', error);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// Get form submissions
router.get('/:id/submissions', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const form = await prisma.formBuilder.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const [submissions, total] = await Promise.all([
      prisma.formSubmission.findMany({
        where: { formId: id },
        include: {
          contact: {
            select: { id: true, name: true, phone: true, email: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.formSubmission.count({ where: { formId: id } }),
    ]);

    res.json({
      submissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get form submissions error:', error);
    res.status(500).json({ error: 'Failed to get form submissions' });
  }
});

// Public form submission (e.g. from WhatsApp webview)
router.post('/:id/submit', [
  body('data').isObject(),
  body('contactPhone').isMobilePhone('en-US'),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { data, contactPhone } = req.body;

    const form = await prisma.formBuilder.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!form || !form.isActive) {
      return res.status(404).json({ error: 'Form not found or inactive' });
    }

    let contact = await prisma.contact.findFirst({
      where: { userId: form.userId, phone: contactPhone },
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          userId: form.userId,
          phone: contactPhone,
          name: data.name || 'Form Submission',
          email: data.email,
          source: ContactSource.FORM // ✅ Correct enum reference
        },
      });
    }

    const submission = await prisma.formSubmission.create({
      data: {
        formId: id,
        contactId: contact.id,
        userId: form.userId,
        data,
        source: 'whatsapp',
      },
    });

    req.app.get('io').to(`user:${form.userId}`).emit('form_submission', {
      form,
      submission,
      contact,
    });

    res.json({
      message: 'Form submitted successfully',
      submissionId: submission.id,
    });
  } catch (error) {
    console.error('Submit form error:', error);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

// Generate form webview URL
router.get('/:id/webview-url', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const form = await prisma.formBuilder.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const webviewUrl = `${process.env.CLIENT_URL}/forms/${id}/webview`;

    res.json({ webviewUrl });
  } catch (error) {
    console.error('Get webview URL error:', error);
    res.status(500).json({ error: 'Failed to get webview URL' });
  }
});

// Delete form
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const form = await prisma.formBuilder.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    await prisma.formBuilder.delete({ where: { id } });

    res.json({ message: 'Form deleted successfully' });
  } catch (error) {
    console.error('Delete form error:', error);
    res.status(500).json({ error: 'Failed to delete form' });
  }
});

export default router;
