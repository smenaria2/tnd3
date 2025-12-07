import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useP2P } from '../hooks/useP2P';
import { GameState, IntensityLevel, P2PMessage, PlayerRole, TurnRecord, ChatMessage, MediaType, CallStatus, GameMode } from '../lib/types';
import { QUESTIONS, INTENSITY_LEVELS, QUESTIONS_PER_RANDOM_LEVEL, RANDOM_MODE_INTENSITY_ORDER } from '../lib/constants';
import { formatTime, cn } from '../lib/utils';
import { VideoCallOverlay } from './VideoCallOverlay';
import { Send, Plus, X, ArrowDown, Copy, AlertCircle, RefreshCw, WifiOff } from 'lucide-react';
import type { MediaConnection } from 'peerjs';
import { Button } from './common/Button';
import { useToast } from '../hooks/useToast';
import { calculateScoreValue } from '../lib/scoring';
import { GameHeader } from './game/GameHeader';
import { IncomingIntensityRequestModal } from './modals/IncomingIntensityRequestModal';
import { GameSelectionPhase } from './game/phases/GameSelectionPhase';
import { QuestionSelectionPhase } from './game/phases/QuestionSelectionPhase';
import { AnswerPhase } from './game/phases/AnswerPhase';
import { ReviewPhase } from './game/phases/ReviewPhase';
import { FloatingEmoji } from './FloatingEmoji';
import { ToastDisplay } from './common/ToastDisplay';
import { MediaRecorder } from './MediaRecorder';

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

