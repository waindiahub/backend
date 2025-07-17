import { prisma } from '../lib/prisma';

export async function logAuditAction(
  userId: string,
  action: string,
  resource: string,
  details?: any,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        resource,
        details,
        ipAddress,
        userAgent
      }
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

export async function getAuditLogs(
  userId?: string,
  resource?: string,
  page: number = 1,
  limit: number = 50
) {
  try {
    const where: any = {};
    if (userId) where.userId = userId;
    if (resource) where.resource = resource;

    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
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
      prisma.auditLog.count({ where })
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('Get audit logs error:', error);
    throw error;
  }
}