import express, { Request, Response } from 'express';
import { body, query } from 'express-validator';
import Stripe from 'stripe';
import Razorpay from 'razorpay';

import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';

const router = express.Router();

// Initialize payment gateways
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16'
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!
});

// Get payments
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    const skip = (page - 1) * limit;

    const where: any = { userId: req.user!.id };
    if (status) where.status = status;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.payment.count({ where })
    ]);

    res.json({
      payments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

// Create Stripe payment intent
router.post('/stripe/create-intent', authenticate, [
  body('amount').isFloat({ min: 0.01 }),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'INR']),
  body('description').optional().isString(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, currency = 'USD', description } = req.body;

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        userId: req.user!.id,
        amount,
        currency,
        description,
        gateway: 'STRIPE',
        status: 'PENDING'
      }
    });

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      metadata: {
        paymentId: payment.id,
        userId: req.user!.id
      }
    });

    // Update payment with Stripe payment intent ID
    await prisma.payment.update({
      where: { id: payment.id },
      data: { gatewayPaymentId: paymentIntent.id }
    });

    res.json({
      paymentId: payment.id,
      clientSecret: paymentIntent.client_secret
    });
  } catch (error) {
    console.error('Create Stripe payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Create Razorpay order
router.post('/razorpay/create-order', authenticate, [
  body('amount').isFloat({ min: 0.01 }),
  body('currency').optional().isIn(['INR']),
  body('description').optional().isString(),
], validateRequest, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, currency = 'INR', description } = req.body;

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        userId: req.user!.id,
        amount,
        currency,
        description,
        gateway: 'RAZORPAY',
        status: 'PENDING'
      }
    });

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      notes: {
        paymentId: payment.id,
        userId: req.user!.id
      }
    });

    // Update payment with Razorpay order ID
    await prisma.payment.update({
      where: { id: payment.id },
      data: { gatewayOrderId: order.id }
    });

    res.json({
      paymentId: payment.id,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (error) {
    console.error('Create Razorpay order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Stripe webhook
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);

    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handleStripePaymentSuccess(paymentIntent);
        break;

      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object as Stripe.PaymentIntent;
        await handleStripePaymentFailure(failedPayment);
        break;

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(400).send('Webhook error');
  }
});

// Razorpay webhook
router.post('/razorpay/webhook', async (req: Request, res: Response) => {
  try {
    const { event, payload } = req.body;

    switch (event) {
      case 'payment.captured':
        await handleRazorpayPaymentSuccess(payload.payment.entity);
        break;

      case 'payment.failed':
        await handleRazorpayPaymentFailure(payload.payment.entity);
        break;

      default:
        console.log(`Unhandled Razorpay event type: ${event}`);
    }

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Razorpay webhook error:', error);
    res.status(400).send('Webhook error');
  }
});

// Get payment by ID
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json(payment);
  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({ error: 'Failed to get payment' });
  }
});

// Helper functions
async function handleStripePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  try {
    const paymentId = paymentIntent.metadata.paymentId;
    
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'COMPLETED',
        gatewayPaymentId: paymentIntent.id
      }
    });

    console.log(`Stripe payment ${paymentId} completed successfully`);
  } catch (error) {
    console.error('Handle Stripe payment success error:', error);
  }
}

async function handleStripePaymentFailure(paymentIntent: Stripe.PaymentIntent) {
  try {
    const paymentId = paymentIntent.metadata.paymentId;
    
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'FAILED',
        gatewayPaymentId: paymentIntent.id
      }
    });

    console.log(`Stripe payment ${paymentId} failed`);
  } catch (error) {
    console.error('Handle Stripe payment failure error:', error);
  }
}

async function handleRazorpayPaymentSuccess(payment: any) {
  try {
    const paymentId = payment.notes.paymentId;
    
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'COMPLETED',
        gatewayPaymentId: payment.id
      }
    });

    console.log(`Razorpay payment ${paymentId} completed successfully`);
  } catch (error) {
    console.error('Handle Razorpay payment success error:', error);
  }
}

async function handleRazorpayPaymentFailure(payment: any) {
  try {
    const paymentId = payment.notes.paymentId;
    
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'FAILED',
        gatewayPaymentId: payment.id
      }
    });

    console.log(`Razorpay payment ${paymentId} failed`);
  } catch (error) {
    console.error('Handle Razorpay payment failure error:', error);
  }
}

export default router;
