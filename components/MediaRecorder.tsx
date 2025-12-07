
import React, { useRef, useState, useEffect } from 'react';
import { Camera, Mic, Video, Square, RefreshCcw, Check, X, Loader } from 'lucide-react';
import { blobToBase64 } from '../lib/utils';
import { MediaType } from '../lib/types';
import { Button } from './common/Button';
import { cn } from '../lib/utils';

interface MediaRecorderProps {
  onCapture: (type: MediaType, data: string) => void;
  onCancel: () => void;
}

export const MediaRecorder: React.FC<MediaRecorderProps> = ({ onCapture, onCancel }) => {
  const [mode, setMode] = useState<MediaType>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Effect to attach stream to video element once it is rendered
  useEffect(() => {
    if (videoRef.current && stream && (mode === 'photo' || mode === 'video')) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, mode]);

  const startCamera = async (videoMode: boolean) => {
    setIsLoading(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user" // Prefer front camera
        }, 
        audio: videoMode 
      });
      setStream(s);
      setMode(videoMode ? 'video' : 'photo');
    } catch (e) {
      console.error("Camera/Mic access error:", e);
      alert("Could not access camera. Please check permissions.");
      reset();
    } finally {
      setIsLoading(false);
    }
  };

  const startAudio = async () => {
    setIsLoading(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(s);
      setMode('audio');
      startRecording(s, 'audio');
    } catch (e) {
      console.error("Microphone access error:", e);
      alert("Could not access microphone. Please check permissions.");
      reset();
    } finally {
      setIsLoading(false);
    }
  };

  const startRecording = (s: MediaStream, type: 'audio' | 'video') => {
    const mimeType = type === 'video' ? 'video/webm;codecs=vp8' : 'audio/webm';
    try {
      const recorder = new window.MediaRecorder(s, { mimeType });
      chunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setIsLoading(true);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const base64 = await blobToBase64(blob);
        setPreview(base64);
        stopStream();
        setIsLoading(false);
      };

      recorder.start();
      setIsRecording(true);
      mediaRecorderRef.current = recorder;
    } catch (err) {
      console.error("Recording error:", err);
      alert("Recording not supported on this device/browser.");
      reset();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const takePhoto = async () => {
    if (videoRef.current) {
      setIsLoading(true);
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg', 0.8); // Slightly higher quality
        setPreview(base64);
        stopStream();
      }
      setIsLoading(false);
    }
  };

  const stopStream = () => {
    stream?.getTracks().forEach(track => track.stop());
    setStream(null);
  };

  const handleConfirm = () => {
    if (preview && mode) {
      onCapture(mode, preview);
    }
  };

  const reset = () => {
    stopStream();
    setPreview(null);
    setMode(null);
    setIsRecording(false);
    setIsLoading(false);
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  };

  // Render Preview
  if (preview) {
    return (
      <div className="flex flex-col items-center gap-4 bg-slate-900 p-4 rounded-xl text-white animate-fade-in">
        <div className="w-full max-h-64 min-h-[160px] overflow-hidden rounded-md flex justify-center items-center bg-black">
          {mode === 'photo' && <img src={preview} alt="Captured" className="object-contain max-h-64" />}
          {mode === 'video' && <video src={preview} controls className="w-full max-h-64" />}
          {mode === 'audio' && (
            <div className="flex flex-col items-center justify-center w-full p-4">
              <Mic size={48} className="text-romantic-400 mb-2" />
              <audio src={preview} controls className="w-full max-w-xs" aria-label="Audio preview" />
            </div>
          )}
        </div>
        <div className="flex gap-4">
          <Button variant="secondary" onClick={reset} aria-label="Retake">
            <RefreshCcw size={20} />
          </Button>
          <Button variant="primary" onClick={handleConfirm} aria-label="Confirm">
            <Check size={20} /> Confirm
          </Button>
        </div>
      </div>
    );
  }

  // Render Camera View
  if (mode === 'photo' || (mode === 'video' && !preview)) {
    return (
      <div className="relative bg-black rounded-xl overflow-hidden flex flex-col items-center animate-fade-in">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="w-full h-64 object-cover transform scale-x-[-1] bg-slate-800" // Mirror effect
          aria-label="Camera feed"
        />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader className="animate-spin text-white" size={32} />
          </div>
        )}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-6 z-10">
          <Button onClick={reset} variant="ghost" className="bg-white/20 text-white backdrop-blur-sm" aria-label="Cancel media capture">
            <X size={20} />
          </Button>
          {mode === 'photo' ? (
            <Button onClick={takePhoto} className="p-4 bg-white rounded-full border-4 border-romantic-300 shadow-lg hover:scale-105 transition-transform" aria-label="Take photo">
              <Camera size={24} className="text-black" />
            </Button>
          ) : (
            <Button 
              onClick={isRecording ? stopRecording : () => stream && startRecording(stream, 'video')}
              className={cn(`p-4 rounded-full border-4 shadow-lg transition-colors`, 
                isRecording ? 'bg-red-600 border-red-200 animate-pulse' : 'bg-white border-romantic-300'
              )}
              aria-label={isRecording ? "Stop recording video" : "Start recording video"}
            >
              {isRecording ? <Square size={24} className="text-white" /> : <Video size={24} className="text-romantic-500" />}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Render Audio View
  if (mode === 'audio' && !preview) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-100 rounded-xl gap-6 animate-fade-in">
        <div className={`p-6 rounded-full ${isRecording ? 'bg-red-100 animate-pulse' : 'bg-slate-200'}`}>
          <Mic size={48} className={isRecording ? 'text-red-500' : 'text-slate-500'} />
        </div>
        <div className="flex gap-4">
           <Button onClick={reset} variant="secondary" aria-label="Cancel audio recording">
            <X size={20} />
          </Button>
          <Button 
            onClick={isRecording ? stopRecording : startAudio}
            variant={isRecording ? "danger" : "primary"}
            className="px-6"
            aria-label={isRecording ? "Stop recording audio" : "Start recording audio"}
            disabled={isLoading}
          >
            {isLoading && <Loader size={16} className="animate-spin mr-2" />}
            {isRecording ? "Stop Recording" : "Start Recording"}
          </Button>
        </div>
      </div>
    );
  }

  // Initial Selection
  return (
    <div className="relative grid grid-cols-3 gap-3 animate-fade-in">
      <Button onClick={onCancel} variant="ghost" size="sm" className="absolute top-2 right-2 text-slate-500 z-10" aria-label="Close media selector">
        <X size={16} />
      </Button>
      <Button onClick={() => startCamera(false)} variant="outline" className="flex flex-col items-center gap-2 p-4 h-full" disabled={isLoading}>
        {isLoading && <Loader size={16} className="animate-spin" />}
        <Camera className="text-romantic-500" size={24} />
        <span className="text-xs font-medium">Photo</span>
      </Button>
      <Button onClick={startAudio} variant="outline" className="flex flex-col items-center gap-2 p-4 h-full" disabled={isLoading}>
        {isLoading && <Loader size={16} className="animate-spin" />}
        <Mic className="text-romantic-500" size={24} />
        <span className="text-xs font-medium">Voice</span>
      </Button>
      <Button onClick={() => startCamera(true)} variant="outline" className="flex flex-col items-center gap-2 p-4 h-full" disabled={isLoading}>
        {isLoading && <Loader size={16} className="animate-spin" />}
        <Video className="text-romantic-500" size={24} />
        <span className="text-xs font-medium">Video</span>
      </Button>
    </div>
  );
};
