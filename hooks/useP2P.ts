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
  const [status, setStatus] = useState<'idle' | 'initializing' | 'connected' | 'error'>('idle'); // Removed 'waiting' state from here
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0); // Used to re-run effect
  
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const mountedRef = useRef(false);
  const onIncomingCallRef = useRef(onIncomingCall);
  const onMessageRef = useRef(onMessage);
  const initialConnectionAttempt = useRef(true); // Track if this is the very first connection attempt

  // Update refs when props change
  useEffect(() => {
    onIncomingCallRef.current = onIncomingCall;
  }, [onIncomingCall]);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // Function to store messages in a queue
  const enqueueMessage = useCallback((msg: P2PMessage) => {
    try {
      const queue = JSON.parse(localStorage.getItem(MESSAGE_QUEUE_KEY) || '[]');
      queue.push(msg);
      localStorage.setItem(MESSAGE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error("Failed to enqueue message:", e);
    }
  }, []);

  // Function to send all queued messages
  const sendQueuedMessages = useCallback(() => {
    if (connRef.current && connRef.current.open) {
      try {
        const queue: P2PMessage[] = JSON.parse(localStorage.getItem(MESSAGE_QUEUE_KEY) || '[]');
        if (queue.length > 0) {
          console.log(`Sending ${queue.length} queued messages.`);
          queue.forEach(msg => connRef.current?.send(msg));
          localStorage.removeItem(MESSAGE_QUEUE_KEY); // Clear queue after sending
        }
      } catch (e) {
        console.error("Failed to send queued messages:", e);
      }
    }
  }, []);

  // Helper to safely send data
  const sendMessage = useCallback((msg: P2PMessage) => {
    if (isTestMode) {
      if (onMessageRef.current) {
        // Simulate network delay for test mode
        setTimeout(() => onMessageRef.current!(msg), 50);
      }
      return;
    }
    
    if (connRef.current && connRef.current.open) {
      connRef.current.send(msg);
    } else {
      console.warn("Connection not open, enqueuing message:", msg.type);
      enqueueMessage(msg);
    }
  }, [isTestMode, enqueueMessage]);

  const callPeer = useCallback((stream: MediaStream) => {
    if (connRef.current && peerRef.current) {
       // Call the peer we are connected to via data channel
       return peerRef.current.call(connRef.current.peer, stream);
    }
    return null;
  }, []);

  const retry = useCallback(() => {
    setStatus('idle');
    setError(null);
    initialConnectionAttempt.current = true; // Reset for a full retry
    setRetryTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (isTestMode) {
      setStatus('connected');
      setConnectionStatus('connected');
      return;
    }

    const initPeer = async () => {
      setStatus('initializing');
      setConnectionStatus('reconnecting'); // Assume reconnecting until proven otherwise
      
      const PeerJS = (await import('peerjs')).default;

      // Host Peer ID is fixed, Guest Peer ID is random
      const peerId = role === 'host' 
        ? `tod-game-${gameCode.toLowerCase()}` 
        : `tod-guest-${gameCode.toLowerCase()}-${Math.random().toString(36).substr(2, 5)}`;

      const peer = new PeerJS(peerId, {
        config: { iceServers: STUN_SERVERS },
        debug: 1, // 0 = off, 1 = error, 2 = warn, 3 = info, 4 = debug
      });

      peerRef.current = peer;

      peer.on('open', (id) => {
        console.log(`My Peer ID: ${id}`);
        setStatus('connected'); // PeerJS connection open, ready to connect to peer
        if (role === 'guest') {
          connectToHost(peer);
        }
        // Host will wait for incoming connection or for GameRoom to initiate a state sync
      });

      peer.on('connection', (conn) => {
        if (role === 'host') {
          handleConnection(conn);
        } else {
          // Should not happen for guest, only one connection
          conn.close();
        }
      });

      peer.on('call', (call) => {
        if (onIncomingCallRef.current) {
          onIncomingCallRef.current(call);
        }
      });

      peer.on('error', (err: any) => {
        console.error('Peer error:', err);
        if (!mountedRef.current) return;

        if (err.type === 'unavailable-id') {
           if (role === 'host') {
             // For host, a taken ID means either another instance is active or a stale session.
             // Automatic retry with the same ID is not effective here.
             setError("Game session active in another tab or the ID is taken. Please wait a moment or try creating a new game.");
             setStatus('error');
             setConnectionStatus('disconnected');
           } else { // guest unavailable-id (shouldn't happen often, guest IDs are random)
             setError("Cannot connect: Guest ID unavailable. This is unusual, please retry.");
             setStatus('error');
             setConnectionStatus('disconnected');
           }
        } else if (err.type === 'peer-unavailable') {
           // For guest, if host is unavailable on initial connect (and not yet connected)
           if (role === 'guest' && initialConnectionAttempt.current) { 
             setError("Game not found. Check the code or host might not be ready.");
             setStatus('error');
             setConnectionStatus('disconnected');
           } else { // Peer became unavailable during game, or host tried to connect to guest
             console.warn("Peer unavailable during game, attempting reconnect...");
             setConnectionStatus('reconnecting');
             // Trigger a full re-initialization to ensure a clean slate
             if (peerRef.current && !peerRef.current.destroyed) {
               peerRef.current.destroy();
               peerRef.current = null;
             }
             setRetryTrigger(prev => prev + 1);
           }
        } else if (err.type === 'disconnected' || err.type === 'network') {
           console.warn(`Peer ${err.type} error, attempting full re-initialization...`);
           setConnectionStatus('reconnecting');
           if (peerRef.current && !peerRef.current.destroyed) {
             peerRef.current.destroy(); // Destroy current peer
             peerRef.current = null;
           }
           setRetryTrigger(prev => prev + 1); // Trigger new initPeer()
        }
        else {
          setError("Connection error: " + err.type);
          setStatus('error');
          setConnectionStatus('disconnected');
        }
      });

      peer.on('disconnected', () => {
        console.warn("PeerJS disconnected. Will attempt to re-establish connection.");
        // PeerJS often tries to auto-reconnect. We'll rely on the 'error' handler for 'disconnected' type
        // or the general mechanism to trigger a full re-initialization if connection isn't restored.
        setConnectionStatus('reconnecting');
      });
    };

    const connectToHost = (peer: Peer) => {
      const hostId = `tod-game-${gameCode.toLowerCase()}`;
      console.log(`Guest connecting to host: ${hostId}`);
      // Only connect if not already connected to this host, or if connection is closed/null
      if (!connRef.current || connRef.current.peer !== hostId || !connRef.current.open) {
        // If connRef.current is a *different* peer or closed, create a new connection
        const conn = peer.connect(hostId, { reliable: true });
        handleConnection(conn);
      }
    };

    const handleConnection = (conn: DataConnection) => {
      // If host, check if already connected to someone else and close the new connection
      if (role === 'host' && connRef.current && connRef.current.open && connRef.current.peer !== conn.peer) {
        console.warn("Host already has an open connection, closing new one.");
        conn.close();
        return;
      }
      
      // If we already have an open connection to this specific peer, don't re-handle.
      if (connRef.current && connRef.current.open && connRef.current.peer === conn.peer) {
        return; 
      }

      connRef.current = conn;

      conn.on('open', () => {
        console.log("Data connection opened!");
        setConnectionStatus('connected');
        initialConnectionAttempt.current = false; // Connection established, no longer initial attempt
        sendMessage({ 
          type: 'PLAYER_INFO', 
          payload: { name: playerName, role } 
        });
        sendQueuedMessages(); // Send any messages queued while disconnected
      });

      conn.on('data', (data: any) => {
        if (onMessageRef.current) {
          onMessageRef.current(data as P2PMessage);
        }
      });

      conn.on('close', () => {
        console.log("Data connection closed.");
        connRef.current = null;
        if (mountedRef.current) {
          setConnectionStatus('disconnected');
          // If connection closed, and PeerJS itself is still alive, try to reconnect
          if (peerRef.current && !peerRef.current.destroyed) {
            // If guest, try to connect to host again.
            if (role === 'guest') {
              setTimeout(() => { // Give a small delay before attempting reconnect
                if (mountedRef.current && connectionStatus !== 'connected') { // Only try if not reconnected already
                  connectToHost(peerRef.current!);
                }
              }, 1000);
            }
          }
        }
      });

      conn.on('error', (err) => {
        console.error("Data connection error:", err);
        if (mountedRef.current) {
          setConnectionStatus('disconnected');
          // If a data connection error occurs, trigger a full peer re-initialization to recover
          if (peerRef.current && !peerRef.current.destroyed) {
            peerRef.current.destroy();
            peerRef.current = null;
          }
          setRetryTrigger(prev => prev + 1);
        }
      });
    };

    initPeer();

    return () => {
      mountedRef.current = false;
      connRef.current?.close();
      peerRef.current?.destroy();
      localStorage.removeItem(MESSAGE_QUEUE_KEY); // Clear queue on exit
    };
  }, [role, gameCode, playerName, isTestMode, retryTrigger, sendMessage, sendQueuedMessages, connectionStatus]);

  return { status, connectionStatus, error, sendMessage, callPeer, retry };
}