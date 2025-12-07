
import React from 'react';
import { Copy, Share2, Users, Link, Check, Loader2 } from 'lucide-react';
import { Button } from '../common/Button';
import { PlayerRole } from '../../lib/types';
import { Loader } from '../common/Loader';

interface GameWaitingScreenProps {
  gameCode: string;
  hostName: string;
  guestName: string;
  role: PlayerRole;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  copiedCode: boolean;
  copiedLink: boolean;
}

export const GameWaitingScreen: React.FC<GameWaitingScreenProps> = ({
  gameCode,
  hostName,
  guestName,
  role,
  onCopyCode,
  onCopyLink,
  onShare,
  copiedCode,
  copiedLink
}) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-slate-50 text-slate-800 animate-fade-in">
      <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-sm text-center">
        <div className="mb-6">
          <div className="w-20 h-20 bg-romantic-100 text-romantic-500 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Users size={40} />
          </div>
          <h2 className="text-2xl font-black text-slate-800">Waiting for Partner</h2>
          <p className="text-slate-500 text-sm mt-2">Share the code or link to invite your partner.</p>
        </div>

        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 mb-6">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Game Code</p>
          <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-inner mb-4">
            <span className="text-3xl font-mono font-bold tracking-widest text-slate-700">{gameCode}</span>
            <Button onClick={onCopyCode} variant="ghost" size="sm" className="text-romantic-500 hover:bg-romantic-50">
              {copiedCode ? <Check size={20} /> : <Copy size={20} />}
            </Button>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
             <Button onClick={onCopyLink} variant="outline" className="text-xs h-10 gap-2">
               {copiedLink ? <Check size={14} /> : <Link size={14} />} Copy Link
             </Button>
             <Button onClick={onShare} variant="outline" className="text-xs h-10 gap-2">
               <Share2 size={14} /> Share
             </Button>
          </div>
        </div>

        <div className="space-y-3 mb-8">
           <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-full bg-romantic-500 text-white flex items-center justify-center font-bold text-xs">
                 {hostName.charAt(0).toUpperCase()}
               </div>
               <span className="font-bold text-sm text-slate-700">{hostName} (Host)</span>
             </div>
             <div className="w-2 h-2 rounded-full bg-green-500"></div>
           </div>
           
           <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs">
                 {guestName === 'Waiting...' ? '?' : guestName.charAt(0).toUpperCase()}
               </div>
               <span className={`font-bold text-sm ${guestName === 'Waiting...' ? 'text-slate-400 italic' : 'text-slate-700'}`}>
                 {guestName}
               </span>
             </div>
             {guestName === 'Waiting...' ? (
               <Loader size="sm" className="border-slate-300" />
             ) : (
               <div className="w-2 h-2 rounded-full bg-green-500"></div>
             )}
           </div>
        </div>

        <div className="text-xs text-slate-400 animate-pulse">
           {role === 'host' ? "Game will start automatically when partner joins..." : "Connecting to host..."}
        </div>
      </div>
    </div>
  );
};
