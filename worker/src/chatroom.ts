import { DurableObject } from 'cloudflare:workers';

export interface Message {
  from: string;
  to: string;
  content: string; // encrypted content
  timestamp: number;
  signature: string;
}

export interface WebSocketSession {
  webSocket: WebSocket;
  address: string;
  sessionId: string;
  expiresAt: number | null;
}

export class ChatRoom extends DurableObject {
  private sessions: Map<string, WebSocketSession> = new Map();
  private messageHistory: Message[] = [];
  private readonly MAX_HISTORY = 100;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // Handle other HTTP requests
    if (url.pathname === '/messages') {
      return this.handleGetMessages(request);
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Handle WebSocket connections
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    const address = url.searchParams.get('address');
    const expiresAtStr = url.searchParams.get('expiresAt');
    const expiresAt = expiresAtStr ? parseInt(expiresAtStr) : null;

    if (!sessionId || !address) {
      return new Response('Missing sessionId or address', { status: 400 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    server.accept();

    // Store session
    const session: WebSocketSession = {
      webSocket: server,
      address: address.toLowerCase(),
      sessionId,
      expiresAt,
    };

    // If session has expiry, set up automatic disconnect
    if (expiresAt) {
      const timeUntilExpiry = expiresAt - Date.now();
      if (timeUntilExpiry > 0) {
        setTimeout(() => {
          if (this.sessions.has(sessionId)) {
            // Close the WebSocket
            server.close(1000, 'Session expired');
            // Remove from sessions
            this.sessions.delete(sessionId);
            // Broadcast expiry to all users
            this.broadcast({
              type: 'session_expired',
              address: address.toLowerCase(),
            });
          }
        }, timeUntilExpiry);
      } else {
        // Already expired
        return new Response('Session already expired', { status: 401 });
      }
    }

    this.sessions.set(sessionId, session);

    // Set up event handlers
    server.addEventListener('message', (event) => {
      this.handleMessage(sessionId, event.data);
    });

    server.addEventListener('close', () => {
      this.sessions.delete(sessionId);
      this.broadcast({
        type: 'user_disconnected',
        address: address.toLowerCase(),
      }, sessionId);
    });

    server.addEventListener('error', () => {
      this.sessions.delete(sessionId);
    });

    // Send current online users to the new connection (including themselves)
    const onlineUsers = Array.from(this.sessions.values()).map(s => ({
      address: s.address,
      expiresAt: s.expiresAt,
    }));
    server.send(JSON.stringify({
      type: 'online_users',
      users: onlineUsers,
    }));

    // Notify others of new connection (excluding the new user)
    this.broadcast({
      type: 'user_connected',
      address: address.toLowerCase(),
      expiresAt,
    }, sessionId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(sessionId: string, data: string | ArrayBuffer) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'chat_message':
          this.handleChatMessage(session, message);
          break;
        case 'ping':
          session.webSocket.send(JSON.stringify({ type: 'pong' }));
          break;
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  /**
   * Handle chat messages
   */
  private handleChatMessage(session: WebSocketSession, message: any) {
    const chatMessage: Message = {
      from: session.address,
      to: message.to?.toLowerCase() || '',
      content: message.content, // encrypted content
      timestamp: Date.now(),
      signature: message.signature || '',
    };

    // Store message in history
    this.messageHistory.push(chatMessage);
    if (this.messageHistory.length > this.MAX_HISTORY) {
      this.messageHistory.shift();
    }

    // If message has a specific recipient, send only to them
    if (chatMessage.to && chatMessage.to.trim() !== '') {
      const recipientSession = Array.from(this.sessions.values()).find(
        s => s.address === chatMessage.to
      );

      if (recipientSession) {
        recipientSession.webSocket.send(JSON.stringify({
          type: 'chat_message',
          message: chatMessage,
        }));
      }

      // Also send confirmation back to sender
      session.webSocket.send(JSON.stringify({
        type: 'message_sent',
        message: chatMessage,
      }));
    } else {
      // Broadcast to all (including sender)
      this.broadcast({
        type: 'chat_message',
        message: chatMessage,
      }); // Don't pass excludeSessionId to include everyone
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  private broadcast(message: any, excludeSessionId?: string) {
    const messageStr = JSON.stringify(message);

    for (const [sessionId, session] of this.sessions.entries()) {
      if (!excludeSessionId || sessionId !== excludeSessionId) {
        try {
          session.webSocket.send(messageStr);
        } catch (error) {
          console.error('Error broadcasting to session:', sessionId, error);
          this.sessions.delete(sessionId);
        }
      }
    }
  }

  /**
   * Get message history
   */
  private handleGetMessages(request: Request): Response {
    const url = new URL(request.url);
    const address = url.searchParams.get('address');

    let messages = this.messageHistory;

    // Filter messages for specific address if provided
    if (address) {
      messages = messages.filter(
        m => m.from === address.toLowerCase() || m.to === address.toLowerCase()
      );
    }

    return new Response(JSON.stringify({ messages }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
