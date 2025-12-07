import React from 'react';
import { Heart } from 'lucide-react';
import { Button } from '../common/Button';
import { TurnRecord, PlayerRole } from '../../lib/types';
import { cn, formatTime } from '../../lib/utils';

interface TurnHistoryFeedProps {
  turnHistory: TurnRecord[];
  role: PlayerRole;
  triggerReaction: (turnId: string) => void;
}

export const TurnHistoryFeed: React.FC<TurnHistoryFeedProps> = ({ turnHistory, role, triggerReaction }) => {
  return (
    <div className="mt-8 space-y-4 opacity-75">
      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Previous Turns</h4>
      {turnHistory.map((turn) => (
         <div key={turn.id} className={cn("bg-white p-4 rounded-lg shadow-sm border border-slate-100 text-sm animate-fade-in", turn.status === 'failed' && "border-red-100 bg-red-50/50")}>
            <div className="flex justify-between items-start mb-2">
               <div className="flex items-center gap-2">
                 <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase", turn.type === 'truth' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700')}>
                   {turn.type}
                 </span>
                 {turn.status === 'failed' && <span className="text-[10px] font-bold text-red-500">FAILED</span>}
               </div>
               <span className="text-[10px] text-slate-400">{formatTime(turn.timestamp)}</span>
            </div>
            <p className="font-medium text-slate-800 mb-1">{turn.questionText}</p>
            <div className="text-slate-600 bg-slate-50 p-2 rounded break-words">
               {turn.response}
               {turn.mediaData && <div className="mt-2 text-xs text-romantic-500 font-medium">[{turn.mediaType} attached]</div>}
               {!turn.response && !turn.mediaData && (turn.status === 'failed' ? "Timeout" : "No response")}
            </div>
            <div className="flex justify-end mt-2">
               <Button 
                onClick={() => !turn.loved && turn.playerRole !== role && triggerReaction(turn.id)} 
                disabled={turn.loved || turn.playerRole === role}
                variant="ghost" size="sm"
                className={cn("p-1 rounded-full transition-colors", turn.loved ? "text-romantic-500" : "text-slate-300 hover:text-romantic-300")}
                aria-label={turn.loved ? "Loved (already reacted)" : "Love this turn"}
               >
                  <Heart size={16} fill={turn.loved ? "currentColor" : "none"} />
               </Button>
            </div>
         </div>
      ))}
    </div>
  );
};