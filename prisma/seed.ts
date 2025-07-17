import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create basic plan
  console.log('📦 Creating basic plan...');
  const basicPlan = await prisma.plan.upsert({
    where: { name: 'Basic Plan' },
    update: {},
    create: {
      name: 'Basic Plan',
      description: 'Perfect for small businesses getting started with WhatsApp marketing',
      price: 29.99,
      currency: 'USD',
      interval: 'month',
      isActive: true,
      features: [
        'Up to 1,000 contacts',
        '5,000 messages per month',
        'Basic templates',
        'Campaign scheduling',
        'Email support',
        'Basic analytics'
      ],
      limits: {
        contacts: 1000,
        messages: 5000,
        campaigns: 10,
        templates: 20,
        flows: 5,
        apiKeys: 2
      }
    }
  });

  // Create pro plan
  console.log('📦 Creating pro plan...');
  const proPlan = await prisma.plan.upsert({
    where: { name: 'Pro Plan' },
    update: {},
    create: {
      name: 'Pro Plan',
      description: 'Advanced features for growing businesses',
      price: 79.99,
      currency: 'USD',
      interval: 'month',
      isActive: true,
      features: [
        'Up to 10,000 contacts',
        '50,000 messages per month',
        'Advanced templates',
        'Flow automation',
        'AI chatbot',
        'Priority support',
        'Advanced analytics',
        'API access'
      ],
      limits: {
        contacts: 10000,
        messages: 50000,
        campaigns: 50,
        templates: 100,
        flows: 25,
        apiKeys: 10
      }
    }
  });

  // Create enterprise plan
  console.log('📦 Creating enterprise plan...');
  const enterprisePlan = await prisma.plan.upsert({
    where: { name: 'Enterprise Plan' },
    update: {},
    create: {
      name: 'Enterprise Plan',
      description: 'Unlimited features for large organizations',
      price: 199.99,
      currency: 'USD',
      interval: 'month',
      isActive: true,
      features: [
        'Unlimited contacts',
        'Unlimited messages',
        'Custom templates',
        'Advanced automation',
        'AI chatbot with custom training',
        '24/7 dedicated support',
        'Custom integrations',
        'White-label options',
        'Advanced API access'
      ],
      limits: {
        contacts: -1, // -1 means unlimited
        messages: -1,
        campaigns: -1,
        templates: -1,
        flows: -1,
        apiKeys: -1
      }
    }
  });

  // Hash passwords
  const userPassword = await bcrypt.hash('demo123', 12);
  const adminPassword = await bcrypt.hash('admin123', 12);

  // Create demo user
  console.log('👤 Creating demo user...');
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@whatsapphub.com' },
    update: {},
    create: {
      email: 'demo@whatsapphub.com',
      password: userPassword,
      firstName: 'Demo',
      lastName: 'User',
      phone: '+1234567890',
      role: 'USER',
      isActive: true,
      isEmailVerified: true,
      planId: basicPlan.id,
      planStartDate: new Date(),
      planEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      quotaUsed: {
        contacts: 0,
        messages: 0,
        campaigns: 0,
        templates: 0,
        flows: 0
      }
    }
  });

  // Create demo admin
  console.log('👨‍💼 Creating demo admin...');
  const demoAdmin = await prisma.user.upsert({
    where: { email: 'admin@whatsapphub.com' },
    update: {},
    create: {
      email: 'admin@whatsapphub.com',
      password: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      phone: '+1234567891',
      role: 'ADMIN',
      isActive: true,
      isEmailVerified: true,
      planId: enterprisePlan.id,
      planStartDate: new Date(),
      planEndDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
      quotaUsed: {
        contacts: 0,
        messages: 0,
        campaigns: 0,
        templates: 0,
        flows: 0
      }
    }
  });

  // Create sample tags
  console.log('🏷️ Creating sample tags...');
  const customerTag = await prisma.tag.upsert({
    where: { name: 'Customer' },
    update: {},
    create: {
      name: 'Customer',
      color: '#10B981',
      description: 'Existing customers'
    }
  });

  const prospectTag = await prisma.tag.upsert({
    where: { name: 'Prospect' },
    update: {},
    create: {
      name: 'Prospect',
      color: '#3B82F6',
      description: 'Potential customers'
    }
  });

  const vipTag = await prisma.tag.upsert({
    where: { name: 'VIP' },
    update: {},
    create: {
      name: 'VIP',
      color: '#F59E0B',
      description: 'VIP customers'
    }
  });

  // Create sample contacts for demo user
  console.log('📞 Creating sample contacts...');
  const contact1 = await prisma.contact.create({
    data: {
      userId: demoUser.id,
      phone: '+1234567892',
      name: 'John Doe',
      email: 'john@example.com',
      source: 'MANUAL',
      isBlocked: false,
      customFields: {
        company: 'Acme Corp',
        position: 'Manager'
      }
    }
  });

  const contact2 = await prisma.contact.create({
    data: {
      userId: demoUser.id,
      phone: '+1234567893',
      name: 'Jane Smith',
      email: 'jane@example.com',
      source: 'IMPORT',
      isBlocked: false,
      customFields: {
        company: 'Tech Solutions',
        position: 'CEO'
      }
    }
  });

  // Add tags to contacts
  await prisma.contactTag.createMany({
    data: [
      { contactId: contact1.id, tagId: customerTag.id },
      { contactId: contact2.id, tagId: prospectTag.id },
      { contactId: contact2.id, tagId: vipTag.id }
    ]
  });

  // Create sample template for demo user
console.log('📝 Creating sample template...');
await prisma.template.create({
  data: {
    userId: demoUser.id,
    whatsappAccountId: demoWhatsAppAccount.id,
    name: 'Welcome Message',
    category: 'UTILITY',
    language: 'en',
    status: 'APPROVED',
    components: [
      {
        type: 'body',
        text: 'Welcome to our service, {{1}}! We\'re excited to have you on board.',
        example: {
          body_text: [['John']]
        }
      }
    ],
    variables: ['name']
  }
});

  // Create audit log entries
  console.log('📋 Creating audit logs...');
  await prisma.auditLog.createMany({
    data: [
      {
        userId: demoUser.id,
        action: 'USER_CREATED',
        resource: 'user',
        details: { email: demoUser.email },
        ipAddress: '127.0.0.1'
      },
      {
        userId: demoAdmin.id,
        action: 'ADMIN_CREATED',
        resource: 'user',
        details: { email: demoAdmin.email },
        ipAddress: '127.0.0.1'
      }
    ]
  });

  console.log('✅ Database seeding completed successfully!');
  console.log('\n🔐 Demo Credentials:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('User Email: demo@whatsapphub.com | Password: demo123');
  console.log('Admin Email: admin@whatsapphub.com | Password: admin123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch(e => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
