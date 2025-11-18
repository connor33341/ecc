var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-pXIXgj/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-pXIXgj/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/chatroom.ts
import { DurableObject } from "cloudflare:workers";
var ChatRoom = class extends DurableObject {
  sessions = /* @__PURE__ */ new Map();
  messageHistory = [];
  MAX_HISTORY = 100;
  constructor(state, env) {
    super(state, env);
  }
  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }
    if (url.pathname === "/messages") {
      return this.handleGetMessages(request);
    }
    return new Response("Not found", { status: 404 });
  }
  /**
   * Handle WebSocket connections
   */
  async handleWebSocket(request) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const address = url.searchParams.get("address");
    if (!sessionId || !address) {
      return new Response("Missing sessionId or address", { status: 400 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const session = {
      webSocket: server,
      address: address.toLowerCase(),
      sessionId
    };
    this.sessions.set(sessionId, session);
    server.addEventListener("message", (event) => {
      this.handleMessage(sessionId, event.data);
    });
    server.addEventListener("close", () => {
      this.sessions.delete(sessionId);
      this.broadcast({
        type: "user_disconnected",
        address: address.toLowerCase()
      }, sessionId);
    });
    server.addEventListener("error", () => {
      this.sessions.delete(sessionId);
    });
    this.broadcast({
      type: "user_connected",
      address: address.toLowerCase()
    }, sessionId);
    const onlineUsers = Array.from(this.sessions.values()).map((s) => s.address);
    server.send(JSON.stringify({
      type: "online_users",
      users: onlineUsers
    }));
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session)
      return;
    try {
      const message = JSON.parse(data.toString());
      switch (message.type) {
        case "chat_message":
          this.handleChatMessage(session, message);
          break;
        case "ping":
          session.webSocket.send(JSON.stringify({ type: "pong" }));
          break;
        default:
          console.warn("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("Error handling message:", error);
    }
  }
  /**
   * Handle chat messages
   */
  handleChatMessage(session, message) {
    const chatMessage = {
      from: session.address,
      to: message.to?.toLowerCase() || "",
      content: message.content,
      // encrypted content
      timestamp: Date.now(),
      signature: message.signature || ""
    };
    this.messageHistory.push(chatMessage);
    if (this.messageHistory.length > this.MAX_HISTORY) {
      this.messageHistory.shift();
    }
    if (chatMessage.to) {
      const recipientSession = Array.from(this.sessions.values()).find(
        (s) => s.address === chatMessage.to
      );
      if (recipientSession) {
        recipientSession.webSocket.send(JSON.stringify({
          type: "chat_message",
          message: chatMessage
        }));
      }
      session.webSocket.send(JSON.stringify({
        type: "message_sent",
        message: chatMessage
      }));
    } else {
      this.broadcast({
        type: "chat_message",
        message: chatMessage
      });
    }
  }
  /**
   * Broadcast a message to all connected clients except the sender
   */
  broadcast(message, excludeSessionId) {
    const messageStr = JSON.stringify(message);
    for (const [sessionId, session] of this.sessions.entries()) {
      if (sessionId !== excludeSessionId) {
        try {
          session.webSocket.send(messageStr);
        } catch (error) {
          console.error("Error broadcasting to session:", sessionId, error);
          this.sessions.delete(sessionId);
        }
      }
    }
  }
  /**
   * Get message history
   */
  handleGetMessages(request) {
    const url = new URL(request.url);
    const address = url.searchParams.get("address");
    let messages = this.messageHistory;
    if (address) {
      messages = messages.filter(
        (m) => m.from === address.toLowerCase() || m.to === address.toLowerCase()
      );
    }
    return new Response(JSON.stringify({ messages }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
__name(ChatRoom, "ChatRoom");

// src/auth.ts
var AuthManager = class {
  challenges = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Map();
  CHALLENGE_EXPIRY = 5 * 60 * 1e3;
  // 5 minutes
  SESSION_EXPIRY = 24 * 60 * 60 * 1e3;
  // 24 hours
  /**
   * Generate a challenge for authentication
   */
  generateChallenge() {
    const challenge = `Sign this message to authenticate with ECC:

Nonce: ${crypto.randomUUID()}
Timestamp: ${Date.now()}`;
    return challenge;
  }
  /**
   * Store a challenge for later verification
   */
  storeChallenge(sessionId, challenge) {
    this.challenges.set(sessionId, {
      challenge,
      timestamp: Date.now()
    });
  }
  /**
   * Verify that proof matches the challenge (user encrypted then decrypted it)
   */
  async verifyProof(sessionId, proof, address) {
    const challengeData = this.challenges.get(sessionId);
    if (!challengeData) {
      return { success: false, error: "Challenge not found" };
    }
    if (Date.now() - challengeData.timestamp > this.CHALLENGE_EXPIRY) {
      this.challenges.delete(sessionId);
      return { success: false, error: "Challenge expired" };
    }
    try {
      if (proof !== challengeData.challenge) {
        return { success: false, error: "Invalid proof - challenge mismatch" };
      }
      this.sessions.set(sessionId, {
        address,
        authenticated: true,
        timestamp: Date.now()
      });
      this.challenges.delete(sessionId);
      return { success: true, address };
    } catch (error) {
      console.error("Proof verification error:", error);
      return { success: false, error: "Invalid proof format" };
    }
  }
  /**
   * Get session for a sessionId
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    if (Date.now() - session.timestamp > this.SESSION_EXPIRY) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }
  /**
   * Remove a session
   */
  removeSession(sessionId) {
    this.sessions.delete(sessionId);
  }
  /**
   * Clean up expired challenges and sessions
   */
  cleanup() {
    const now = Date.now();
    for (const [id, challenge] of this.challenges.entries()) {
      if (now - challenge.timestamp > this.CHALLENGE_EXPIRY) {
        this.challenges.delete(id);
      }
    }
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.timestamp > this.SESSION_EXPIRY) {
        this.sessions.delete(id);
      }
    }
  }
};
__name(AuthManager, "AuthManager");

// src/index.ts
var authManager = new AuthManager();
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function handleOptions(request) {
  return new Response(null, {
    headers: corsHeaders
  });
}
__name(handleOptions, "handleOptions");
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }
    if (url.pathname.startsWith("/api/")) {
      return handleAPIRequest(request, env, url);
    }
    if (url.pathname === "/ws") {
      return handleWebSocketRequest(request, env, url);
    }
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};
async function handleAPIRequest(request, env, url) {
  if (Math.random() < 0.01) {
    authManager.cleanup();
  }
  if (url.pathname === "/api/auth/challenge" && request.method === "GET") {
    const sessionId = crypto.randomUUID();
    const challenge = authManager.generateChallenge();
    authManager.storeChallenge(sessionId, challenge);
    return new Response(
      JSON.stringify({ sessionId, challenge }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
  if (url.pathname === "/api/auth/verify" && request.method === "POST") {
    try {
      const { sessionId, proof, address } = await request.json();
      const result = await authManager.verifyProof(sessionId, proof, address);
      if (result.success) {
        return new Response(
          JSON.stringify({
            success: true,
            address: result.address,
            sessionId
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      } else {
        return new Response(
          JSON.stringify({ success: false, error: result.error }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
  }
  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      return new Response(
        JSON.stringify({ valid: false, error: "Missing sessionId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
    const session = authManager.getSession(sessionId);
    if (session) {
      return new Response(
        JSON.stringify({
          valid: true,
          address: session.address
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    } else {
      return new Response(
        JSON.stringify({ valid: false, error: "Session not found or expired" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    try {
      const { sessionId } = await request.json();
      authManager.removeSession(sessionId);
      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
  }
  return new Response("Not Found", {
    status: 404,
    headers: corsHeaders
  });
}
__name(handleAPIRequest, "handleAPIRequest");
async function handleWebSocketRequest(request, env, url) {
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return new Response("Missing sessionId", {
      status: 400,
      headers: corsHeaders
    });
  }
  const session = authManager.getSession(sessionId);
  if (!session) {
    return new Response("Invalid or expired session", {
      status: 401,
      headers: corsHeaders
    });
  }
  const id = env.CHAT_ROOM.idFromName("global-chat");
  const stub = env.CHAT_ROOM.get(id);
  const newUrl = new URL(request.url);
  newUrl.searchParams.set("address", session.address);
  const newRequest = new Request(newUrl.toString(), request);
  return stub.fetch(newRequest);
}
__name(handleWebSocketRequest, "handleWebSocketRequest");

// ../node_modules/.pnpm/wrangler@3.114.15_@cloudflare+workers-types@4.20251118.0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/.pnpm/wrangler@3.114.15_@cloudflare+workers-types@4.20251118.0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-pXIXgj/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/.pnpm/wrangler@3.114.15_@cloudflare+workers-types@4.20251118.0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-pXIXgj/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ChatRoom,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
