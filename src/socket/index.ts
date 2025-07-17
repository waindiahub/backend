import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export const initializeSocket = (io: Server) => {
  // Authentication middleware for socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user || !user.isActive) {
        return next(new Error('Authentication error'));
      }

      socket.data.userId = user.id;
      socket.data.userRole = user.role;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.data.userId} connected`);

    // Join user-specific room
    socket.join(`user:${socket.data.userId}`);

    // Join admin room if user is admin
    if (socket.data.userRole === 'ADMIN' || socket.data.userRole === 'SUPER_ADMIN') {
      socket.join('admin');
    }

    // Handle chat messages
    socket.on('send_message', async (data) => {
      try {
        const { contactId, content, type = 'text' } = data;

        // Verify contact belongs to user
        const contact = await prisma.contact.findFirst({
          where: {
            id: contactId,
            userId: socket.data.userId
          }
        });

        if (!contact) {
          socket.emit('error', { message: 'Contact not found' });
          return;
        }

        // Save message to database
        const message = await prisma.message.create({
          data: {
            user: { connect: { id: socket.data.userId } }, // User relation
            contact: { connect: { id: contactId } }, // Contact relation
            whatsappAccount: { connect: { id: 'some-whatsapp-account-id' } }, // Replace with actual account ID or remove if not needed
            direction: 'OUTBOUND',
            type: type.toUpperCase(),
            content,
            status: 'SENT'
          },
          include: {
            contact: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            },
            user: { // Include user data for response
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        });

        // Emit to user's room
        io.to(`user:${socket.data.userId}`).emit('message_sent', message);

        // TODO: Send actual WhatsApp message
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle support ticket messages
    socket.on('send_ticket_message', async (data) => {
      try {
        const { ticketId, content } = data;

        // Verify ticket access
        const ticket = await prisma.ticket.findFirst({
          where: {
            id: ticketId,
            userId: socket.data.userId
          }
        });

        if (!ticket) {
          socket.emit('error', { message: 'Ticket not found' });
          return;
        }

        // Save ticket message
        const ticketMessage = await prisma.ticketMessage.create({
          data: {
            ticketId,
            userId: socket.data.userId,
            content,
            isAdmin: socket.data.userRole === 'ADMIN' || socket.data.userRole === 'SUPER_ADMIN'
          }
        });

        // Emit to user and admin rooms
        io.to(`user:${socket.data.userId}`).emit('ticket_message', ticketMessage);
        io.to('admin').emit('ticket_message', ticketMessage);
      } catch (error) {
        console.error('Send ticket message error:', error);
        socket.emit('error', { message: 'Failed to send ticket message' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', (data) => {
      socket.to(`user:${socket.data.userId}`).emit('user_typing', {
        userId: socket.data.userId,
        contactId: data.contactId
      });
    });

    socket.on('typing_stop', (data) => {
      socket.to(`user:${socket.data.userId}`).emit('user_stop_typing', {
        userId: socket.data.userId,
        contactId: data.contactId
      });
    });

    socket.on('disconnect', () => {
      console.log(`User ${socket.data.userId} disconnected`);
    });
  });

  return io;
};

// Helper function to emit to specific user
export const emitToUser = (io: Server, userId: string, event: string, data: any) => {
  io.to(`user:${userId}`).emit(event, data);
};

// Helper function to emit to all admins
export const emitToAdmins = (io: Server, event: string, data: any) => {
  io.to('admin').emit(event, data);
};
