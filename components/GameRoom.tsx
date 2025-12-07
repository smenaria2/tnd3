
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useP2P } from '../hooks/useP2P';
import { GameState, IntensityLevel, P2PMessage, PlayerRole, TurnRecord, ChatMessage, MediaType, CallStatus, GameMode, SavedSession } from '../lib/types';
import { QUESTIONS, INTENSITY_LEVELS, QUESTIONS_PER_RANDOM_LEVEL, RANDOM_MODE_INTENSITY_ORDER, RANDOM_EMOJIS } from '../lib/constants';
import { formatTime, cn } from '../lib/utils';
import { MediaRecorder } from './MediaRecorder';
import { TutorialTooltip } from './TutorialTooltip';
import { VideoCallOverlay } from './VideoCallOverlay';
import { GameWaitingScreen } from './game/GameWaitingScreen';
import { Send, Image as ImageIcon, MessageSquare, LogOut, CheckCircle, XCircle, Shuffle, Edit2, Heart, Clock, Timer as TimerIcon, Trophy, Plus, X, Video, AlertCircle, RefreshCw, Copy, Check, Link, Share2, HeartHandshake } from 'lucide-react';
import type { MediaConnection } from 'peerjs';
import { Button } from './common/Button';
import { Input } from './common/Input';
import { Loader } from './common/Loader';
import { useToast } from '../hooks/useToast';
import { calculateScoreValue, getStreak } from '../lib/scoring';
import { GameHeader } from './game/GameHeader';
import { IncomingIntensityRequestModal } from './modals/IncomingIntensityRequestModal';
import { GameSelectionPhase } from './game/phases/GameSelectionPhase';
import { QuestionSelectionPhase } from './game/phases/QuestionSelectionPhase';
import { AnswerPhase } from './game/phases/AnswerPhase';
import { ReviewPhase } from './game/phases/ReviewPhase';
import { TurnHistoryFeed } from './game/TurnHistoryFeed';
import { ChatOverlay } from './chat/ChatOverlay';
import { FloatingEmoji } from './FloatingEmoji';
import { GameErrorScreen } from './game/GameErrorScreen';
import { ToastDisplay } from './common/ToastDisplay';

interface GameRoomProps {
  role: PlayerRole;
  gameCode: string;
  playerName: string;
  intensity: IntensityLevel;
  gameMode: GameMode;
  isTestMode?: boolean;
  onExit: () => void;
}

const TIMER_OPTIONS = [0, 30, 60, 120];

interface FloatingEmojiInstance {
  id: string;
  emoji: string;
  position: { x: number; y: number };
  startTime: number;
}

