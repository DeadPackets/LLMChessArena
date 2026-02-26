import { useState, useEffect, useCallback } from "react";

interface UseReplayControlsProps {
  totalMoves: number;
  currentIndex: number;
  onNavigate: (dir: "next") => void;
}

export function useReplayControls({ totalMoves, currentIndex, onNavigate }: UseReplayControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1);

  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = 1000 / playSpeed;
    const timer = setInterval(() => onNavigate("next"), intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, playSpeed, onNavigate]);

  // Stop at end
  useEffect(() => {
    if (currentIndex >= totalMoves - 1) setIsPlaying(false);
  }, [currentIndex, totalMoves]);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  return { isPlaying, playSpeed, togglePlay, setPlaySpeed };
}
