import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../common/Button';

interface GameErrorScreenProps {
  error: string | null;
  retry: () => void;
}

export const GameErrorScreen: React.FC<GameErrorScreenProps> = ({ error, retry }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center animate-fade-in">
      <div className="text-red-500 mb-4 text-6xl" role="img" aria-label="Error icon">⚠️</div>
      <h2 className="text-xl font-bold mb-2">Connection Error</h2>
      <p className="text-slate-600 mb-6">{error || "An unexpected error occurred."}</p>
      <Button onClick={retry} variant="primary" className="flex items-center justify-center gap-2">
         <RefreshCw size={18} /> Retry Connection
      </Button>
    </div>
  );
};