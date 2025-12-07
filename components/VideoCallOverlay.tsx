

import React, { useEffect, useRef } from 'react';
import { Video, Phone, Mic, MicOff, PhoneOff, VideoOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { CallStatus } from '../lib/types';
import { Button } from './common/Button';
import { Loader } from './common/Loader';

interface VideoCallOverlayProps {
  callStatus: CallStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoStopped: boolean;
  role: 'host' | 'guest';
  guestName: string;
  hostName: string;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: (notify: boolean) => void;
  onRejectCall: () => void;
  onAcceptCall: () => void;
}

export const VideoCallOverlay: React.FC<VideoCallOverlayProps> = ({
  callStatus,
  localStream,
  remoteStream,
  isMuted,
  isVideoStopped,
  role,
  guestName,
  hostName,
  onToggleMute,
  onToggleVideo,
  onEndCall,
  onRejectCall,
  onAcceptCall
}) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, callStatus, isVideoStopped]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, callStatus]);

  if (callStatus === 'idle') return null;

  // Incoming Call Modal
  if (callStatus === 'ringing') {
    return (
      <div 
        className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="incoming-call-title"
      >
        <div className="bg-white rounded-3xl p-8 w-full max-w-sm text-center shadow-2xl">
          <div className="w-24 h-24 bg-romantic-100 rounded-full mx-auto flex items-center justify-center mb-6 animate-pulse">
            <Video size={48} className="text-romantic-600" />
          </div>
          <h3 id="incoming-call-title" className="text-2xl font-bold text-slate-900 mb-1">Incoming Call...</h3>
          <p className="text-slate-500 mb-8">{role === 'host' ? guestName : hostName} wants to video chat</p>
          
          <div className="flex gap-4">
            <Button onClick={onRejectCall} variant="ghost" className="flex-1 flex flex-col items-center gap-2 group p-0" aria-label="Decline call">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center text-red-600 group-hover:bg-red-500 group-hover:text-white transition-colors">
                <PhoneOff size={24} />
              </div>
              <span className="text-xs font-bold text-slate-500 group-hover:text-red-500 transition-colors">Decline</span>
            </Button>
            <Button onClick={onAcceptCall} variant="ghost" className="flex-1 flex flex-col items-center gap-2 group p-0" aria-label="Accept call">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center text-green-600 group-hover:bg-green-500 group-hover:text-white transition-colors">
                <Phone size={24} />
              </div>
              <span className="text-xs font-bold text-slate-500 group-hover:text-green-500 transition-colors">Accept</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Active Call UI
  return (
    <div className="absolute inset-0 z-50 bg-black flex flex-col" role="region" aria-label="Video Call">
      {/* Remote Video (Main) */}
      <div className="flex-1 relative overflow-hidden bg-slate-900">
        {callStatus === 'offering' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50 space-y-4">
            <div className="w-20 h-20 bg-romantic-600 rounded-full flex items-center justify-center animate-pulse">
              <Phone size={40} className="text-white" />
            </div>
            <p className="text-white font-bold text-lg">Calling Partner...</p>
          </div>
        ) : (
          <>
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" aria-label="Remote video feed" />
            {!remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader />
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Local Video (PIP) */}
      <div className="absolute top-4 right-4 w-24 h-32 bg-slate-800 rounded-xl overflow-hidden border-2 border-white shadow-xl">
        <video 
          ref={localVideoRef} 
          autoPlay 
          playsInline 
          muted 
          className={cn("w-full h-full object-cover transform scale-x-[-1]", isVideoStopped && "hidden")} 
          aria-label="Local video feed"
        />
        {isVideoStopped && (
          <div className="w-full h-full flex items-center justify-center text-slate-500 bg-slate-900">
            <VideoOff size={20} />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-slate-900 p-6 flex justify-center gap-6 pb-10 rounded-t-3xl mt-[-20px] relative z-10">
        <Button 
          onClick={onToggleVideo} 
          className={cn("p-4 rounded-full transition-colors", !isVideoStopped ? "bg-white text-slate-900" : "bg-white/20 text-white")}
          aria-label={isVideoStopped ? "Enable video" : "Disable video"}
        >
          {isVideoStopped ? <VideoOff size={24} /> : <Video size={24} />}
        </Button>
        
        <Button 
          onClick={onToggleMute} 
          className={cn("p-4 rounded-full transition-colors", !isMuted ? "bg-white text-slate-900" : "bg-white/20 text-white")}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
        </Button>
        
        <Button 
          onClick={() => onEndCall(true)} 
          variant="danger" 
          size="lg" 
          className="p-4 bg-red-600 text-white rounded-full hover:bg-red-700 shadow-lg hover:scale-105 transition-transform"
          aria-label="End call"
        >
          <PhoneOff size={32} />
        </Button>
      </div>
    </div>
  );
};