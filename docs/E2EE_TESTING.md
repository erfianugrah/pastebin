# End-to-End Encryption Testing Guide

This guide outlines how to test the end-to-end encryption (E2EE) features implemented in the Pasteriser application.

## Testing Setup

1. Start the application:
   ```
   cd /path/to/pastebin/astro
   npm run dev
   ```

2. In a separate terminal, start the backend:
   ```
   cd /path/to/pastebin
   npm run dev
   ```

## Test Cases

### 1. Creating Pastes with Different Security Methods

#### 1.1 No Encryption (Plaintext)

**Steps:**
1. Go to the main page (/)
2. Fill in some sample content
3. Select "None (Plaintext)" from the Security dropdown
4. Click "Create Paste"

**Expected Results:**
- Paste should be created and viewable
- No encryption indicator should be shown in the paste view
- Content should be sent to the server in plaintext

#### 1.2 Key-Based Encryption

**Steps:**
1. Go to the main page (/)
2. Fill in some sample content
3. Select "Key Protection (E2EE)" from the Security dropdown
4. Leave the password field empty
5. Click "Create Paste"

**Expected Results:**
- Paste should be created
- A URL containing a fragment identifier (#key=...) should be displayed
- The UI should show information about the encryption key in the URL
- The server should receive only encrypted content

#### 1.3 Password-Based Encryption

**Steps:**
1. Go to the main page (/)
2. Fill in some sample content
3. Select "Password Protection (E2EE)" from the Security dropdown
4. Enter a password (test different strengths)
5. Observe the password strength meter
6. Click "Create Paste"

**Expected Results:**
- Paste should be created
- A URL without a fragment should be shown
- Information about password-based protection should be displayed
- The server should only receive encrypted content
- The password should not be sent to the server

### 2. Viewing and Decrypting Pastes

#### 2.1 Viewing Non-Encrypted Paste

**Steps:**
1. Create a non-encrypted paste
2. Open the paste URL in a new tab

**Expected Results:**
- Content should be immediately visible
- No encryption indicators should be shown

#### 2.2 Viewing Key-Encrypted Paste with Complete URL

**Steps:**
1. Create a key-encrypted paste
2. Copy the full URL including the fragment (#key=...)
3. Open in a new tab

**Expected Results:**
- Content should be automatically decrypted
- "E2E Decrypted" indicator should be shown
- Success notification should be displayed

#### 2.3 Viewing Key-Encrypted Paste with Incomplete URL

**Steps:**
1. Create a key-encrypted paste
2. Copy only the base URL (without the #key=... part)
3. Open in a new tab

**Expected Results:**
- Encryption warning should be displayed
- Content should be shown as encrypted
- "Enter Password" button should be available
- "Missing decryption key" information should be displayed

#### 2.4 Viewing Password-Encrypted Paste

**Steps:**
1. Create a password-encrypted paste
2. Open the paste URL in a new tab
3. You should see the password entry form
4. Enter the correct password
5. Click "Decrypt Content"

**Expected Results:**
- Decryption spinner should be shown
- Content should decrypt and display
- "E2E Decrypted" indicator should be shown
- Success notification should be displayed

#### 2.5 Password Decryption with Incorrect Password

**Steps:**
1. Open a password-encrypted paste
2. Enter an incorrect password
3. Click "Decrypt Content"

**Expected Results:**
- Error message should be displayed
- Content should remain encrypted
- Form should allow trying again

### 3. Browser Integration Features

#### 3.1 Password Manager Integration

**Steps:**
1. Create a password-protected paste with a new password
2. Check if the browser offers to save the password
3. View the paste in a new tab and check if the password manager offers to fill

**Expected Results:**
- Password manager should recognize the password fields
- Password should be saved and auto-filled correctly
- Decryption should work with auto-filled password

#### 3.2 Copy to Clipboard Functions

**Steps:**
1. Create an encrypted paste (either method)
2. Test the copy URL button
3. If key-encrypted, test the copy key button 
4. Paste the copied content elsewhere

**Expected Results:**
- URL should copy correctly with the full fragment
- Key should copy correctly
- Toast notifications should confirm successful copying
- Pasted content should work for decryption

#### 3.3 Key Storage

**Steps:**
1. Create a key-encrypted paste
2. Click the "Save Key" button
3. Close the browser tab
4. Reopen the paste URL without the key fragment

**Expected Results:**
- Toast notification should confirm key was saved
- When reopening without the key fragment, system should offer to use saved key
- Clicking "Try Saved Key" should successfully decrypt the content

#### 3.4 Password Storage

**Steps:**
1. Create a password-protected paste
2. View the paste and enter the password
3. After successful decryption, accept the prompt to save the password
4. Close the browser tab
5. Reopen the paste

**Expected Results:**
- System should prompt to save the password securely
- On revisit, clicking "Try Saved Key" should work
- User should not need to re-enter the password

#### 3.5 Edge Cases

##### 3.5.1 Long Content Encryption/Decryption

**Steps:**
1. Create a paste with a very large amount of text (e.g., 1MB)
2. Encrypt with either method
3. View and decrypt the paste

**Expected Results:**
- Encryption and decryption should work correctly
- The UI should remain responsive
- Progressive loading indicators should be shown for very large content

##### 3.5.2 Special Characters and Unicode

**Steps:**
1. Create a paste with special characters, Unicode, and emojis
2. Encrypt with either method
3. View and decrypt the paste

**Expected Results:**
- All characters should be preserved after encryption/decryption

##### 3.5.3 Password Strength Testing

**Steps:**
1. Try creating pastes with passwords of varying strength
2. Observe the password strength meter feedback

**Expected Results:**
- Weak passwords should be identified with suggestions for improvement
- Strong passwords should be recognized
- The password strength meter should provide useful color coding

## Reporting Issues

When reporting issues, please include:
1. The test case you were performing
2. Expected vs. actual behavior
3. Any error messages observed
4. Browser and version information
5. Screenshots if relevant

## Security Considerations

- The server should never receive plaintext content for encrypted pastes
- The server should never receive encryption keys or passwords
- Decryption should always happen client-side
- Encryption keys should be properly secured in transit (URL fragment)