export const GameRoom: React.FC<GameRoomProps> = ({ role, gameCode, playerName, intensity, gameMode, isTestMode, onExit }) => {
  // --- Game State ---
  const [gameState, setGameState] = useState<GameState>(() => {
    if (!isTestMode) {
      try {
        const stored = localStorage.getItem(`tod_game_${gameCode}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Date.now() - parsed.lastUpdated < 24 * 60 * 60 * 1000) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn("Failed to restore game state", e);
      }
    }
    
    return {
      gameCode,
      intensityLevel: intensity,
      gameMode: gameMode,
      currentRandomModeIntensity: gameMode === 'random' ? RANDOM_MODE_INTENSITY_ORDER[0] : intensity,
      questionsAnsweredInCurrentLevel: 0,
      currentTurn: 'guest', // Guest goes first usually
      phase: 'waiting', 
      turnHistory: [],
      activeTurn: null,
      hostName: role === 'host' ? playerName : 'Waiting...',
      guestName: role === 'guest' ? playerName : 'Waiting...',
      scores: { host: 0, guest: 0 },
      chatMessages: [],
      lastUpdated: Date.now(),
    };
  });

  // --- UI State ---
  const [inputMessage, setInputMessage] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [draftQuestion, setDraftQuestion] = useState('');
  const [selectedTimer, setSelectedTimer] = useState<number>(0);
  const [isCustomQuestion, setIsCustomQuestion] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [showChatMedia, setShowChatMedia] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isLovedInReview, setIsLovedInReview] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmojiInstance[]>([]);
  
  // Intensity Change State
  const [showIntensitySelector, setShowIntensitySelector] = useState(false);
  const [pendingIntensityRequest, setPendingIntensityRequest] = useState<{ level: IntensityLevel, requester: string } | null>(null);
  
  // --- Call State ---
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoStopped, setIsVideoStopped] = useState(false);

  // Connection UI states for waiting screen
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const gameRoomRef = useRef<HTMLDivElement>(null);
  const prevTurnIdRef = useRef<string | null>(null);
  const currentCallRef = useRef<MediaConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { addToast } = useToast();

  // --- Persistence Effect ---
  useEffect(() => {
    if (isTestMode) return;
    
    const stateToSave = { ...gameState, lastUpdated: Date.now() };
    localStorage.setItem(`tod_game_${gameCode}`, JSON.stringify(stateToSave));

    if (gameState.hostName !== 'Waiting...' && gameState.guestName !== 'Waiting...') {
      const session: SavedSession = {
        gameCode,
        hostName: gameState.hostName,
        guestName: gameState.guestName,
        myRole: role,
        myName: playerName,
        scores: gameState.scores,
        timestamp: Date.now(),
        intensity: gameState.intensityLevel,
        gameMode: gameState.gameMode
      };

      try {
        const stored = localStorage.getItem('tod_sessions');
        let sessions: SavedSession[] = stored ? JSON.parse(stored) : [];
        sessions = sessions.filter(s => s.gameCode !== gameCode);
        sessions.unshift(session);
        if (sessions.length > 5) sessions.pop();
        localStorage.setItem('tod_sessions', JSON.stringify(sessions));
      } catch (e) {
        console.error("Failed to save session metadata", e);
      }
    }
  }, [gameState, gameCode, isTestMode, role, playerName]);

  // --- Helpers ---
  const isMyTurn = gameState.currentTurn === role;
  const currentActiveIntensity = gameState.gameMode === 'random' ? gameState.currentRandomModeIntensity : gameState.intensityLevel;
  
  let canAct = !!isTestMode;
  if (!isTestMode) {
    if (!gameState.activeTurn) {
        canAct = isMyTurn;
    } else {
        switch (gameState.activeTurn.status) {
            case 'selecting': canAct = !isMyTurn; break;
            case 'pending': canAct = isMyTurn; break;
            case 'answered': canAct = !isMyTurn; break;
            default: canAct = false;
        }
    }
  }

  // P2P Refs
  const sendMessageRef = useRef< (msg: P2PMessage) => void >(() => { console.warn("sendMessage not initialized"); });
  const callPeerRef = useRef< (stream: MediaStream) => MediaConnection | null >(() => { console.warn("callPeer not initialized"); return null; });
  const retryRef = useRef< () => void >(() => { console.warn("retry not initialized"); });

  // --- Callbacks and P2P ---
  const broadcastState = useCallback((newState: GameState) => {
    setGameState(newState);
    if (!isTestMode) {
      sendMessageRef.current({ type: 'GAME_STATE_SYNC', payload: newState });
    }
  }, [isTestMode]);

  const handleEndCall = useCallback((notify = true) => {
    if (notify && !isTestMode) sendMessageRef.current({ type: 'CALL_END', payload: {} });
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setCallStatus('idle');
    setIsMuted(false);
    setIsVideoStopped(false);
    
    if (currentCallRef.current) {
      currentCallRef.current.close();
      currentCallRef.current = null;
    }
  }, [isTestMode]);

  const handleIncomingStream = useCallback((call: MediaConnection) => {
    console.log("Incoming peer call received");
    currentCallRef.current = call;
    setCallStatus('ringing');
    
    call.on('stream', (remote) => {
      setRemoteStream(remote);
      setCallStatus('connected');
    });
    
    call.on('close', () => {
      handleEndCall(false);
    });

    // If we already have a stream (e.g. mutual call), answer immediately?
    // For now, wait for accept.
  }, [handleEndCall]);

  const handleP2PMessage = useCallback((msg: P2PMessage) => {
    console.log("Received P2P Message:", msg.type);
    switch (msg.type) {
      case 'GAME_STATE_SYNC':
        setGameState(msg.payload);
        break;
      case 'PLAYER_INFO':
        if (role === 'host') {
           const newGameState = {
             ...gameState,
             guestName: msg.payload.name,
             phase: 'playing' as const
           };
           setGameState(newGameState);
           sendMessageRef.current({ type: 'GAME_STATE_SYNC', payload: newGameState });
        }
        break;
      case 'CHAT_MESSAGE':
        setGameState(prev => ({
          ...prev,
          chatMessages: [...prev.chatMessages, msg.payload]
        }));
        if (!showChat) addToast({ title: 'New Message', message: `${msg.payload.senderName} sent a message`, type: 'info', action: { label: 'View', onClick: () => setShowChat(true) } });
        break;
      case 'PING_EMOJI':
         const id = Math.random().toString(36).substr(2, 9);
         const x = Math.random() * 80 + 10;
         setFloatingEmojis(prev => [...prev, { id, emoji: msg.payload.emoji, position: { x: window.innerWidth * (x/100), y: window.innerHeight - 100 }, startTime: Date.now() }]);
         setTimeout(() => setFloatingEmojis(prev => prev.filter(e => e.id !== id)), 4000);
         break;
      case 'CALL_OFFER':
        setCallStatus('ringing');
        break;
      case 'CALL_ACCEPT':
        setCallStatus('connected');
        break;
      case 'CALL_REJECT':
        setCallStatus('idle');
        addToast({ title: 'Call Declined', message: 'Partner is busy.', type: 'error' });
        break;
      case 'CALL_END':
        handleEndCall(false);
        break;
      case 'INTENSITY_REQUEST':
        setPendingIntensityRequest({ level: msg.payload.level, requester: role === 'host' ? gameState.guestName : gameState.hostName });
        break;
      case 'INTENSITY_RESPONSE':
        if (msg.payload.accepted && msg.payload.level) {
           addToast({ title: 'Intensity Changed', message: `Level changed to ${msg.payload.level}`, type: 'success' });
           if (role === 'host') {
             const newState = { ...gameState, intensityLevel: msg.payload.level };
             broadcastState(newState);
           }
        } else {
           addToast({ title: 'Request Denied', message: 'Partner declined intensity change.', type: 'error' });
        }
        break;
    }
  }, [gameState, role, showChat, addToast, handleEndCall, broadcastState]);

  const { status: p2pStatus, connectionStatus, error: p2pError, sendMessage, callPeer, retry } = useP2P({
    role,
    gameCode,
    playerName,
    onMessage: handleP2PMessage,
    onIncomingCall: handleIncomingStream,
    isTestMode
  });

  useEffect(() => {
    sendMessageRef.current = sendMessage;
    callPeerRef.current = callPeer;
    retryRef.current = retry;
  }, [sendMessage, callPeer, retry]);

  // --- Scroll Chat ---
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [gameState.chatMessages, showChat]);

  // --- Timer Logic ---
  useEffect(() => {
    if (gameState.activeTurn?.status === 'pending' && gameState.activeTurn.timeLimit && gameState.activeTurn.startedAt) {
      const deadline = gameState.activeTurn.startedAt + (gameState.activeTurn.timeLimit * 1000);
      const interval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) {
          clearInterval(interval);
          if (canAct) failTurn();
        }
      }, 1000);
      timerRef.current = interval;
      return () => clearInterval(interval);
    } else {
      setTimeLeft(null);
    }
  }, [gameState.activeTurn, canAct]);

  // --- Call Actions ---
  const handleAcceptCall = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;
      setCallStatus('connected');
      sendMessageRef.current({ type: 'CALL_ACCEPT', payload: {} });
      
      if (currentCallRef.current) {
        currentCallRef.current.answer(stream);
      }
    } catch (err) {
      console.error(err);
      addToast({ title: "Error", message: "Could not access camera/mic", type: "error" });
    }
  }, [addToast]);

  const handleRejectCall = useCallback(() => {
    sendMessageRef.current({ type: 'CALL_REJECT', payload: {} });
    setCallStatus('idle');
    if (currentCallRef.current) {
      currentCallRef.current.close();
      currentCallRef.current = null;
    }
  }, []);

  const handleStartCall = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;
      setCallStatus('offering');
      
      const call = callPeerRef.current(stream);
      if (call) {
        currentCallRef.current = call;
        call.on('stream', (remote) => {
           setRemoteStream(remote);
           setCallStatus('connected');
        });
        call.on('close', () => handleEndCall(false));
      }
      sendMessageRef.current({ type: 'CALL_OFFER', payload: {} });
    } catch (err) {
      console.error(err);
      addToast({ title: "Error", message: "Could not access camera/mic", type: "error" });
    }
  }, [handleEndCall, addToast]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsMuted(!track.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsVideoStopped(!track.enabled);
      }
    }
  };

  // --- Game Actions ---
  const startTurn = (type: 'truth' | 'dare') => {
    const newTurn: TurnRecord = {
      id: Math.random().toString(36).substr(2, 9),
      playerRole: role,
      questionText: '',
      type,
      status: 'selecting',
      timestamp: Date.now()
    };
    
    broadcastState({
      ...gameState,
      activeTurn: newTurn,
      phase: 'playing'
    });
  };

  const sendQuestion = () => {
    if (!gameState.activeTurn) return;
    
    // Determine question text
    let qText = draftQuestion;
    if (!isCustomQuestion) {
      // If not custom, and draft is empty, pick random. 
      // But typically draft is populated by random shuffle.
      if (!qText) qText = QUESTIONS[currentActiveIntensity][gameState.activeTurn.type][0];
    }

    const updatedTurn: TurnRecord = {
      ...gameState.activeTurn,
      questionText: qText,
      status: 'pending',
      timeLimit: selectedTimer,
      startedAt: Date.now()
    };
    
    setDraftQuestion('');
    setIsCustomQuestion(false);

    broadcastState({
      ...gameState,
      activeTurn: updatedTurn
    });
  };

  const submitAnswer = () => {
    if (!gameState.activeTurn) return;

    const updatedTurn: TurnRecord = {
      ...gameState.activeTurn,
      response: answerText,
      status: 'answered',
      timestamp: Date.now()
    };

    setAnswerText('');
    setShowMedia(false);

    broadcastState({
      ...gameState,
      activeTurn: updatedTurn
    });
  };

  const handleMediaCapture = (type: MediaType, data: string) => {
    if (gameState.activeTurn) {
        setGameState(prev => ({
            ...prev,
            activeTurn: {
                ...prev.activeTurn!,
                mediaType: type,
                mediaData: data
            }
        }));
        setShowMedia(false);
    }
  };

  const completeTurn = (accepted: boolean) => {
    if (!gameState.activeTurn) return;

    if (accepted) {
      const points = calculateScoreValue(gameState.activeTurn.type, gameState.turnHistory, gameState.activeTurn.playerRole);
      
      // Update Random Mode Progress
      let nextLevel = gameState.currentRandomModeIntensity;
      let nextQuestionsCount = gameState.questionsAnsweredInCurrentLevel;
      
      if (gameState.gameMode === 'random') {
         nextQuestionsCount += 1;
         const threshold = QUESTIONS_PER_RANDOM_LEVEL * 2; // Both players
         if (nextQuestionsCount >= threshold) {
            const currentIndex = RANDOM_MODE_INTENSITY_ORDER.indexOf(gameState.currentRandomModeIntensity);
            if (currentIndex < RANDOM_MODE_INTENSITY_ORDER.length - 1) {
                nextLevel = RANDOM_MODE_INTENSITY_ORDER[currentIndex + 1];
                nextQuestionsCount = 0;
                addToast({ title: 'Level Up!', message: `Intensity increased to ${nextLevel}!`, type: 'success' });
            }
         }
      }

      const completedTurn: TurnRecord = {
          ...gameState.activeTurn,
          status: 'confirmed',
          loved: isLovedInReview
      };

      const newState: GameState = {
        ...gameState,
        turnHistory: [completedTurn, ...gameState.turnHistory],
        activeTurn: null,
        currentTurn: gameState.currentTurn === 'host' ? 'guest' : 'host',
        scores: {
          ...gameState.scores,
          [completedTurn.playerRole]: gameState.scores[completedTurn.playerRole] + points
        },
        currentRandomModeIntensity: nextLevel,
        questionsAnsweredInCurrentLevel: nextQuestionsCount
      };

      setIsLovedInReview(false);
      broadcastState(newState);

    } else {
      // Rejected
      const rejectedTurn: TurnRecord = {
        ...gameState.activeTurn,
        status: 'pending', // Revert to pending for retry
        isRetry: true,
        startedAt: Date.now() // Reset timer
      };
      
      broadcastState({
        ...gameState,
        activeTurn: rejectedTurn
      });
      
      sendMessageRef.current({ type: 'REJECT_TURN', payload: {} });
    }
  };

  const failTurn = () => {
    if (!gameState.activeTurn) return;
    
    const failedTurn: TurnRecord = {
        ...gameState.activeTurn,
        status: 'failed',
        timestamp: Date.now()
    };
    
    const newState: GameState = {
        ...gameState,
        turnHistory: [failedTurn, ...gameState.turnHistory],
        activeTurn: null,
        currentTurn: gameState.currentTurn === 'host' ? 'guest' : 'host'
    };
    
    broadcastState(newState);
  };

  // --- Intensity Handling ---
  const requestIntensityChange = (level: IntensityLevel) => {
    if (role !== 'host') {
      sendMessageRef.current({ type: 'INTENSITY_REQUEST', payload: { level } });
      addToast({ title: 'Request Sent', message: 'Asked host to change intensity', type: 'info' });
    } else {
      // Host changes immediately
      const newState = { ...gameState, intensityLevel: level };
      broadcastState(newState);
      setShowIntensitySelector(false);
      addToast({ title: 'Intensity Updated', message: `Changed to ${level}`, type: 'success' });
    }
  };

  const handleIntensityResponse = (accepted: boolean, level?: IntensityLevel) => {
     sendMessageRef.current({ type: 'INTENSITY_RESPONSE', payload: { accepted, level } });
     setPendingIntensityRequest(null);
     if (accepted && level && role === 'host') {
        const newState = { ...gameState, intensityLevel: level };
        broadcastState(newState);
     }
  };

  // --- Chat & Ping ---
  const sendChat = (text: string, mediaType?: MediaType, mediaData?: string) => {
    if (!text && !mediaData) return;
    
    const msg: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      senderRole: role,
      senderName: playerName,
      text,
      mediaType,
      mediaData,
      timestamp: Date.now()
    };

    setGameState(prev => ({
      ...prev,
      chatMessages: [...prev.chatMessages, msg]
    }));
    setInputMessage('');
    setShowChatMedia(false);
    
    if (!isTestMode) sendMessageRef.current({ type: 'CHAT_MESSAGE', payload: msg });
  };

  const triggerPing = () => {
    const emoji = RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
    sendMessageRef.current({ type: 'PING_EMOJI', payload: { emoji } });
    // Show locally too
    const id = Math.random().toString(36).substr(2, 9);
    const x = Math.random() * 80 + 10;
    setFloatingEmojis(prev => [...prev, { id, emoji, position: { x: window.innerWidth * (x/100), y: window.innerHeight - 100 }, startTime: Date.now() }]);
    setTimeout(() => setFloatingEmojis(prev => prev.filter(e => e.id !== id)), 4000);
  };

  const triggerReaction = (turnId: string) => {
     // Implementation for reacting to history items (simple love toggle)
     const updatedHistory = gameState.turnHistory.map(t => 
        t.id === turnId ? { ...t, loved: true } : t
     );
     setGameState(prev => ({ ...prev, turnHistory: updatedHistory }));
     // Need a message type for this sync if we want it real-time, or rely on full state sync.
     // For now, assume full state sync is not triggered by reaction to avoid heavy traffic, 
     // or just send a specific message.
     // If we rely on state sync:
     broadcastState({ ...gameState, turnHistory: updatedHistory });
  };

  // --- Copy Utils ---
  const copyCode = () => {
    navigator.clipboard.writeText(gameCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };
  
  const copyLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?code=${gameCode}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const shareGame = async () => {
    const url = `${window.location.origin}${window.location.pathname}?code=${gameCode}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Truth and Dare',
          text: `Join my game! Code: ${gameCode}`,
          url: url,
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    }
  };

  // --- Render ---

  if (p2pStatus === 'error' && !isTestMode) {
     return <GameErrorScreen error={p2pError} retry={retryRef.current} />;
  }

  if (gameState.phase === 'waiting' && !isTestMode) {
    return (
      <GameWaitingScreen 
        gameCode={gameCode}
        hostName={gameState.hostName}
        guestName={gameState.guestName}
        role={role}
        onCopyCode={copyCode}
        onCopyLink={copyLink}
        onShare={shareGame}
        copiedCode={copiedCode}
        copiedLink={copiedLink}
      />
    );
  }

  const currentLevelInfo = INTENSITY_LEVELS.find(l => l.id === currentActiveIntensity) || INTENSITY_LEVELS[0];

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden relative" ref={gameRoomRef}>
      <ToastDisplay />
      
      {floatingEmojis.map(emoji => (
        <FloatingEmoji key={emoji.id} {...emoji} />
      ))}

      <IncomingIntensityRequestModal 
         pendingIntensityRequest={pendingIntensityRequest}
         hostName={gameState.hostName}
         guestName={gameState.guestName}
         handleIntensityResponse={handleIntensityResponse}
      />

      <VideoCallOverlay 
        callStatus={callStatus}
        localStream={localStream}
        remoteStream={remoteStream}
        isMuted={isMuted}
        isVideoStopped={isVideoStopped}
        role={role}
        guestName={gameState.guestName}
        hostName={gameState.hostName}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onEndCall={handleEndCall}
        onRejectCall={handleRejectCall}
        onAcceptCall={handleAcceptCall}
      />
      
      <ChatOverlay 
         showChat={showChat}
         setShowChat={setShowChat}
         chatMessages={gameState.chatMessages}
         chatBottomRef={chatBottomRef}
         inputMessage={inputMessage}
         setInputMessage={setInputMessage}
         sendChat={sendChat}
         showChatMedia={showChatMedia}
         setShowChatMedia={setShowChatMedia}
         handleStartCall={handleStartCall}
         callStatus={callStatus}
         role={role}
         triggerPing={triggerPing}
      />

      <GameHeader 
        onExit={onExit}
        gameCode={gameCode}
        isTestMode={isTestMode}
        currentIntensityEmoji={currentLevelInfo.emoji}
        currentIntensityLabel={currentLevelInfo.label}
        currentActiveIntensity={currentActiveIntensity}
        gameMode={gameState.gameMode}
        questionsAnsweredInCurrentLevel={gameState.questionsAnsweredInCurrentLevel}
        questionsPerRandomLevel={QUESTIONS_PER_RANDOM_LEVEL}
        showIntensitySelector={showIntensitySelector}
        setShowIntensitySelector={setShowIntensitySelector}
        requestIntensityChange={requestIntensityChange}
        showChat={showChat}
        setShowChat={setShowChat}
        chatMessageCount={gameState.chatMessages.length}
        scores={gameState.scores}
        hostName={gameState.hostName}
        guestName={gameState.guestName}
        role={role}
        handleStartCall={handleStartCall}
        callStatus={callStatus}
        connectionStatus={connectionStatus}
      />

      <div className="flex-1 overflow-y-auto p-4 pb-24">
        <div className="max-w-md mx-auto">
          {/* Active Turn Area */}
          <div className="mb-6">
            <h2 className="text-center font-bold text-slate-800 mb-2 uppercase tracking-widest text-xs">
              {isMyTurn ? "Your Turn" : `${role === 'host' ? gameState.guestName : gameState.hostName}'s Turn`}
            </h2>
            
            {!gameState.activeTurn ? (
               canAct ? (
                 <GameSelectionPhase 
                    onStartTurn={startTurn} 
                    role={role}
                    turnHistory={gameState.turnHistory}
                 />
               ) : (
                 <div className="bg-white rounded-2xl p-8 text-center shadow-lg border border-slate-100">
                    <div className="animate-pulse flex flex-col items-center gap-3">
                       <Loader size="lg" />
                       <p className="text-slate-500 font-medium">Waiting for partner...</p>
                    </div>
                 </div>
               )
            ) : (
               <>
                 {gameState.activeTurn.status === 'selecting' && (
                    <QuestionSelectionPhase 
                      activeTurn={gameState.activeTurn}
                      canAct={canAct}
                      currentTurnRole={gameState.activeTurn.playerRole}
                      role={role}
                      intensityLevel={currentActiveIntensity}
                      draftQuestion={draftQuestion}
                      setDraftQuestion={setDraftQuestion}
                      isCustomQuestion={isCustomQuestion}
                      setIsCustomQuestion={setIsCustomQuestion}
                      selectedTimer={selectedTimer}
                      setSelectedTimer={setSelectedTimer}
                      shuffleQuestion={() => setDraftQuestion(QUESTIONS[currentActiveIntensity][gameState.activeTurn!.type][Math.floor(Math.random() * QUESTIONS[currentActiveIntensity][gameState.activeTurn!.type].length)])}
                      sendQuestion={sendQuestion}
                      isTestMode={isTestMode}
                      timerOptions={TIMER_OPTIONS}
                    />
                 )}
                 
                 {(gameState.activeTurn.status === 'pending' || gameState.activeTurn.status === 'failed') && (
                    <AnswerPhase 
                       activeTurn={gameState.activeTurn}
                       canAct={canAct}
                       answerText={answerText}
                       setAnswerText={setAnswerText}
                       showMedia={showMedia}
                       setShowMedia={setShowMedia}
                       handleMediaCapture={handleMediaCapture}
                       submitAnswer={submitAnswer}
                       timeLeft={timeLeft}
                       failTurn={failTurn}
                       role={role}
                       isTestMode={isTestMode}
                       onSandboxNext={() => {
                          // Sandbox skip helper
                          submitAnswer();
                          setTimeout(() => completeTurn(true), 500);
                       }}
                    />
                 )}

                 {(gameState.activeTurn.status === 'answered' || gameState.activeTurn.status === 'confirmed' || gameState.activeTurn.status === 'rejected') && (
                    <ReviewPhase 
                       activeTurn={gameState.activeTurn}
                       canAct={canAct}
                       currentTurnRole={gameState.activeTurn.playerRole}
                       role={role}
                       isLovedInReview={isLovedInReview}
                       setIsLovedInReview={setIsLovedInReview}
                       completeTurn={completeTurn}
                       isTestMode={isTestMode}
                    />
                 )}
               </>
            )}
          </div>

          <TurnHistoryFeed 
             turnHistory={gameState.turnHistory}
             role={role}
             triggerReaction={triggerReaction}
          />
        </div>
      </div>
    </div>
  );
};
