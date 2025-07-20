import { db } from '../lib/firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export interface Room {
  id: string;
  name: string;
  status: 'Available' | 'Booked' | 'Maintenance';
  type: string;
  price: number; // legacy field for backward compatibility
  monthlyPrice: number; // legacy field for backward compatibility
  pricing?: {
    weekly: number;
    monthly: number;
    semester: number; // 6 months
    yearly: number;
  };
  description: string;
  facilities: string[];
  images: string[];
  maxOccupancy: number;
  size: number;
  currentBooking?: {
    bookingId: string;
    tenantId: string;
    checkIn: Date;
    checkOut: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const roomsCollection = db.collection('rooms');

export async function getAllRooms(): Promise<Room[]> {
  try {
    const snapshot = await roomsCollection.get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      const room = {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        currentBooking: data.currentBooking ? {
          ...data.currentBooking,
          checkIn: data.currentBooking.checkIn?.toDate() || new Date(),
          checkOut: data.currentBooking.checkOut?.toDate() || new Date(),
        } : undefined
      } as Room;

      // Generate pricing structure if it doesn't exist
      if (!room.pricing && room.monthlyPrice) {
        room.pricing = {
          weekly: Math.round(room.monthlyPrice * 0.3),
          monthly: room.monthlyPrice,
          semester: Math.round(room.monthlyPrice * 5.5), // 6 months with discount
          yearly: Math.round(room.monthlyPrice * 10) // 12 months with discount
        };
      }

      return room;
    });
  } catch (error) {
    console.error('Error fetching rooms:', error);
    throw error;
  }
}

export async function getRoomById(roomId: string): Promise<Room | null> {
  try {
    const doc = await roomsCollection.doc(roomId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data()!;
    const room = {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date(),
      currentBooking: data.currentBooking ? {
        ...data.currentBooking,
        checkIn: data.currentBooking.checkIn?.toDate() || new Date(),
        checkOut: data.currentBooking.checkOut?.toDate() || new Date(),
      } : undefined
    } as Room;

    // Generate pricing structure if it doesn't exist
    if (!room.pricing && room.monthlyPrice) {
      room.pricing = {
        weekly: Math.round(room.monthlyPrice * 0.3),
        monthly: room.monthlyPrice,
        semester: Math.round(room.monthlyPrice * 5.5), // 6 months with discount
        yearly: Math.round(room.monthlyPrice * 10) // 12 months with discount
      };
    }

    return room;
  } catch (error) {
    console.error('Error fetching room:', error);
    throw error;
  }
}

export async function createRoom(roomData: Omit<Room, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const timestamp = Timestamp.now();
    
    // Clean the data to remove undefined values
    const cleanedData: any = {
      name: roomData.name,
      status: roomData.status || 'Available',
      type: roomData.type,
      price: roomData.price,
      monthlyPrice: roomData.monthlyPrice,
      description: roomData.description,
      facilities: roomData.facilities || [],
      images: roomData.images || [],
      maxOccupancy: roomData.maxOccupancy,
      size: roomData.size,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Add pricing if provided, otherwise generate from monthlyPrice
    if (roomData.pricing) {
      cleanedData.pricing = roomData.pricing;
    } else if (roomData.monthlyPrice) {
      // Generate default pricing structure
      cleanedData.pricing = {
        weekly: Math.round(roomData.monthlyPrice * 0.3),
        monthly: roomData.monthlyPrice,
        semester: Math.round(roomData.monthlyPrice * 5.5), // 6 months with discount
        yearly: Math.round(roomData.monthlyPrice * 10) // 12 months with discount
      };
    }

    // Only add currentBooking if it exists and is not undefined
    if (roomData.currentBooking) {
      cleanedData.currentBooking = {
        ...roomData.currentBooking,
        checkIn: Timestamp.fromDate(roomData.currentBooking.checkIn),
        checkOut: Timestamp.fromDate(roomData.currentBooking.checkOut),
      };
    }
    
    const docRef = await roomsCollection.add(cleanedData);
    
    console.log(`📦 Room created with ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error('Error creating room:', error);
    throw error;
  }
}

export async function updateRoom(roomId: string, updateData: Partial<Omit<Room, 'id' | 'createdAt'>>): Promise<void> {
  try {
    const timestamp = Timestamp.now();
    
    // Clean the data to remove undefined values
    const dataToUpdate: any = {
      updatedAt: timestamp
    };
    
    // Only add defined values
    if (updateData.name !== undefined) dataToUpdate.name = updateData.name;
    if (updateData.status !== undefined) dataToUpdate.status = updateData.status;
    if (updateData.type !== undefined) dataToUpdate.type = updateData.type;
    if (updateData.price !== undefined) dataToUpdate.price = updateData.price;
    if (updateData.monthlyPrice !== undefined) dataToUpdate.monthlyPrice = updateData.monthlyPrice;
    if (updateData.pricing !== undefined) dataToUpdate.pricing = updateData.pricing;
    if (updateData.description !== undefined) dataToUpdate.description = updateData.description;
    if (updateData.facilities !== undefined) dataToUpdate.facilities = updateData.facilities;
    if (updateData.images !== undefined) dataToUpdate.images = updateData.images;
    if (updateData.maxOccupancy !== undefined) dataToUpdate.maxOccupancy = updateData.maxOccupancy;
    if (updateData.size !== undefined) dataToUpdate.size = updateData.size;
    
    // Handle currentBooking specially
    if (updateData.currentBooking !== undefined) {
      if (updateData.currentBooking === null) {
        // Remove currentBooking field
        dataToUpdate.currentBooking = FieldValue.delete();
      } else {
        // Update currentBooking with timestamp conversion
        dataToUpdate.currentBooking = {
          ...updateData.currentBooking,
          checkIn: Timestamp.fromDate(updateData.currentBooking.checkIn),
          checkOut: Timestamp.fromDate(updateData.currentBooking.checkOut),
        };
      }
    }
    
    await roomsCollection.doc(roomId).update(dataToUpdate);
    console.log(`✏️ Room updated: ${roomId}`);
  } catch (error) {
    console.error('Error updating room:', error);
    throw error;
  }
}

export async function deleteRoom(roomId: string): Promise<void> {
  try {
    await roomsCollection.doc(roomId).delete();
    console.log(`🗑️ Room deleted: ${roomId}`);
  } catch (error) {
    console.error('Error deleting room:', error);
    throw error;
  }
}
