Okay, here is a step-by-step plan to improve and simplify the encryption implementation for your Pasteriser application, keeping the Cloudflare Workers environment in mind. The core idea is to move entirely to **client-side End-to-End Encryption (E2EE)**, removing the complexity and security burden of handling any form of password verification or hashing on the server.

**Guiding Principles:**

* **Simplify:** Eliminate server-side password hashing/verification.
* **Enhance Security:** Use standard, robust cryptographic primitives (PBKDF2, NaCl secretbox).
* **Worker Compatibility:** Rely on APIs available in Workers/Browsers (Web Crypto API).
* **Clear UX:** Make encryption options and key handling clear to the user.

---

**Phase 1: Strengthen and Standardize Client-Side Crypto**

*(Focus: `astro/src/lib/crypto.ts` and related client-side logic)*

1.  **Implement PBKDF2 for Password-Based Keys:**
    * **Action:** Modify the `deriveKeyFromPassword` function.
    * **How:** Replace the custom iterated SHA-512 logic with **PBKDF2** using the standard Web Crypto API (`crypto.subtle.deriveKey`).
    * **Parameters:**
        * Use `SHA-256` or `SHA-512` as the underlying hash.
        * Use a high iteration count (e.g., start with `300000` and tune based on performance).
        * Generate a unique, cryptographically secure **salt** (16 bytes via `crypto.getRandomValues`) *each time* this function is called for encryption.
        * Derive a key of the required length for `nacl.secretbox` (32 bytes).
    * **Return:** The function should return both the derived key and the salt used.

2.  **Standardize Encrypted Data Format (Salt + Nonce + Ciphertext):**
    * **Action:** Modify the `encryptData` function.
    * **How:**
        * If deriving the key from a password, call the updated `deriveKeyFromPassword` to get the key *and* the salt.
        * Generate the nonce using `nacl.randomBytes(nacl.secretbox.nonceLength)`.
        * Perform encryption using `nacl.secretbox(data, nonce, key)`.
        * **Combine:** Create a single `Uint8Array` containing `[salt, nonce, ciphertext]`. *Note: Only include the salt if the key was derived from a password.* For randomly generated keys (Step 3), only include `[nonce, ciphertext]`.
        * Encode this combined array using Base64 (e.g., `tweetnacl-util.encodeBase64`). This encoded string is what will be sent to the server.

3.  **Refine Random Key Generation:**
    * **Action:** Review `generateEncryptionKey`.
    * **How:** Ensure it securely generates 32 random bytes using `nacl.randomBytes(nacl.secretbox.keyLength)`. This part seems okay currently.

4.  **Implement Client-Side Decryption Logic:**
    * **Action:** Modify the `decryptData` function.
    * **How:**
        * Accept the Base64 encoded string from the server.
        * Decode the Base64 string.
        * **Determine Format:** Check if decryption requires a password (user input) or a key (from URL fragment). This dictates whether a salt needs to be extracted.
        * **If Password-Based:**
            * Extract the salt (first 16 bytes).
            * Extract the nonce (next 24 bytes).
            * Extract the ciphertext (remaining bytes).
            * Call the *updated* `deriveKeyFromPassword` using the user-provided password and the *extracted salt*.
            * Attempt decryption using `nacl.secretbox.open(ciphertext, nonce, derivedKey)`.
        * **If Key-Based (URL Fragment):**
            * Extract the nonce (first 24 bytes).
            * Extract the ciphertext (remaining bytes).
            * Get the key directly from the URL fragment.
            * Attempt decryption using `nacl.secretbox.open(ciphertext, nonce, key)`.
        * Handle potential decryption errors gracefully.

---

**Phase 2: Simplify Server-Side Logic (Cloudflare Worker)**

*(Focus: `src/` directory - commands, queries, models, storage)*

1.  **Remove Server-Side Password Handling:**
    * **Action:** Delete `passwordHash` field from `src/domain/models/paste.ts` and the corresponding KV storage representation.
    * **Action:** Delete the `hashPassword` and `isPasswordCorrect` methods from `src/domain/models/paste.ts`.
    * **Action:** Remove any logic related to hashing or checking passwords in `src/application/commands/createPasteCommand.ts` and `src/application/queries/accessProtectedPasteQuery.ts`. The concept of a server-verified "password-protected" paste is removed.

2.  **Update Paste Creation Command:**
    * **Action:** Modify `src/application/commands/createPasteCommand.ts`.
    * **How:**
        * It should accept the paste `content` (which will be the Base64 encoded encrypted blob if `isEncrypted` is true) and the `isEncrypted` flag directly from the client request.
        * No password field is needed here anymore.
        * Save the `content` and `isEncrypted` flag to KV storage. The server is now agnostic to *how* it was encrypted or what the key/password is.

3.  **Simplify Paste Retrieval Query:**
    * **Action:** Modify `src/application/queries/getPasteQuery.ts`.
    * **How:** Retrieve the paste data (including the `content` and `isEncrypted` flag) from KV. Return this data to the client. The server doesn't need to do anything different for encrypted vs. unencrypted pastes other than potentially setting cache headers appropriately.

4.  **Remove Redundant Code:**
    * **Action:** Delete `src/application/queries/accessProtectedPasteQuery.ts` as it's no longer needed.
    * **Action:** Review `src/infrastructure/security/encryptionService.ts`. The `isLikelyEncrypted` heuristic might still be useful for informational purposes or moderation, but it's no longer critical for application logic. The explicit `isEncrypted` flag is primary.

---

**Phase 3: Update Frontend UI/UX (Astro)**

*(Focus: Astro components and pages involved in creating/viewing pastes)*

1.  **Refine Paste Creation Form:**
    * **Action:** Update the form component (`PasteForm.B2XrBgCD.js` / source).
    * **How:**
        * Replace distinct "Password Protect" / "Encrypt" toggles with a single "Encryption" option (e.g., a dropdown or radio buttons):
            * "None (Public / Unlisted)"
            * "Client-Side Encryption (using Password)"
            * "Client-Side Encryption (using Secure Key)"
        * If "Password" is chosen, show a password input field.
        * If "Secure Key" is chosen, hide the password field.
        * On submit, the client-side script performs the appropriate action (encrypt with password + salt, or encrypt with generated key) based on user choice before sending data to the worker.

2.  **Handle Paste Creation Response:**
    * **Action:** Update client-side submission logic.
    * **How:**
        * If "Secure Key" was used, generate the key, encrypt, *and then* construct the final URL including the paste ID (from server response) and the generated key in the fragment (`#key=...`). Display this *full URL* clearly to the user with instructions to save it.
        * If "Password" was used, simply display the URL with the paste ID (no fragment needed). Remind the user they will need their password to view it.

3.  **Update Paste Viewing Logic:**
    * **Action:** Modify the page component responsible for displaying pastes.
    * **How:**
        * On page load, fetch paste data from the server.
        * Check the `isEncrypted` flag.
        * **If Encrypted:**
            * Check the URL fragment for a `#key=...`. If present, attempt decryption using this key (call `decryptData` in key-based mode).
            * If no key in fragment, prompt the user for a password. On submission, attempt decryption using the entered password (call `decryptData` in password-based mode).
            * Display the decrypted content or appropriate error messages.
        * **If Not Encrypted:** Display the content directly.

---

This plan simplifies the backend by removing password logic entirely, placing the cryptographic workload on the client (which is suitable for E2EE), and standardizes the client-side crypto using robust, widely available primitives like PBKDF2 and NaCl secretbox, fitting well within the capabilities of modern browsers and Cloudflare Workers environments.
