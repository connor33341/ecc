import React, { useState } from 'react';
import { WalletAuth } from './WalletAuth';
import { ChatInterface } from './ChatInterface';
import { MessageSquare, X } from 'lucide-react';

export function WebChatPanel({ 
  encryptMessage, 
  decryptMessage, 
  activeProfile, 
  contactProfiles,
  signChallenge 
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [authData, setAuthData] = useState(null);

  const handleAuthSuccess = (data) => {
    setAuthData(data);
  };

  const handleLogout = () => {
    setAuthData(null);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 p-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-all z-50"
        title="Open Web Chat"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 h-[600px] bg-gray-900 rounded-lg shadow-2xl flex flex-col overflow-hidden z-50 border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-semibold text-white">Web Chat</h2>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
        >
          <X className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {!authData ? (
          <div className="p-4">
            <div className="mb-4 text-sm text-gray-400">
              Authenticate with your active profile to start chatting with other users securely.
            </div>
            <WalletAuth 
              onAuthSuccess={handleAuthSuccess} 
              onLogout={handleLogout}
              activeProfile={activeProfile}
              signChallenge={signChallenge}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="p-4 border-b border-gray-700">
              <WalletAuth 
                onAuthSuccess={handleAuthSuccess} 
                onLogout={handleLogout}
                activeProfile={activeProfile}
                signChallenge={signChallenge}
                isAuthenticated={true}
                authData={authData}
              />
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatInterface
                address={authData.address}
                sessionId={authData.sessionId}
                encryptMessage={encryptMessage}
                decryptMessage={decryptMessage}
                contactProfiles={contactProfiles}
                activeProfile={activeProfile}
                onSessionExpired={handleLogout}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
