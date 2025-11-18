import React, { useState, useEffect, useRef } from 'react';
import { Send, Users, Circle } from 'lucide-react';

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
  activeProfile
}) {
  const [ws, setWs] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!sessionId || !address) return;

    connectWebSocket();

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [sessionId, address]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const connectWebSocket = () => {
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

      // Reconnect after 3 seconds
      setTimeout(() => {
        if (sessionId) {
          connectWebSocket();
        }
      }, 3000);
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    setWs(websocket);
  };

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'chat_message':
        addMessage(data.message);
        break;
      case 'message_sent':
        addMessage(data.message);
        break;
      case 'online_users':
        setOnlineUsers(data.users);
        break;
      case 'user_connected':
        setOnlineUsers((prev) => [...new Set([...prev, data.address])]);
        break;
      case 'user_disconnected':
        setOnlineUsers((prev) => prev.filter((u) => u !== data.address));
        break;
      case 'pong':
        // Handle ping/pong
        break;
      default:
        console.warn('Unknown message type:', data.type);
    }
  };

  const addMessage = (message) => {
    setMessages((prev) => [...prev, message]);
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !ws || !isConnected) return;

    try {
      let content = messageInput;
      
      // If recipient is selected and encryptMessage function is provided, encrypt the message
      if (selectedRecipient && encryptMessage) {
        try {
          // Find recipient in contacts by their address
          const recipient = contactProfiles.find(
            p => p.address.toLowerCase() === selectedRecipient.toLowerCase()
          );
          
          if (recipient) {
            content = await encryptMessage(messageInput, recipient.publicKey);
          } else {
            // If not in contacts, send unencrypted with warning
            console.warn('Recipient not in contacts, sending unencrypted');
          }
        } catch (err) {
          console.error('Encryption error:', err);
          alert('Failed to encrypt message. Sending unencrypted.');
        }
      }

      const message = {
        type: 'chat_message',
        to: selectedRecipient,
        content: content,
        signature: '', // You can add message signing here if needed
      };

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
    return message.from.toLowerCase() === address.toLowerCase();
  };

  const tryDecryptMessage = async (content, message) => {
    if (!decryptMessage || !activeProfile) return content;

    // Only try to decrypt if this message is directed to us
    if (message.to && message.to.toLowerCase() === address.toLowerCase()) {
      try {
        const decrypted = await decryptMessage(content, activeProfile.privateKey);
        return decrypted;
      } catch (err) {
        console.error('Decryption failed:', err);
        return '[Encrypted - Unable to Decrypt]';
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
            const isMyMsg = isMyMessage(msg);
            const isDirect = msg.to && msg.to !== '';
            
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
            {onlineUsers
              .filter((user) => user.toLowerCase() !== address.toLowerCase())
              .map((user) => (
                <option key={user} value={user}>
                  {formatAddress(user)} (Direct)
                </option>
              ))}
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
