// Test the new crypto implementation

import {
  generateEncryptionKey,
  deriveKeyFromPassword,
  encryptData,
  decryptData
} from './crypto';

async function runTest() {
  try {
    // Generate a random key
    console.log('Generating random key...');
    const key = generateEncryptionKey();
    console.log('Key generated:', key);
    
    // Test encryption and decryption with direct key
    const testText = 'Hello, world! This is a test of the crypto module.';
    console.log('Original text:', testText);
    
    console.log('Encrypting with key...');
    const encrypted = await encryptData(testText, key);
    console.log('Encrypted:', encrypted);
    
    console.log('Decrypting with key...');
    const decrypted = await decryptData(encrypted, key);
    console.log('Decrypted:', decrypted);
    
    console.log('Test successful:', decrypted === testText);
    
    // Test with password-derived key
    console.log('\nTesting password-derived encryption:');
    console.log('Deriving key from password...');
    const { key: derivedKey, salt } = await deriveKeyFromPassword('testpassword');
    console.log('Derived key:', derivedKey);
    console.log('Salt:', salt);
    
    console.log('Encrypting with password-derived key...');
    const encryptedWithPassword = await encryptData(
      testText, 
      derivedKey, 
      true, // isPasswordDerived
      salt
    );
    console.log('Encrypted with password:', encryptedWithPassword);
    
    console.log('Decrypting with password...');
    const decryptedWithPassword = await decryptData(
      encryptedWithPassword,
      'testpassword',
      true // isPasswordProtected
    );
    console.log('Decrypted with password:', decryptedWithPassword);
    
    console.log('Password test successful:', decryptedWithPassword === testText);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    runTest();
  });
} else {
  console.warn('This test can only run in a browser environment');
}