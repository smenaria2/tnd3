import { useEffect, useRef, useState, useCallback } from 'react';
import type Peer from 'peerjs';
import type { DataConnection, MediaConnection } from 'peerjs';
import { STUN_SERVERS } from '../lib/constants';
import { P2PMessage } from '../lib/types';

interface UseP2PProps {
  role: 'host' | 'guest';
  gameCode: string;
  playerName: string;
  onMessage: (msg: P2PMessage) => void;
  onIncomingCall?: (call: MediaConnection) => void;
  isTestMode?: boolean;
}

const MESSAGE_QUEUE_KEY = 'p2p_message_queue';

export function useP2P({ role, gameCode, playerName, onMessage, onIncomingCall, isTestMode }: UseP2PProps) {
  const [status, setStatus] = useState<'idle' | 'initializing' | 'connected' | 'error'>('idle');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0); 
  
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const mountedRef = useRef(false);
  const onIncomingCallRef = useRef(onIncomingCall);
  const onMessageRef = useRef(onMessage);
  const retryCountRef = useRef(0);
  
  // Track specific retries for unavailable ID to avoid infinite loops
  const unavailableIdRetries = useRef(0);
  const MAX_UNAVAILABLE_RETRIES = 5;

  // Update refs when props change
  useEffect(() => {
    onIncomingCallRef.current = onIncomingCall;
  }, [onIncomingCall]);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const enqueueMessage = useCallback((msg: P2PMessage) => {
    try {
      const queue = JSON.parse(localStorage.getItem(MESSAGE_QUEUE_KEY) || '[]');
      queue.push(msg);
      localStorage.setItem(MESSAGE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error("Failed to enqueue message:", e);
    }
  }, []);

  const sendQueuedMessages = useCallback(() => {
    if (connRef.current && connRef.current.open) {
      try {
        const queue: P2PMessage[] = JSON.parse(localStorage.getItem(MESSAGE_QUEUE_KEY) || '[]');
        if (queue.length > 0) {
          queue.forEach(msg => connRef.current?.send(msg));
          localStorage.removeItem(MESSAGE_QUEUE_KEY);
        }
      } catch (e) {
        console.error("Failed to send queued messages:", e);
      }
    }
  }, []);

  const sendMessage = useCallback((msg: P2PMessage) => {
    if (isTestMode) {
      if (onMessageRef.current) {
        setTimeout(() => onMessageRef.current!(msg), 50);
      }
      return;
    }
    
    if (connRef.current && connRef.current.open) {
      connRef.current.send(msg);
    } else {
      enqueueMessage(msg);
    }
  }, [isTestMode, enqueueMessage]);

  const callPeer = useCallback((stream: MediaStream) => {
    if (connRef.current && peerRef.current) {
       return peerRef.current.call(connRef.current.peer, stream);
    }
    return null;
  }, []);

  const retry = useCallback(() => {
    setStatus('idle');
    setError(null);
    unavailableIdRetries.current = 0;
    setRetryTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let initTimeout: ReturnType<typeof setTimeout>;

    if (isTestMode) {
      setStatus('connected');
      setConnectionStatus('connected');
      return;
    }

    const initPeer = async () => {
      setStatus('initializing');
      setConnectionStatus('reconnecting');
      
      const PeerJS = (await import('peerjs')).default;

      // Force cleanup of any lingering instance
      if (peerRef.current) {
        if (!peerRef.current.destroyed) peerRef.current.destroy();
        peerRef.current = null;
      }

      // Host Peer ID is fixed, Guest Peer ID is random
      const peerId = role === 'host' 
        ? `tod-game-${gameCode.toLowerCase()}` 
        : `tod-guest-${gameCode.toLowerCase()}-${Math.random().toString(36).substr(2, 6)}`;

      console.log(`[P2P] Initializing Peer with ID: ${peerId}`);

      const peer = new PeerJS(peerId, {
        config: { iceServers: STUN_SERVERS },
        debug: 1, 
      });

      peerRef.current = peer;

      peer.on('open', (id) => {
        console.log(`[P2P] Peer Open. ID: ${id}`);
        unavailableIdRetries.current = 0; // Reset retry counter on success
        setStatus('connected');
        if (role === 'guest') {
          connectToHost(peer);
        }
      });

      peer.on('connection', (conn) => {
        if (role === 'host') {
          handleConnection(conn);
        } else {
          conn.close();
        }
      });

      peer.on('call', (call) => {
        if (onIncomingCallRef.current) {
          onIncomingCallRef.current(call);
        }
      });

      peer.on('error', (err: any) => {
        console.warn('[P2P] Peer Error:', err.type, err.message);
        if (!mountedRef.current) return;

        if (err.type === 'unavailable-id') {
           if (role === 'host') {
             // If ID is taken, it's likely a zombie connection from refresh.
             if (unavailableIdRetries.current < MAX_UNAVAILABLE_RETRIES) {
                unavailableIdRetries.current++;
                console.log(`[P2P] Host ID unavailable. Retrying in 2s... (${unavailableIdRetries.current}/${MAX_UNAVAILABLE_RETRIES})`);
                setStatus('initializing'); 
                // Don't set 'error' status yet, just silently retry
                if (peerRef.current) peerRef.current.destroy();
                initTimeout = setTimeout(() => {
                   if (mountedRef.current) setRetryTrigger(prev => prev + 1);
                }, 2000);
             } else {
                setError("Game session active in another tab or ID stuck. Please wait a moment or create a new game.");
                setStatus('error');
             }
           } else {
             // Guest ID collision (rare), retry immediately with new random ID
             setRetryTrigger(prev => prev + 1);
           }
        } else if (err.type === 'peer-unavailable') {
           if (role === 'guest') {
             // Host not online yet or ID mismatch
             console.log("[P2P] Host unavailable, will retry connecting...");
             setConnectionStatus('reconnecting');
             // Try to connect again in a few seconds without destroying peer
             setTimeout(() => {
               if (mountedRef.current && peerRef.current && !peerRef.current.destroyed && !connRef.current?.open) {
                 connectToHost(peerRef.current);
               }
             }, 3000);
           }
        } else if (err.type === 'disconnected' || err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
           console.log("[P2P] Network error. Attempting reconnect...");
           setConnectionStatus('reconnecting');
           // Attempt PeerJS reconnect
           if (peer && !peer.destroyed && !peer.disconnected) return; // False alarm
           
           if (peer && !peer.destroyed) {
               peer.reconnect();
           } else {
               // Full restart needed
               initTimeout = setTimeout(() => setRetryTrigger(prev => prev + 1), 2000);
           }
        }
        else {
          // Other errors
          setError(`Connection error: ${err.type}`);
          setStatus('error');
        }
      });

      peer.on('disconnected', () => {
        console.warn("[P2P] Disconnected from signaling server.");
        if (role === 'host' && !peer.destroyed) {
            // Host should always try to stay connected
            setTimeout(() => {
               if(mountedRef.current && !peer.destroyed) peer.reconnect();
            }, 1000);
        }
      });
    };

    const connectToHost = (peer: Peer) => {
      const hostId = `tod-game-${gameCode.toLowerCase()}`;
      if (!connRef.current || connRef.current.peer !== hostId || !connRef.current.open) {
        console.log(`[P2P] Guest connecting to host: ${hostId}`);
        const conn = peer.connect(hostId, { reliable: true });
        handleConnection(conn);
      }
    };

    const handleConnection = (conn: DataConnection) => {
      if (role === 'host' && connRef.current && connRef.current.open && connRef.current.peer !== conn.peer) {
        conn.close(); // Host only accepts one guest
        return;
      }
      
      // Prevent duplicate handlers on same connection object
      if (connRef.current === conn) return;

      connRef.current = conn;

      conn.on('open', () => {
        console.log("[P2P] Data connection established!");
        setConnectionStatus('connected');
        unavailableIdRetries.current = 0;
        sendMessage({ 
          type: 'PLAYER_INFO', 
          payload: { name: playerName, role } 
        });
        sendQueuedMessages();
      });

      conn.on('data', (data: any) => {
        if (onMessageRef.current) {
          onMessageRef.current(data as P2PMessage);
        }
      });

      conn.on('close', () => {
        console.log("[P2P] Data connection closed.");
        connRef.current = null;
        if (mountedRef.current) {
          setConnectionStatus('disconnected');
          // If guest, try to reconnect to host
          if (role === 'guest' && peerRef.current && !peerRef.current.destroyed) {
             setTimeout(() => {
                 if (mountedRef.current && connectionStatus !== 'connected') {
                     connectToHost(peerRef.current!);
                 }
             }, 2000);
          }
        }
      });

      conn.on('error', (err) => {
        console.error("[P2P] Data connection error:", err);
        if (mountedRef.current) {
             connRef.current = null;
             setConnectionStatus('disconnected');
             // If connection errors out, try to create a new one
             if (role === 'guest' && peerRef.current && !peerRef.current.destroyed) {
                 setTimeout(() => connectToHost(peerRef.current!), 2000);
             }
        }
      });
    };

    // Delay initialization slightly to handle React Strict Mode double-mount
    // and ensure previous peer destruction has propagated
    initTimeout = setTimeout(initPeer, 500);

    return () => {
      mountedRef.current = false;
      clearTimeout(initTimeout);
      connRef.current?.close();
      peerRef.current?.destroy();
      localStorage.removeItem(MESSAGE_QUEUE_KEY);
    };
  }, [role, gameCode, playerName, isTestMode, retryTrigger, sendMessage, sendQueuedMessages]);

  return { status, connectionStatus, error, sendMessage, callPeer, retry };
}