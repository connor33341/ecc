import React, { useState, useEffect, useRef } from 'react';
import { Send, Users, Circle, LogOut } from 'lucide-react';

const WORKER_URL = 'https://probable-space-eureka-g4q4pq5r4p5h99rp-8787.app.github.dev'; // Update this with your worker URL

// Component to handle message decryption
function MessageContent({ message, tryDecrypt }) {
  const [content, setContent] = useState(message.content);
  const [isDecrypting, setIsDecrypting] = useState(false);

  useEffect(() => {
    const decrypt = async () => {
      if (message.to) {
        setIsDecrypting(true);
        const decrypted = await tryDecrypt(message.content, message);
        setContent(decrypted);
        setIsDecrypting(false);
      }
    };
    decrypt();
  }, [message.content, message.to]);

  if (isDecrypting) {
    return <div className="break-words text-sm opacity-70">Decrypting...</div>;
  }

  return <div className="break-words">{content}</div>;
}

export function ChatInterface({ 
  address, 
  sessionId, 
  encryptMessage, 
  decryptMessage,
  contactProfiles,
  activeProfile,
  onSessionExpired
}) {
  // Normalize address to lowercase to match backend
  const normalizedAddress = address?.toLowerCase();
  
  const [ws, setWs] = useState(null);
  const wsRef = useRef(null); // Keep ref to current WebSocket
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]); // Array of {address, expiresAt}
  const messagesEndRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const shouldReconnectRef = useRef(true);
  const sessionCheckIntervalRef = useRef(null);

  // Check if session is still valid every 30 seconds
  useEffect(() => {
    if (!sessionId) return;

    const checkSession = async () => {
      try {
        console.log('Checking session validity...');
        const response = await fetch(`https://probable-space-eureka-g4q4pq5r4p5h99rp-8787.app.github.dev/api/auth/session?sessionId=${sessionId}`);
        const data = await response.json();
        
        console.log('Session check response:', data);
        
        if (!data.valid) {
          console.log('Session expired, disconnecting');
          shouldReconnectRef.current = false;
          if (wsRef.current) wsRef.current.close();
          if (onSessionExpired) {
            onSessionExpired();
          }
        }
      } catch (err) {
        console.error('Session check error:', err);
      }
    };

    // Check immediately
    checkSession();
    
    // Then check every 30 seconds
    sessionCheckIntervalRef.current = setInterval(checkSession, 30000);

    return () => {
      if (sessionCheckIntervalRef.current) {
        clearInterval(sessionCheckIntervalRef.current);
      }
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !address) return;

    shouldReconnectRef.current = true;
    connectWebSocket();

    return () => {
      // Clean up on unmount
      shouldReconnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [sessionId]); // Only reconnect when sessionId changes, not address

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    console.log('Online users state updated:', onlineUsers, 'Count:', onlineUsers.length);
  }, [onlineUsers]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const connectWebSocket = () => {
    // Close existing connection if any
    if (wsRef.current) {
      console.log('Closing existing WebSocket connection');
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = WORKER_URL.replace('http', 'ws') + `/ws?sessionId=${sessionId}`;
    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    };

    websocket.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);

      // Only reconnect if we should (not disconnected intentionally)
      if (shouldReconnectRef.current && sessionId) {
        // Clear any existing timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting to reconnect...');
          connectWebSocket();
        }, 3000);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      // Don't reconnect on authentication errors
      if (error.message && error.message.includes('Authentication')) {
        shouldReconnectRef.current = false;
      }
    };

    setWs(websocket);
    wsRef.current = websocket; // Keep ref to current WebSocket
  };

  const handleWebSocketMessage = (data) => {
    console.log('Received WebSocket message:', data);
    switch (data.type) {
      case 'chat_message':
        addMessage(data.message);
        break;
      case 'message_sent':
        addMessage(data.message);
        break;
      case 'online_users':
        console.log('Setting online users to:', data.users, 'Count:', data.users.length);
        // data.users is now array of {address, expiresAt}
        setOnlineUsers(data.users);
        break;
      case 'user_connected':
        console.log('User connected:', data.address, 'expiresAt:', data.expiresAt);
        setOnlineUsers((prev) => {
          // Remove if already exists, then add
          const filtered = prev.filter(u => u.address !== data.address);
          const updated = [...filtered, { address: data.address, expiresAt: data.expiresAt }];
          console.log('Previous count:', prev.length, 'New count:', updated.length);
          return updated;
        });
        // Schedule system message to avoid setState during render
        setTimeout(() => {
          addSystemMessage(`${formatAddress(data.address)} joined the chat`);
        }, 0);
        break;
      case 'user_disconnected':
        console.log('User disconnected:', data.address);
        setOnlineUsers((prev) => {
          const updated = prev.filter((u) => u.address !== data.address);
          console.log('Previous count:', prev.length, 'New count:', updated.length);
          return updated;
        });
        // Schedule system message to avoid setState during render
        setTimeout(() => {
          addSystemMessage(`${formatAddress(data.address)} left the chat`);
        }, 0);
        break;
      case 'session_expired':
        // Handle session expiry notification
        console.log('Session expired for:', data.address);
        setOnlineUsers((prev) => prev.filter((u) => u.address !== data.address));
        setTimeout(() => {
          addSystemMessage(`${formatAddress(data.address)}'s session expired`);
        }, 0);
        break;
      case 'pong':
        // Handle ping/pong
        break;
      default:
        console.warn('Unknown message type:', data.type);
    }
  };

  const addMessage = (message) => {
    console.log('Adding message:', { 
      from: message.from, 
      to: message.to, 
      myAddress: normalizedAddress,
      isMyMessage: message.from.toLowerCase() === normalizedAddress 
    });
    setMessages((prev) => [...prev, message]);
  };

  const addSystemMessage = (text) => {
    const systemMessage = {
      type: 'system',
      content: text,
      timestamp: Date.now(),
      from: 'system',
      to: '',
    };
    setMessages((prev) => [...prev, systemMessage]);
  };

  const isTemporaryAddress = (addr) => {
    // Check if this address belongs to a profile with expiresAt set
    if (activeProfile && activeProfile.address.toLowerCase() === addr.toLowerCase()) {
      return activeProfile.expiresAt != null;
    }
    // Check if this address is in onlineUsers with expiresAt
    const user = onlineUsers.find(u => u.address === addr.toLowerCase());
    return user && user.expiresAt != null;
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !ws || !isConnected) return;

    try {
      let content = messageInput;
      let isEncrypted = false;
      
      // If recipient is selected and encryptMessage function is provided, encrypt the message
      if (selectedRecipient && selectedRecipient.trim() !== '' && encryptMessage) {
        try {
          // Find recipient in contacts by their address
          const recipient = contactProfiles.find(
            p => p.address.toLowerCase() === selectedRecipient.toLowerCase()
          );
          
          if (recipient && recipient.publicKey) {
            console.log('Encrypting message for:', recipient.address);
            // Pass the publicKey string directly to encryptMessage
            content = await encryptMessage(messageInput, recipient.publicKey);
            isEncrypted = true;
            console.log('Message encrypted successfully');
          } else {
            console.warn('Recipient not in contacts or missing public key');
            alert('Recipient must be in your contacts to send encrypted messages.');
            return;
          }
        } catch (err) {
          console.error('Encryption error:', err);
          alert('Failed to encrypt message: ' + err.message);
          return;
        }
      }

      const message = {
        type: 'chat_message',
        to: selectedRecipient || '',
        content: content,
        signature: '',
      };

      console.log('Sending message:', { to: message.to, encrypted: isEncrypted, from: address });
      ws.send(JSON.stringify(message));
      setMessageInput('');
    } catch (err) {
      console.error('Send message error:', err);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatAddress = (addr) => {
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  const isMyMessage = (message) => {
    return message.from.toLowerCase() === normalizedAddress;
  };

  const tryDecryptMessage = async (content, message) => {
    if (!decryptMessage || !activeProfile) return content;

    // Only try to decrypt if this message is directed to us
    if (message.to && message.to.trim() !== '' && message.to.toLowerCase() === normalizedAddress) {
      try {
        console.log('Attempting to decrypt message from:', message.from);
        // Pass the privateKey string directly to decryptMessage
        const decrypted = await decryptMessage(content, activeProfile.privateKey);
        console.log('Message decrypted successfully');
        return decrypted;
      } catch (err) {
        console.error('Decryption failed:', err);
        return '[🔒 Encrypted - Unable to Decrypt]';
      }
    }

    return content;
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Circle
            className={`w-3 h-3 ${isConnected ? 'text-green-500 fill-green-500' : 'text-red-500 fill-red-500'}`}
          />
          <span className="text-sm text-gray-300">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-gray-400" />
          <span className="text-sm text-gray-300">{onlineUsers.length} online</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            No messages yet. Start chatting!
          </div>
        ) : (
          messages.map((msg, idx) => {
            // Handle system messages
            if (msg.type === 'system') {
              return (
                <div key={idx} className="flex justify-center">
                  <div className="text-xs text-gray-500 italic px-3 py-1 bg-gray-800/50 rounded-full">
                    {msg.content}
                  </div>
                </div>
              );
            }

            // Handle regular messages
            const isMyMsg = isMyMessage(msg);
            const isDirect = msg.to && msg.to !== '';
            const isTempAddress = isTemporaryAddress(msg.from);
            
            return (
              <div
                key={idx}
                className={`flex ${isMyMsg ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg p-3 ${
                    isMyMsg
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  <div className="text-xs opacity-70 mb-1">
                    {isMyMsg ? 'You' : formatAddress(msg.from)}
                    {isTempAddress && !isMyMsg && (
                      <span className="ml-1" title="Temporary Address">⏱️</span>
                    )}
                    {isDirect && (
                      <span> → {formatAddress(msg.to)}</span>
                    )}
                    {isDirect && <span className="ml-1">🔒</span>}
                  </div>
                  <MessageContent message={msg} tryDecrypt={tryDecryptMessage} />
                  <div className="text-xs opacity-50 mt-1">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-gray-800 border-t border-gray-700">
        {/* Recipient selector */}
        <div className="mb-2">
          <select
            value={selectedRecipient}
            onChange={(e) => setSelectedRecipient(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">Broadcast to all</option>
            {contactProfiles && contactProfiles.map((contact) => {
              const isOnline = onlineUsers.some(u => u.address?.toLowerCase() === contact.address.toLowerCase());
              return (
                <option key={contact.address} value={contact.address}>
                  {contact.name || formatAddress(contact.address)} {isOnline ? '🟢' : '⚫'}
                </option>
              );
            })}
          </select>
        </div>

        {/* Message input */}
        <div className="flex gap-2">
          <textarea
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            rows={2}
          />
          <button
            onClick={sendMessage}
            disabled={!messageInput.trim() || !isConnected}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>

        {selectedRecipient && (
          <div className="mt-2 text-xs text-blue-400">
            🔒 Messages to {formatAddress(selectedRecipient)} will be encrypted
          </div>
        )}
      </div>
    </div>
  );
}
