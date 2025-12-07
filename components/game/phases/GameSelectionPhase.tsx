
import React from 'react';
import { Button } from '../../common/Button';
import { PlayerRole, TurnRecord } from '../../../lib/types';
import { calculateScoreValue } from '../../../lib/scoring';

interface GameSelectionPhaseProps {
  onStartTurn: (type: 'truth' | 'dare') => void;
  role: PlayerRole;
  turnHistory: TurnRecord[];
}

export const GameSelectionPhase: React.FC<GameSelectionPhaseProps> = ({ onStartTurn, role, turnHistory }) => {
  const getTruthScore = () => calculateScoreValue('truth', turnHistory, role);
  const getDareScore = () => calculateScoreValue('dare', turnHistory, role);

  return (
    <div className="grid grid-cols-2 gap-4 h-64 animate-fade-in">
      <Button 
        onClick={() => onStartTurn('truth')}
        className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 p-6 text-white shadow-lg transition-transform active:scale-95 flex flex-col justify-center items-center"
        aria-label="Choose Truth"
      >
        <div className="absolute top-2 right-2 bg-white/20 px-2 py-0.5 rounded text-xs font-bold">
           +{getTruthScore()} pts
        </div>
        <span className="text-4xl mb-2" role="img" aria-label="Diamond emoji">💎</span>
        <h3 className="text-2xl font-bold">TRUTH</h3>
        <p className="text-blue-100 text-[10px] mt-2 text-center leading-tight">Lower reward for repetition.</p>
      </Button>
      <Button 
        onClick={() => onStartTurn('dare')}
        className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 p-6 text-white shadow-lg transition-transform active:scale-95 flex flex-col justify-center items-center"
        aria-label="Choose Dare"
      >
         <div className="absolute top-2 right-2 bg-white/20 px-2 py-0.5 rounded text-xs font-bold">
           +{getDareScore()} pts
         </div>
         <span className="text-4xl mb-2" role="img" aria-label="Fire emoji">🔥</span>
        <h3 className="text-2xl font-bold">DARE</h3>
        <p className="text-orange-100 text-[10px] mt-2 text-center leading-tight">Bonus for dare streak!</p>
      </Button>
    </div>
  );
};
