import React, { useState, useEffect } from 'react';
import { User, LogOut, AlertCircle } from 'lucide-react';

const WORKER_URL = 'https://probable-space-eureka-g4q4pq5r4p5h99rp-8787.app.github.dev'; // Update this with your worker URL

export function WalletAuth({ onAuthSuccess, onLogout, activeProfile, signChallenge, isAuthenticated, authData }) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  // Don't use localStorage - each tab/instance should have its own session
  // useEffect removed to prevent session conflicts

  const connectProfile = async () => {
    setIsConnecting(true);
    setError('');

    try {
      // Check if a profile is selected
      if (!activeProfile) {
        throw new Error('Please select a profile first');
      }

      // Get challenge from backend
      const challengeResponse = await fetch(`${WORKER_URL}/api/auth/challenge`);
      const { sessionId, challenge } = await challengeResponse.json();

      // "Sign" the challenge by encrypting and decrypting it
      const proof = await signChallenge(
        challenge, 
        activeProfile.privateKey,
        activeProfile.publicKey
      );

      // Verify proof with backend (proof should equal challenge)
      const verifyResponse = await fetch(`${WORKER_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionId, 
          proof,
          address: activeProfile.address
        }),
      });

      const verifyData = await verifyResponse.json();

      if (verifyData.success) {
        // Don't store in localStorage to avoid conflicts between tabs
        onAuthSuccess({ address: activeProfile.address, sessionId });
      } else {
        throw new Error(verifyData.error || 'Authentication failed');
      }
    } catch (err) {
      console.error('Connection error:', err);
      setError(err.message || 'Failed to authenticate profile');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      if (authData?.sessionId) {
        await fetch(`${WORKER_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: authData.sessionId }),
        });
      }

      onLogout();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  if (isAuthenticated && authData) {
    return (
      <div className="flex items-center gap-4 p-4 bg-gray-800 rounded-lg">
        <div className="flex items-center gap-2 flex-1">
          <User className="w-5 h-5 text-green-500" />
          <span className="text-sm text-gray-300 font-mono">
            {authData.address.slice(0, 8)}...{authData.address.slice(-6)}
          </span>
        </div>
        <button
          onClick={disconnect}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-800 rounded-lg">
      {!activeProfile && (
        <div className="mb-3 p-3 bg-yellow-900/30 border border-yellow-600 rounded text-sm text-yellow-200">
          <AlertCircle className="w-4 h-4 inline mr-2" />
          Please select an active profile from "My Profiles" first
        </div>
      )}
      
      <button
        onClick={connectProfile}
        disabled={isConnecting || !activeProfile}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded transition-colors"
      >
        <User className="w-5 h-5" />
        {isConnecting ? 'Authenticating...' : 'Authenticate Profile'}
      </button>

      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 bg-red-900/30 border border-red-600 rounded text-sm text-red-200">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
