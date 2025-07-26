#!/usr/bin/env bun
// Test script for the cron reminder system

const BACKEND_URL = 'http://localhost:8080';
const API_KEY = 'gaadakey'; // Default key

async function testCronEndpoints() {
  console.log('🧪 Testing Cron Reminder System...\n');

  // Test 1: Check cron status
  console.log('1️⃣ Testing cron status...');
  try {
    const response = await fetch(`${BACKEND_URL}/api/cron/status`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });
    
    const result = await response.json();
    console.log('✅ Cron Status:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Cron Status Error:', error);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Test reminders
  console.log('2️⃣ Testing reminder sending...');
  try {
    const response = await fetch(`${BACKEND_URL}/api/cron/test-reminders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });
    
    const result = await response.json();
    console.log('✅ Test Reminders:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Test Reminders Error:', error);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Run job manually
  console.log('3️⃣ Testing manual job execution...');
  try {
    const response = await fetch(`${BACKEND_URL}/api/cron/run-job`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jobName: 'booking-reminder-check'
      })
    });
    
    const result = await response.json();
    console.log('✅ Manual Job Execution:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Manual Job Execution Error:', error);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 4: Check WhatsApp queue status
  console.log('4️⃣ Testing WhatsApp queue status...');
  try {
    const response = await fetch(`${BACKEND_URL}/whatsapp/queue-status`);
    const result = await response.json();
    console.log('✅ Queue Status:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Queue Status Error:', error);
  }
}

// Wait a bit for server to be ready if just started
setTimeout(testCronEndpoints, 2000);

console.log('🚀 Starting cron system tests in 2 seconds...');
console.log('📡 Make sure the backend server is running on http://localhost:8080');
