import express from 'express';
import { body, query } from 'express-validator';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// Get flows
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [flows, total] = await Promise.all([
      prisma.flow.findMany({
        where: { userId: req.user!.id },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.flow.count({ where: { userId: req.user!.id } })
    ]);

    res.json({
      flows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get flows error:', error);
    res.status(500).json({ error: 'Failed to get flows' });
  }
});

// Create flow
router.post('/', authenticate, [
  body('name').trim().isLength({ min: 1 }),
  body('nodes').isArray(),
  body('edges').isArray(),
  body('triggers').isArray(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { name, description, nodes, edges, triggers } = req.body;

    const flow = await prisma.flow.create({
      data: {
        userId: req.user!.id,
        name,
        description,
        nodes,
        edges,
        triggers,
        isActive: false
      }
    });

    res.status(201).json(flow);
  } catch (error) {
    console.error('Create flow error:', error);
    res.status(500).json({ error: 'Failed to create flow' });
  }
});

// Update flow
router.put('/:id', authenticate, [
  body('name').optional().trim().isLength({ min: 1 }),
  body('nodes').optional().isArray(),
  body('edges').optional().isArray(),
  body('triggers').optional().isArray(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { name, description, nodes, edges, triggers } = req.body;

    const flow = await prisma.flow.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!flow) {
      return res.status(404).json({ error: 'Flow not found' });
    }

    const updatedFlow = await prisma.flow.update({
      where: { id },
      data: {
        name,
        description,
        nodes,
        edges,
        triggers
      }
    });

    res.json(updatedFlow);
  } catch (error) {
    console.error('Update flow error:', error);
    res.status(500).json({ error: 'Failed to update flow' });
  }
});

// Toggle flow active status
router.post('/:id/toggle', authenticate, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;

    const flow = await prisma.flow.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!flow) {
      return res.status(404).json({ error: 'Flow not found' });
    }

    const updatedFlow = await prisma.flow.update({
      where: { id },
      data: { isActive: !flow.isActive }
    });

    res.json(updatedFlow);
  } catch (error) {
    console.error('Toggle flow error:', error);
    res.status(500).json({ error: 'Failed to toggle flow' });
  }
});

// Get flow by ID
router.get('/:id', authenticate, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;

    const flow = await prisma.flow.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!flow) {
      return res.status(404).json({ error: 'Flow not found' });
    }

    res.json(flow);
  } catch (error) {
    console.error('Get flow error:', error);
    res.status(500).json({ error: 'Failed to get flow' });
  }
});

// Delete flow
router.delete('/:id', authenticate, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;

    const flow = await prisma.flow.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!flow) {
      return res.status(404).json({ error: 'Flow not found' });
    }

    await prisma.flow.delete({
      where: { id }
    });

    res.json({ message: 'Flow deleted successfully' });
  } catch (error) {
    console.error('Delete flow error:', error);
    res.status(500).json({ error: 'Failed to delete flow' });
  }
});

// Execute flow (for testing)
router.post('/:id/execute', authenticate, [
  body('contactId').isUUID(),
  body('triggerData').optional().isObject(),
], validateRequest, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { contactId, triggerData = {} } = req.body;

    const flow = await prisma.flow.findFirst({
      where: {
        id,
        userId: req.user!.id,
        isActive: true
      }
    });

    if (!flow) {
      return res.status(404).json({ error: 'Flow not found or inactive' });
    }

    // Verify contact belongs to user
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        userId: req.user!.id
      }
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Execute flow (simplified version)
    const result = await executeFlow(flow, contact, triggerData);

    res.json({
      message: 'Flow executed successfully',
      result
    });
  } catch (error) {
    console.error('Execute flow error:', error);
    res.status(500).json({ error: 'Failed to execute flow' });
  }
});

// Simplified flow execution function
async function executeFlow(flow: any, contact: any, triggerData: any) {
  try {
    const { nodes, edges } = flow;
    const results = [];

    // Find start node
    const startNode = nodes.find((node: any) => node.type === 'trigger');
    if (!startNode) {
      throw new Error('No trigger node found');
    }

    // Execute nodes in sequence (simplified)
    let currentNodeId = startNode.id;
    const executedNodes = new Set();

    while (currentNodeId && !executedNodes.has(currentNodeId)) {
      executedNodes.add(currentNodeId);
      
      const currentNode = nodes.find((node: any) => node.id === currentNodeId);
      if (!currentNode) break;

      const result = await executeNode(currentNode, contact, flow.userId);
      results.push(result);

      // Find next node
      const nextEdge = edges.find((edge: any) => edge.source === currentNodeId);
      currentNodeId = nextEdge?.target;
    }

    return results;
  } catch (error) {
    console.error('Flow execution error:', error);
    throw error;
  }
}

async function executeNode(node: any, contact: any, userId: string) {
  const { type, data } = node;

  switch (type) {
    case 'action':
      if (data.actionType === 'send_message') {
        // Create message record
        const message = await prisma.message.create({
          data: {
            userId,
            whatsappAccountId: '00000000-0000-0000-0000-000000000000',
            contactId: contact.id,
            direction: 'OUTBOUND',
            type: 'TEXT',
            content: data.message || 'Flow message',
            status: 'SENT'
          }
        });
        return { type: 'message_sent', messageId: message.id };
      }
      break;

    case 'delay':
      // In a real implementation, this would schedule the next action
      return { type: 'delay', duration: data.delayValue, unit: data.delayUnit };

    case 'condition':
      // Evaluate condition (simplified)
      return { type: 'condition', result: true };

    default:
      return { type: 'unknown', nodeType: type };
  }

  return { type: 'executed', nodeType: type };
}

export default router;