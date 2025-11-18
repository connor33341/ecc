import { ChatRoom } from './chatroom';
import { AuthManager } from './auth';

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
}

export { ChatRoom };

const authManager = new AuthManager();

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Handle CORS preflight requests
 */
function handleOptions(request: Request): Response {
  return new Response(null, {
    headers: corsHeaders,
  });
}

/**
 * Main worker handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // API Routes
    if (url.pathname.startsWith('/api/')) {
      return handleAPIRequest(request, env, url);
    }

    // WebSocket route - forward to Durable Object
    if (url.pathname === '/ws') {
      return handleWebSocketRequest(request, env, url);
    }

    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders 
    });
  },
};

/**
 * Handle API requests
 */
async function handleAPIRequest(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  // Clean up expired challenges and sessions periodically
  if (Math.random() < 0.01) {
    authManager.cleanup();
  }

  // Get challenge endpoint
  if (url.pathname === '/api/auth/challenge' && request.method === 'GET') {
    const sessionId = crypto.randomUUID();
    const challenge = authManager.generateChallenge();
    authManager.storeChallenge(sessionId, challenge);

    return new Response(
      JSON.stringify({ sessionId, challenge }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  // Verify proof endpoint
  if (url.pathname === '/api/auth/verify' && request.method === 'POST') {
    try {
      const { sessionId, proof, address, expiresAt } = await request.json() as {
        sessionId: string;
        proof: string;
        address: string;
        expiresAt?: number | null;
      };

      const result = await authManager.verifyProof(sessionId, proof, address, expiresAt);

      if (result.success) {
        return new Response(
          JSON.stringify({
            success: true,
            address: result.address,
            sessionId,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } else {
        return new Response(
          JSON.stringify({ success: false, error: result.error }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Session validation endpoint
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Missing sessionId' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const session = authManager.getSession(sessionId);

    if (session) {
      return new Response(
        JSON.stringify({
          valid: true,
          address: session.address,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else {
      return new Response(
        JSON.stringify({ valid: false, error: 'Session not found or expired' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Logout endpoint
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    try {
      const { sessionId } = await request.json() as { sessionId: string };
      authManager.removeSession(sessionId);

      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  }

  return new Response('Not Found', {
    status: 404,
    headers: corsHeaders,
  });
}

/**
 * Handle WebSocket requests
 */
async function handleWebSocketRequest(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    return new Response('Missing sessionId', { 
      status: 400,
      headers: corsHeaders 
    });
  }

  // Verify session
  const session = authManager.getSession(sessionId);

  if (!session) {
    return new Response('Invalid or expired session', { 
      status: 401,
      headers: corsHeaders 
    });
  }

  // Get Durable Object instance
  const id = env.CHAT_ROOM.idFromName('global-chat');
  const stub = env.CHAT_ROOM.get(id);

  // Forward request to Durable Object with address
  const newUrl = new URL(request.url);
  newUrl.searchParams.set('address', session.address);

  const newRequest = new Request(newUrl.toString(), request);

  return stub.fetch(newRequest);
}
