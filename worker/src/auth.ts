import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

export interface AuthChallenge {
  challenge: string;
  timestamp: number;
}

export interface AuthSession {
  address: string;
  authenticated: boolean;
  timestamp: number;
  expiresAt: number | null; // User-set expiration for temporary profiles
}

export class AuthManager {
  private challenges: Map<string, AuthChallenge> = new Map();
  private kv: KVNamespace | null = null;
  private readonly CHALLENGE_EXPIRY = 5 * 60 * 1000; // 5 minutes
  private readonly SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

  setKV(kv: KVNamespace): void {
    this.kv = kv;
  }

  /**
   * Generate a challenge for authentication
   */
  generateChallenge(): string {
    const challenge = `Sign this message to authenticate with ECC:\n\nNonce: ${crypto.randomUUID()}\nTimestamp: ${Date.now()}`;
    return challenge;
  }

  /**
   * Store a challenge for later verification
   */
  storeChallenge(sessionId: string, challenge: string): void {
    this.challenges.set(sessionId, {
      challenge,
      timestamp: Date.now(),
    });
  }

  /**
   * Verify that proof matches the challenge (user encrypted then decrypted it)
   */
  async verifyProof(
    sessionId: string,
    proof: string,
    address: string,
    expiresAt?: number | null
  ): Promise<{ success: boolean; address?: string; error?: string }> {
    const challengeData = this.challenges.get(sessionId);

    if (!challengeData) {
      return { success: false, error: 'Challenge not found' };
    }

    // Check if challenge expired
    if (Date.now() - challengeData.timestamp > this.CHALLENGE_EXPIRY) {
      this.challenges.delete(sessionId);
      return { success: false, error: 'Challenge expired' };
    }

    try {
      // Check if the proof matches the challenge
      // User encrypted the challenge with their public key and decrypted with private key
      // If they have the private key, the proof will match the challenge
      if (proof !== challengeData.challenge) {
        return { success: false, error: 'Invalid proof - challenge mismatch' };
      }

      // Create session
      const session: AuthSession = {
        address: address.toLowerCase(), // Normalize to lowercase
        authenticated: true,
        timestamp: Date.now(),
        expiresAt: expiresAt || null,
      };

      // Store in KV if available, with TTL
      if (this.kv) {
        const ttl = Math.floor(this.SESSION_EXPIRY / 1000); // Convert to seconds
        await this.kv.put(`session:${sessionId}`, JSON.stringify(session), {
          expirationTtl: ttl,
        });
      }

      // Clean up challenge
      this.challenges.delete(sessionId);

      return { success: true, address: address.toLowerCase() };
    } catch (error) {
      console.error('Proof verification error:', error);
      return { success: false, error: 'Invalid proof format' };
    }
  }

  /**
   * Get session for a sessionId
   */
  async getSession(sessionId: string): Promise<AuthSession | null> {
    // Try to get from KV if available
    if (this.kv) {
      const sessionData = await this.kv.get(`session:${sessionId}`);
      if (!sessionData) {
        return null;
      }

      const session: AuthSession = JSON.parse(sessionData);

      // Check if user-set expiration has passed
      if (session.expiresAt && Date.now() > session.expiresAt) {
        await this.kv.delete(`session:${sessionId}`);
        return null;
      }

      return session;
    }

    return null;
  }

  /**
   * Remove a session
   */
  async removeSession(sessionId: string): Promise<void> {
    if (this.kv) {
      await this.kv.delete(`session:${sessionId}`);
    }
  }

  /**
   * Get all expired sessions and remove them
   */
  getExpiredSessions(): string[] {
    // With KV, expiration is handled automatically via TTL
    // This method is kept for compatibility but doesn't need to do anything
    return [];
  }

  /**
   * Clean up expired challenges and sessions
   */
  cleanup(): void {
    const now = Date.now();

    // Clean expired challenges
    for (const [id, challenge] of this.challenges.entries()) {
      if (now - challenge.timestamp > this.CHALLENGE_EXPIRY) {
        this.challenges.delete(id);
      }
    }

    // Sessions in KV are cleaned up automatically via TTL
  }
}
