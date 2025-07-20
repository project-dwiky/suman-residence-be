import { db } from '../lib/firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export interface BookingDocument {
  id: string;
  type: 'BOOKING_SLIP' | 'RECEIPT' | 'SOP' | 'INVOICE';
  fileName: string;
  fileUrl: string;
  createdAt: Date;
}

export interface BookingRoom {
  id: string;
  roomNumber: string;
  type: string;
  floor: number;
  size: string;
  description: string;
  facilities: string[];
  imagesGallery: string[];
}

export interface BookingPeriod {
  startDate: Date;
  endDate: Date;
  durationType: 'MONTHLY' | 'SEMESTER' | 'YEARLY';
}

export interface Booking {
  id: string;
  userId: string;
  room: BookingRoom;
  rentalStatus: 'PENDING' | 'SETUJUI' | 'CANCEL';
  rentalPeriod: BookingPeriod;
  documents: BookingDocument[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  // Contact info for manual booking
  contactInfo: {
    name: string;
    email: string;
    phone: string;
    whatsapp: string;
  };
}

const bookingsCollection = db.collection('bookings');

export async function getAllBookings(): Promise<Booking[]> {
  try {
    const snapshot = await bookingsCollection.orderBy('createdAt', 'desc').get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        rentalPeriod: {
          ...data.rentalPeriod,
          startDate: data.rentalPeriod?.startDate?.toDate() || new Date(),
          endDate: data.rentalPeriod?.endDate?.toDate() || new Date(),
        },
        documents: data.documents?.map((doc: any) => ({
          ...doc,
          createdAt: doc.createdAt?.toDate() || new Date(),
        })) || []
      } as Booking;
    });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    throw error;
  }
}

export async function getBookingById(bookingId: string): Promise<Booking | null> {
  try {
    const doc = await bookingsCollection.doc(bookingId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data()!;
    return {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date(),
      rentalPeriod: {
        ...data.rentalPeriod,
        startDate: data.rentalPeriod?.startDate?.toDate() || new Date(),
        endDate: data.rentalPeriod?.endDate?.toDate() || new Date(),
      },
      documents: data.documents?.map((doc: any) => ({
        ...doc,
        createdAt: doc.createdAt?.toDate() || new Date(),
      })) || []
    } as Booking;
  } catch (error) {
    console.error('Error fetching booking:', error);
    throw error;
  }
}

export async function getBookingsByUserId(userId: string): Promise<Booking[]> {
  try {
    console.log(`🔍 Fetching bookings for userId: ${userId}`);
    
    // Search by userId first
    const userIdSnapshot = await bookingsCollection
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    
    console.log(`📊 Found ${userIdSnapshot.docs.length} bookings by userId`);
    
    // Also search by email in contactInfo (in case userId contains email)
    let emailSnapshot;
    if (userId.includes('@')) {
      emailSnapshot = await bookingsCollection
        .where('contactInfo.email', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();
      
      console.log(`📊 Found ${emailSnapshot.docs.length} bookings by email`);
    }
    
    // Combine results and remove duplicates
    const allDocs = new Map();
    
    // Add userId results
    userIdSnapshot.docs.forEach(doc => {
      allDocs.set(doc.id, doc);
    });
    
    // Add email results (if any)
    if (emailSnapshot) {
      emailSnapshot.docs.forEach(doc => {
        allDocs.set(doc.id, doc);
      });
    }
    
    console.log(`📊 Total unique bookings found: ${allDocs.size}`);
    
    return Array.from(allDocs.values()).map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        rentalPeriod: {
          ...data.rentalPeriod,
          startDate: data.rentalPeriod?.startDate?.toDate() || new Date(),
          endDate: data.rentalPeriod?.endDate?.toDate() || new Date(),
        },
        documents: data.documents?.map((doc: any) => ({
          ...doc,
          createdAt: doc.createdAt?.toDate() || new Date(),
        })) || []
      } as Booking;
    }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Sort by createdAt desc
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    throw error;
  }
}

export async function createBooking(bookingData: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const timestamp = Timestamp.now();
    
    const cleanedData = {
      userId: bookingData.userId,
      room: bookingData.room,
      rentalStatus: bookingData.rentalStatus || 'PENDING',
      rentalPeriod: {
        ...bookingData.rentalPeriod,
        startDate: Timestamp.fromDate(bookingData.rentalPeriod.startDate),
        endDate: Timestamp.fromDate(bookingData.rentalPeriod.endDate),
      },
      documents: bookingData.documents?.map(doc => ({
        ...doc,
        createdAt: Timestamp.fromDate(doc.createdAt),
      })) || [],
      notes: bookingData.notes || '',
      contactInfo: bookingData.contactInfo,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    
    const docRef = await bookingsCollection.add(cleanedData);
    
    console.log(`📋 Booking created with ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error('Error creating booking:', error);
    throw error;
  }
}

export async function updateBooking(bookingId: string, updateData: Partial<Omit<Booking, 'id' | 'createdAt'>>): Promise<void> {
  try {
    const timestamp = Timestamp.now();
    
    const dataToUpdate: any = {
      updatedAt: timestamp
    };
    
    // Only add defined values
    if (updateData.userId !== undefined) dataToUpdate.userId = updateData.userId;
    if (updateData.room !== undefined) dataToUpdate.room = updateData.room;
    if (updateData.rentalStatus !== undefined) dataToUpdate.rentalStatus = updateData.rentalStatus;
    if (updateData.notes !== undefined) dataToUpdate.notes = updateData.notes;
    if (updateData.contactInfo !== undefined) dataToUpdate.contactInfo = updateData.contactInfo;
    
    // Handle rentalPeriod specially
    if (updateData.rentalPeriod !== undefined) {
      dataToUpdate.rentalPeriod = {
        ...updateData.rentalPeriod,
        startDate: Timestamp.fromDate(updateData.rentalPeriod.startDate),
        endDate: Timestamp.fromDate(updateData.rentalPeriod.endDate),
      };
    }
    
    // Handle documents specially
    if (updateData.documents !== undefined) {
      dataToUpdate.documents = updateData.documents.map(doc => ({
        ...doc,
        createdAt: Timestamp.fromDate(doc.createdAt),
      }));
    }
    
    await bookingsCollection.doc(bookingId).update(dataToUpdate);
    console.log(`✏️ Booking updated: ${bookingId}`);
  } catch (error) {
    console.error('Error updating booking:', error);
    throw error;
  }
}

export async function deleteBooking(bookingId: string): Promise<void> {
  try {
    await bookingsCollection.doc(bookingId).delete();
    console.log(`🗑️ Booking deleted: ${bookingId}`);
  } catch (error) {
    console.error('Error deleting booking:', error);
    throw error;
  }
}
