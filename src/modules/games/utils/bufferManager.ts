import { Server as SocketIOServer } from 'socket.io';
import { MessageBuffer } from '../models/messageBuffer.model';
import { logger } from '../../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface BufferEntry {
  taskId: string;
  roomCode: string;
  senderId: string;
  eventName: string;
  payload: any;
  expectedReceivers: Set<string>;
  acknowledgedBy: Set<string>;
  createdAt: Date;
}

class BufferManager {
  private buffers: Map<string, BufferEntry> = new Map();
  private io: SocketIOServer | null = null;

  initialize(io: SocketIOServer) {
    this.io = io;
  }

  async createBuffer(
    roomCode: string,
    senderId: string,
    eventName: string,
    payload: any,
    receiverIds: string[]
  ): Promise<string> {
    const taskId = uuidv4();
    
    const bufferEntry: BufferEntry = {
      taskId,
      roomCode,
      senderId,
      eventName,
      payload,
      expectedReceivers: new Set(receiverIds),
      acknowledgedBy: new Set(),
      createdAt: new Date()
    };
    this.buffers.set(taskId, bufferEntry);

    try {
      await MessageBuffer.create({
        taskId,
        roomCode,
        senderId,
        eventName,
        payload,
        expectedReceivers: receiverIds,
        acknowledgedBy: [],
        status: 'pending'
      });
      logger.info('✅ Buffer created', { taskId, roomCode });
    } catch (error) {
      logger.error('Error creating buffer in DB', { error, taskId });
    }

    return taskId;
  }

  async acknowledgeMessage(taskId: string, receiverId: string): Promise<boolean> {
    let buffer = this.buffers.get(taskId);
    if (!buffer) {
      const dbBuffer = await MessageBuffer.findOne({ taskId, status: 'pending' });
      if (!dbBuffer) return false;
      
      buffer = {
        taskId: dbBuffer.taskId,
        roomCode: dbBuffer.roomCode,
        senderId: dbBuffer.senderId,
        eventName: dbBuffer.eventName,
        payload: dbBuffer.payload,
        expectedReceivers: new Set(dbBuffer.expectedReceivers),
        acknowledgedBy: new Set(dbBuffer.acknowledgedBy),
        createdAt: dbBuffer.createdAt
      };
      this.buffers.set(taskId, buffer);
    }

    if (!buffer.expectedReceivers.has(receiverId)) {
      return false;
    }

    buffer.acknowledgedBy.add(receiverId);

    try {
      await MessageBuffer.updateOne(
        { taskId },
        { 
          $addToSet: { acknowledgedBy: receiverId },
          status: buffer.acknowledgedBy.size === buffer.expectedReceivers.size ? 'delivered' : 'pending'
        }
      );
    } catch (error) {
      logger.error('Error updating acknowledgment', { error, taskId });
    }

    if (buffer.acknowledgedBy.size === buffer.expectedReceivers.size) {
      await this.clearBuffer(taskId);
      return true;
    }

    return false;
  }

  async clearBuffer(taskId: string): Promise<void> {
    const buffer = this.buffers.get(taskId);
    if (!buffer) return;

    try {
      await MessageBuffer.updateOne(
        { taskId },
        { 
          status: 'cleared',
          clearedAt: new Date()
        }
      );
    } catch (error) {
      logger.error('Error clearing buffer', { error, taskId });
    }

    if (this.io && buffer.senderId) {
      try {
        const socketsInRoom = await this.io.in(buffer.roomCode).fetchSockets();
        const senderSocket = socketsInRoom.find(s => s.data?.user?.id === buffer.senderId);
        
        if (senderSocket) {
          senderSocket.emit('buffer:cleared', {
            taskId,
            roomCode: buffer.roomCode,
            eventName: buffer.eventName
          });
        }
      } catch (error) {
        logger.error('Error notifying sender', { error, taskId });
      }
    }

    this.buffers.delete(taskId);
    logger.info('✅ Buffer cleared', { taskId, roomCode: buffer.roomCode });
  }
}

export const bufferManager = new BufferManager();

