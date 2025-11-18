import { ChatRoom } from './chatroom';

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
}

export { ChatRoom };