// Helper to merge and sort timeline
type TimelineItem = 
  | { type: 'chat'; data: ChatMessage }
  | { type: 'turn'; data: TurnRecord }
  | { type: 'system'; id: string; text: string; timestamp: number };

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
      currentTurn: 'guest', 
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
  const [showMediaInput, setShowMediaInput] = useState(false);
  const [systemMessages, setSystemMessages] = useState<{id: string, text: string, timestamp: number}[]>([]);
  
  // Game Action States
  const [answerText, setAnswerText] = useState('');
  const [draftQuestion, setDraftQuestion] = useState('');
  const [selectedTimer, setSelectedTimer] = useState<number>(0);
  const [isCustomQuestion, setIsCustomQuestion] = useState(false);
  const [showAnswerMedia, setShowAnswerMedia] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isLovedInReview, setIsLovedInReview] = useState(false);
  
  // Visuals
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmojiInstance[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);

  // Intensity Change State
  const [showIntensitySelector, setShowIntensitySelector] = useState(false);
  const [pendingIntensityRequest, setPendingIntensityRequest] = useState<{ level: IntensityLevel, requester: string } | null>(null);
  
  // --- Call State ---
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoStopped, setIsVideoStopped] = useState(false);

  const currentCallRef = useRef<MediaConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // P2P Refs
  const sendMessageRef = useRef< (msg: P2PMessage) => void >(() => {});
  const callPeerRef = useRef< (stream: MediaStream) => MediaConnection | null >(() => null);
  const retryRef = useRef< () => void >(() => {});

  const { addToast } = useToast();

  // --- Initial System Message ---
  useEffect(() => {
    if (systemMessages.length === 0) {
      setSystemMessages([{
        id: 'init',
        text: `Game Started. Share Code: ${gameCode}`,
        timestamp: Date.now()
      }]);
    }
  }, []);

  // --- Persistence Effect ---
  useEffect(() => {
    if (isTestMode) return;
    const stateToSave = { ...gameState, lastUpdated: Date.now() };
    localStorage.setItem(`tod_game_${gameCode}`, JSON.stringify(stateToSave));
  }, [gameState, gameCode, isTestMode]);

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

  // --- Callbacks and P2P ---
  const broadcastState = useCallback((newState: GameState) => {
    setGameState(newState);
    if (!isTestMode) {
      sendMessageRef.current({ type: 'GAME_STATE_SYNC', payload: newState });
    }
  }, [isTestMode]);

  const addSystemMessage = (text: string) => {
    setSystemMessages(prev => [...prev, { id: Math.random().toString(36), text, timestamp: Date.now() }]);
  };

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
    currentCallRef.current = call;
    setCallStatus('ringing');
    call.on('stream', (remote) => {
      setRemoteStream(remote);
      setCallStatus('connected');
    });
    call.on('close', () => handleEndCall(false));
  }, [handleEndCall]);

  const handleP2PMessage = useCallback((msg: P2PMessage) => {
    switch (msg.type) {
      case 'GAME_STATE_SYNC':
        setGameState(msg.payload);
        break;
      case 'PLAYER_INFO':
        if (role === 'host' && gameState.guestName === 'Waiting...') {
           const newGameState = { ...gameState, guestName: msg.payload.name, phase: 'playing' as const };
           setGameState(newGameState);
           sendMessageRef.current({ type: 'GAME_STATE_SYNC', payload: newGameState });
           addSystemMessage(`${msg.payload.name} joined the game!`);
        }
        break;
      case 'CHAT_MESSAGE':
        setGameState(prev => ({ ...prev, chatMessages: [...prev.chatMessages, msg.payload] }));
        if (!isUserAtBottom) addToast({ title: 'New Message', message: `${msg.payload.senderName} sent a message`, type: 'info' });
        break;
      case 'PING_EMOJI':
         const id = Math.random().toString(36).substr(2, 9);
         const x = Math.random() * 80 + 10;
         setFloatingEmojis(prev => [...prev, { id, emoji: msg.payload.emoji, position: { x: window.innerWidth * (x/100), y: window.innerHeight - 100 }, startTime: Date.now() }]);
         setTimeout(() => setFloatingEmojis(prev => prev.filter(e => e.id !== id)), 4000);
         break;
      case 'CALL_OFFER': setCallStatus('ringing'); break;
      case 'CALL_ACCEPT': setCallStatus('connected'); break;
      case 'CALL_REJECT': setCallStatus('idle'); addToast({ title: 'Call Declined', message: 'Partner is busy.', type: 'error' }); break;
      case 'CALL_END': handleEndCall(false); break;
      case 'INTENSITY_REQUEST': setPendingIntensityRequest({ level: msg.payload.level, requester: role === 'host' ? gameState.guestName : gameState.hostName }); break;
      case 'INTENSITY_RESPONSE':
        if (msg.payload.accepted && msg.payload.level) {
           addToast({ title: 'Intensity Changed', message: `Level changed to ${msg.payload.level}`, type: 'success' });
           addSystemMessage(`Intensity changed to ${msg.payload.level}`);
           if (role === 'host') {
             const newState = { ...gameState, intensityLevel: msg.payload.level };
             broadcastState(newState);
           }
        } else {
           addToast({ title: 'Request Denied', message: 'Partner declined intensity change.', type: 'error' });
        }
        break;
    }
  }, [gameState, role, addToast, handleEndCall, broadcastState, isUserAtBottom]);

  const { status: p2pStatus, connectionStatus, error: p2pError, sendMessage, callPeer, retry } = useP2P({
    role, gameCode, playerName, onMessage: handleP2PMessage, onIncomingCall: handleIncomingStream, isTestMode
  });

  useEffect(() => {
    sendMessageRef.current = sendMessage;
    callPeerRef.current = callPeer;
    retryRef.current = retry;
  }, [sendMessage, callPeer, retry]);

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

  // --- Auto Scroll ---
  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsUserAtBottom(true);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [gameState.chatMessages.length, gameState.turnHistory.length, systemMessages.length]);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      setIsUserAtBottom(scrollHeight - scrollTop - clientHeight < 50);
    }
  };

  // --- Actions ---
  const sendChat = (text: string, mediaType?: MediaType, mediaData?: string) => {
    if (!text && !mediaData) return;
    const msg: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      senderRole: role,
      senderName: playerName,
      text, mediaType, mediaData, timestamp: Date.now()
    };
    setGameState(prev => ({ ...prev, chatMessages: [...prev.chatMessages, msg] }));
    setInputMessage('');
    setShowMediaInput(false);
    if (!isTestMode) sendMessageRef.current({ type: 'CHAT_MESSAGE', payload: msg });
  };

  const startTurn = (type: 'truth' | 'dare') => {
    const newTurn: TurnRecord = {
      id: Math.random().toString(36).substr(2, 9),
      playerRole: role,
      questionText: '',
      type,
      status: 'selecting',
      timestamp: Date.now()
    };
    broadcastState({ ...gameState, activeTurn: newTurn, phase: 'playing' });
  };

  const sendQuestion = () => {
    if (!gameState.activeTurn) return;
    let qText = draftQuestion;
    if (!isCustomQuestion && !qText) qText = QUESTIONS[currentActiveIntensity][gameState.activeTurn.type][0];
    const updatedTurn: TurnRecord = {
      ...gameState.activeTurn,
      questionText: qText,
      status: 'pending',
      timeLimit: selectedTimer,
      startedAt: Date.now()
    };
    setDraftQuestion('');
    setIsCustomQuestion(false);
    broadcastState({ ...gameState, activeTurn: updatedTurn });
  };

  const submitAnswer = () => {
    if (!gameState.activeTurn) return;
    const updatedTurn: TurnRecord = { ...gameState.activeTurn, response: answerText, status: 'answered', timestamp: Date.now() };
    setAnswerText('');
    setShowAnswerMedia(false);
    broadcastState({ ...gameState, activeTurn: updatedTurn });
  };

  const handleMediaCapture = (type: MediaType, data: string) => {
    if (gameState.activeTurn) {
        setGameState(prev => ({ ...prev, activeTurn: { ...prev.activeTurn!, mediaType: type, mediaData: data } }));
        setShowAnswerMedia(false);
    }
  };

  const completeTurn = (accepted: boolean) => {
    if (!gameState.activeTurn) return;
    if (accepted) {
      const points = calculateScoreValue(gameState.activeTurn.type, gameState.turnHistory, gameState.activeTurn.playerRole);
      let nextLevel = gameState.currentRandomModeIntensity;
      let nextQuestionsCount = gameState.questionsAnsweredInCurrentLevel;
      if (gameState.gameMode === 'random') {
         nextQuestionsCount += 1;
         if (nextQuestionsCount >= QUESTIONS_PER_RANDOM_LEVEL * 2) {
            const currentIndex = RANDOM_MODE_INTENSITY_ORDER.indexOf(gameState.currentRandomModeIntensity);
            if (currentIndex < RANDOM_MODE_INTENSITY_ORDER.length - 1) {
                nextLevel = RANDOM_MODE_INTENSITY_ORDER[currentIndex + 1];
                nextQuestionsCount = 0;
                addSystemMessage(`Level Up! Intensity increased to ${nextLevel}`);
            }
         }
      }
      const completedTurn: TurnRecord = { ...gameState.activeTurn, status: 'confirmed', loved: isLovedInReview };
      const newState: GameState = {
        ...gameState,
        turnHistory: [completedTurn, ...gameState.turnHistory],
        activeTurn: null,
        currentTurn: gameState.currentTurn === 'host' ? 'guest' : 'host',
        scores: { ...gameState.scores, [completedTurn.playerRole]: gameState.scores[completedTurn.playerRole] + points },
        currentRandomModeIntensity: nextLevel,
        questionsAnsweredInCurrentLevel: nextQuestionsCount
      };
      setIsLovedInReview(false);
      broadcastState(newState);
    } else {
      const rejectedTurn: TurnRecord = { ...gameState.activeTurn, status: 'pending', isRetry: true, startedAt: Date.now() };
      broadcastState({ ...gameState, activeTurn: rejectedTurn });
      sendMessageRef.current({ type: 'REJECT_TURN', payload: {} });
    }
  };

  const failTurn = () => {
    if (!gameState.activeTurn) return;
    const failedTurn: TurnRecord = { ...gameState.activeTurn, status: 'failed', timestamp: Date.now() };
    const newState: GameState = {
        ...gameState,
        turnHistory: [failedTurn, ...gameState.turnHistory],
        activeTurn: null,
        currentTurn: gameState.currentTurn === 'host' ? 'guest' : 'host'
    };
    broadcastState(newState);
  };

  // --- Intensity & Calls ---
  const requestIntensityChange = (level: IntensityLevel) => {
    if (role !== 'host') {
      sendMessageRef.current({ type: 'INTENSITY_REQUEST', payload: { level } });
      addToast({ title: 'Request Sent', message: 'Asked host to change intensity', type: 'info' });
    } else {
      const newState = { ...gameState, intensityLevel: level };
      broadcastState(newState);
      setShowIntensitySelector(false);
      addSystemMessage(`Intensity changed to ${level}`);
    }
  };

  const handleIntensityResponse = (accepted: boolean, level?: IntensityLevel) => {
     sendMessageRef.current({ type: 'INTENSITY_RESPONSE', payload: { accepted, level } });
     setPendingIntensityRequest(null);
     if (accepted && level && role === 'host') {
        const newState = { ...gameState, intensityLevel: level };
        broadcastState(newState);
        addSystemMessage(`Intensity changed to ${level}`);
     }
  };

  const handleStartCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;
      setCallStatus('offering');
      const call = callPeerRef.current(stream);
      if (call) {
        currentCallRef.current = call;
        call.on('stream', (remote) => { setRemoteStream(remote); setCallStatus('connected'); });
        call.on('close', () => handleEndCall(false));
      }
      sendMessageRef.current({ type: 'CALL_OFFER', payload: {} });
    } catch (err) { addToast({ title: "Error", message: "Could not access camera/mic", type: "error" }); }
  };
  
  const handleAcceptCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      localStreamRef.current = stream;
      setCallStatus('connected');
      sendMessageRef.current({ type: 'CALL_ACCEPT', payload: {} });
      if (currentCallRef.current) currentCallRef.current.answer(stream);
    } catch (err) { addToast({ title: "Error", message: "Could not access camera/mic", type: "error" }); }
  };

  const handleRejectCall = () => {
    sendMessageRef.current({ type: 'CALL_REJECT', payload: {} });
    setCallStatus('idle');
    if (currentCallRef.current) { currentCallRef.current.close(); currentCallRef.current = null; }
  };

  // --- Timeline Construction ---
  const timeline: TimelineItem[] = useMemo(() => {
    const chats = gameState.chatMessages.map(m => ({ type: 'chat' as const, data: m }));
    const turns = gameState.turnHistory.map(t => ({ type: 'turn' as const, data: t }));
    const systems = systemMessages.map(s => ({ type: 'system' as const, id: s.id, text: s.text, timestamp: s.timestamp }));
    return [...chats, ...turns, ...systems].sort((a, b) => {
      const tA = a.type === 'system' ? a.timestamp : a.data.timestamp;
      const tB = b.type === 'system' ? b.timestamp : b.data.timestamp;
      return tA - tB;
    });
  }, [gameState.chatMessages, gameState.turnHistory, systemMessages]);

  const currentLevelInfo = INTENSITY_LEVELS.find(l => l.id === currentActiveIntensity) || INTENSITY_LEVELS[0];

  // Render Timeline Item
  const renderTimelineItem = (item: TimelineItem) => {
    if (item.type === 'system') {
      return (
        <div key={item.id} className="flex justify-center my-2">
          <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
            {item.text}
          </span>
        </div>
      );
    }
    if (item.type === 'chat') {
      const isMe = item.data.senderRole === role;
      return (
        <div key={item.data.id} className={cn("flex flex-col max-w-[85%] my-1", isMe ? "ml-auto items-end" : "mr-auto items-start")}>
          <div className={cn("px-4 py-2 rounded-2xl text-sm shadow-sm", 
            isMe ? "bg-romantic-500 text-white rounded-tr-none" : "bg-white border border-slate-100 text-slate-800 rounded-tl-none")}>
            {item.data.mediaData && (
              <div className="mb-2 rounded-lg overflow-hidden bg-black/10">
                 {item.data.mediaType === 'photo' && <img src={item.data.mediaData} className="max-h-48" alt="content" />}
                 {item.data.mediaType === 'video' && <video src={item.data.mediaData} controls className="max-h-48" />}
                 {item.data.mediaType === 'audio' && <audio src={item.data.mediaData} controls className="w-full min-w-[200px]" />}
              </div>
            )}
            {item.data.text}
          </div>
          <span className="text-[10px] text-slate-400 mt-1 px-1">{formatTime(item.data.timestamp)}</span>
        </div>
      );
    }
    if (item.type === 'turn') {
      // Historical Turn Card
      const turn = item.data;
      const isMyTurnRecord = turn.playerRole === role;
      const isFailed = turn.status === 'failed';
      return (
        <div key={turn.id} className="w-full my-2 flex justify-center">
          <div className={cn("w-full max-w-sm rounded-xl overflow-hidden border shadow-sm", 
            turn.type === 'truth' ? "bg-blue-50 border-blue-100" : "bg-orange-50 border-orange-100",
            isFailed && "opacity-70 bg-gray-50 border-gray-200"
          )}>
            <div className={cn("px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white flex justify-between",
              turn.type === 'truth' ? "bg-blue-400" : "bg-orange-400", isFailed && "bg-gray-400"
            )}>
              <span>{turn.type} • {isMyTurnRecord ? 'You' : (turn.playerRole === 'host' ? gameState.hostName : gameState.guestName)}</span>
              <span>{formatTime(turn.timestamp)}</span>
            </div>
            <div className="p-3">
              <p className="font-bold text-slate-800 text-sm mb-2">{turn.questionText}</p>
              {isFailed ? (
                <div className="text-red-500 text-xs font-bold flex items-center gap-1">🚫 Timed Out</div>
              ) : (
                <div className="bg-white/60 rounded p-2 text-sm text-slate-700">
                  {turn.response}
                  {turn.mediaData && <div className="mt-1 text-xs font-bold opacity-70">[{turn.mediaType} attached]</div>}
                  {!turn.response && !turn.mediaData && <span className="italic opacity-50">No text response</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden relative">
      <ToastDisplay />
      {floatingEmojis.map(emoji => <FloatingEmoji key={emoji.id} {...emoji} />)}
      
      <IncomingIntensityRequestModal 
         pendingIntensityRequest={pendingIntensityRequest}
         hostName={gameState.hostName}
         guestName={gameState.guestName}
         handleIntensityResponse={handleIntensityResponse}
      />

      <VideoCallOverlay 
        callStatus={callStatus} localStream={localStream} remoteStream={remoteStream}
        isMuted={isMuted} isVideoStopped={isVideoStopped} role={role}
        guestName={gameState.guestName} hostName={gameState.hostName}
        onToggleMute={() => { if(localStreamRef.current) { const t = localStreamRef.current.getAudioTracks()[0]; if(t) { t.enabled = !t.enabled; setIsMuted(!t.enabled); }}}}
        onToggleVideo={() => { if(localStreamRef.current) { const t = localStreamRef.current.getVideoTracks()[0]; if(t) { t.enabled = !t.enabled; setIsVideoStopped(!t.enabled); }}}}
        onEndCall={handleEndCall} onRejectCall={handleRejectCall} onAcceptCall={handleAcceptCall}
      />

      {/* --- HEADER --- */}
      <GameHeader 
        onExit={onExit} gameCode={gameCode} isTestMode={isTestMode}
        currentIntensityEmoji={currentLevelInfo.emoji} currentIntensityLabel={currentLevelInfo.label}
        currentActiveIntensity={currentActiveIntensity} gameMode={gameState.gameMode}
        questionsAnsweredInCurrentLevel={gameState.questionsAnsweredInCurrentLevel}
        questionsPerRandomLevel={QUESTIONS_PER_RANDOM_LEVEL}
        showIntensitySelector={showIntensitySelector} setShowIntensitySelector={setShowIntensitySelector}
        requestIntensityChange={requestIntensityChange}
        showChat={false} setShowChat={() => {}} chatMessageCount={0}
        scores={gameState.scores} hostName={gameState.hostName} guestName={gameState.guestName}
        role={role} handleStartCall={handleStartCall} callStatus={callStatus}
        connectionStatus={connectionStatus}
      />

      {/* --- TIMELINE --- */}
      <div 
        ref={scrollRef} 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-1 scroll-smooth"
      >
        <div className="min-h-[20px]"></div> {/* Spacer for top */}
        {timeline.map(renderTimelineItem)}
        
        {/* Connection Status Inline */}
        {!isTestMode && (
          <div className="flex flex-col items-center my-4 space-y-2">
            {p2pStatus === 'error' ? (
               <div className="bg-red-50 text-red-600 border border-red-200 px-4 py-3 rounded-xl text-sm font-bold flex flex-col items-center gap-2 max-w-[90%] text-center shadow-sm animate-fade-in">
                  <div className="flex items-center gap-2">
                    <WifiOff size={16} />
                    <span>Connection Lost</span>
                  </div>
                  <span className="text-xs font-normal opacity-90">{p2pError || "Waiting for retry..."}</span>
                  <Button onClick={retry} size="sm" variant="danger" className="mt-1 h-8 px-4 w-full flex items-center justify-center gap-2">
                    <RefreshCw size={14} /> Retry
                  </Button>
               </div>
            ) : connectionStatus !== 'connected' ? (
               <div className="bg-slate-100 text-slate-500 border border-slate-200 px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 shadow-sm animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-ping"></span>
                  Waiting for partner... (Code: {gameCode})
                  <Button onClick={() => navigator.clipboard.writeText(gameCode)} variant="ghost" size="sm" className="h-5 w-5 p-0 text-slate-400 hover:bg-slate-200"><Copy size={12}/></Button>
               </div>
            ) : null}
          </div>
        )}
      </div>

      {!isUserAtBottom && (
        <button onClick={scrollToBottom} className="absolute bottom-24 right-4 bg-slate-800 text-white p-2 rounded-full shadow-lg z-30 animate-bounce">
          <ArrowDown size={20} />
        </button>
      )}

      {/* --- ACTIVE TURN DOCK & INPUT --- */}
      <div className="bg-white border-t border-slate-100 z-20 shadow-[0_-5px_20px_-5px_rgba(0,0,0,0.1)]">
        
        {/* Active Game Phase "Drawer" */}
        {gameState.activeTurn && (
          <div className="border-b border-slate-100 bg-slate-50/50 max-h-[40vh] overflow-y-auto">
            <div className="p-2">
              {gameState.activeTurn.status === 'selecting' && (
                  <QuestionSelectionPhase 
                    activeTurn={gameState.activeTurn} canAct={canAct} currentTurnRole={gameState.activeTurn.playerRole} role={role}
                    intensityLevel={currentActiveIntensity} draftQuestion={draftQuestion} setDraftQuestion={setDraftQuestion}
                    isCustomQuestion={isCustomQuestion} setIsCustomQuestion={setIsCustomQuestion}
                    selectedTimer={selectedTimer} setSelectedTimer={setSelectedTimer}
                    shuffleQuestion={() => setDraftQuestion(QUESTIONS[currentActiveIntensity][gameState.activeTurn!.type][Math.floor(Math.random() * QUESTIONS[currentActiveIntensity][gameState.activeTurn!.type].length)])}
                    sendQuestion={sendQuestion} isTestMode={isTestMode} timerOptions={TIMER_OPTIONS}
                  />
              )}
              {(gameState.activeTurn.status === 'pending' || gameState.activeTurn.status === 'failed') && (
                  <AnswerPhase 
                      activeTurn={gameState.activeTurn} canAct={canAct} answerText={answerText} setAnswerText={setAnswerText}
                      showMedia={showAnswerMedia} setShowMedia={setShowAnswerMedia} handleMediaCapture={handleMediaCapture}
                      submitAnswer={submitAnswer} timeLeft={timeLeft} failTurn={failTurn} role={role} isTestMode={isTestMode}
                      onSandboxNext={() => { submitAnswer(); setTimeout(() => completeTurn(true), 500); }}
                  />
              )}
              {(gameState.activeTurn.status === 'answered' || gameState.activeTurn.status === 'confirmed' || gameState.activeTurn.status === 'rejected') && (
                  <ReviewPhase 
                      activeTurn={gameState.activeTurn} canAct={canAct} currentTurnRole={gameState.activeTurn.playerRole} role={role}
                      isLovedInReview={isLovedInReview} setIsLovedInReview={setIsLovedInReview} completeTurn={completeTurn} isTestMode={isTestMode}
                  />
              )}
            </div>
          </div>
        )}

        {/* Start Game Prompt (if no active turn) */}
        {!gameState.activeTurn && canAct && (
           <div className="flex justify-center p-2 gap-4 bg-slate-50 border-b border-slate-100">
               <GameSelectionPhase onStartTurn={startTurn} role={role} turnHistory={gameState.turnHistory} />
           </div>
        )}
        
        {!gameState.activeTurn && !canAct && (
          <div className="text-center py-2 text-xs text-slate-400 bg-slate-50 border-b border-slate-100">
             Partner's turn to pick...
          </div>
        )}

        {/* Media Input Drawer */}
        {showMediaInput && (
          <div className="p-2 bg-slate-100 border-b border-slate-200">
             <div className="flex justify-between items-center mb-2 px-2">
                <span className="text-xs font-bold text-slate-500">Attach Media</span>
                <Button onClick={() => setShowMediaInput(false)} variant="ghost" size="sm" className="h-6 w-6 p-0"><X size={14}/></Button>
             </div>
             <MediaRecorder onCapture={(type, data) => sendChat("", type, data)} onCancel={() => setShowMediaInput(false)} />
          </div>
        )}

        {/* Input Bar */}
        <div className="p-3 flex items-end gap-2 bg-white">
          <Button onClick={() => setShowMediaInput(!showMediaInput)} variant="ghost" size="sm" className={cn("p-2 text-slate-400 hover:text-romantic-500", showMediaInput && "text-romantic-500 bg-romantic-50")}>
            <Plus size={24} />
          </Button>
          <div className="flex-1 bg-slate-100 rounded-2xl flex items-center px-3 py-1 border border-transparent focus-within:border-romantic-300 focus-within:bg-white transition-colors">
            <input
              className="flex-1 bg-transparent border-none focus:ring-0 p-2 text-sm max-h-24 outline-none"
              placeholder="Type a message..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat(inputMessage)}
            />
          </div>
          <Button onClick={() => sendChat(inputMessage)} disabled={!inputMessage.trim()} variant="primary" size="sm" className="p-3 rounded-full h-10 w-10 flex items-center justify-center">
            <Send size={18} className="ml-0.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}