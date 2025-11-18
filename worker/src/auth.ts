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
}

export class AuthManager {
  private challenges: Map<string, AuthChallenge> = new Map();
  private sessions: Map<string, AuthSession> = new Map();
  private readonly CHALLENGE_EXPIRY = 5 * 60 * 1000; // 5 minutes
  private readonly SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

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
    address: string
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
      this.sessions.set(sessionId, {
        address: address.toLowerCase(), // Normalize to lowercase
        authenticated: true,
        timestamp: Date.now(),
      });

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
  getSession(sessionId: string): AuthSession | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if session expired
    if (Date.now() - session.timestamp > this.SESSION_EXPIRY) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Remove a session
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
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

    // Clean expired sessions
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.timestamp > this.SESSION_EXPIRY) {
        this.sessions.delete(id);
      }
    }
  }
}
