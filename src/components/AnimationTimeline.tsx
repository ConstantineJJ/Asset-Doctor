import React, { useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Play,
  Repeat,
  Square,
} from 'lucide-react';
import type { AnimationClipInfo } from '../types';

interface AnimationTimelineProps {
  clips: AnimationClipInfo[];
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  currentTime: number;
  duration: number;
  onSeek: (normalized: number) => void;
  onStepFrame: (forward: boolean) => void;
  speed: number;
  onSetSpeed: (speed: number) => void;
  isLooping: boolean;
  onToggleLoop: () => void;
  showRootMotion: boolean;
  onToggleRootMotion: () => void;
}

export const AnimationTimeline: React.FC<AnimationTimelineProps> = ({
  clips,
  activeClipIndex,
  onSelectClip,
  isPlaying,
  onTogglePlay,
  onStop,
  currentTime,
  duration,
  onSeek,
  onStepFrame,
  speed,
  onSetSpeed,
  isLooping,
  onToggleLoop,
  showRootMotion,
  onToggleRootMotion,
}) => {
  // App historically registered Space with an effect that only depended on the
  // render mode, so its closure could retain an old isPlaying value. Capture the
  // shortcut here, where React always supplies the current callback, and stop the
  // older bubbling listener from running a second toggle.
  useEffect(() => {
    if (!clips || clips.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ') return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      onTogglePlay();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [clips?.length, onTogglePlay]);

  if (!clips || clips.length === 0) return null;

  const activeClip = clips[activeClipIndex];
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const speeds = [0.25, 0.5, 1.0, 2.0];

  return (
    <div className="h-12 bg-[#17191e] border-t border-[#262932] px-4 flex items-center justify-between text-xs text-gray-200 select-none shrink-0 z-20">
      <div className="flex items-center space-x-3 min-w-[200px]">
        <div className="flex items-center space-x-1.5 bg-[#1f2228] px-2 py-1 rounded border border-[#2d313a]">
          <Film className="w-3.5 h-3.5 text-purple-400" />
          <select
            id="select-animation-clip"
            value={activeClipIndex}
            onChange={(e) => onSelectClip(Number(e.target.value))}
            className="bg-transparent text-gray-200 text-xs focus:outline-none cursor-pointer font-medium"
          >
            {clips.map((clip, idx) => (
              <option key={`${idx}:${clip.name}`} value={idx} className="bg-[#1f2228]">
                {clip.name} ({clip.duration.toFixed(2)}s)
              </option>
            ))}
          </select>
        </div>

        {activeClip?.rootMotionDetected && (
          <div className="hidden lg:flex items-center gap-1.5">
            <span
              className="px-2 py-0.5 rounded bg-purple-950/80 border border-purple-800 text-purple-300 text-[10px] font-mono"
              title="Root bone translation displacement detected over clip"
            >
              Root Motion: {activeClip.rootMotionTranslation}m
            </span>
            <button
              onClick={onToggleRootMotion}
              className={`px-1.5 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition ${
                showRootMotion
                  ? 'bg-purple-900/70 border-purple-600 text-purple-200'
                  : 'bg-[#1f2228] border-[#3a3344] text-gray-400 hover:text-purple-300'
              }`}
              title="Show the measured root-motion vector in the viewport"
            >
              Path {showRootMotion ? 'ON' : 'OFF'}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3 flex-1 max-w-xl mx-4">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => onStepFrame(false)}
            className="p-1 hover:bg-[#282c35] rounded text-gray-400 hover:text-white"
            title="Step Back 1 Frame"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            id="btn-play-pause-animation"
            onClick={onTogglePlay}
            className="p-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <div className="w-3.5 h-3.5 flex items-center justify-center space-x-0.5">
                <span className="w-1 h-3 bg-white rounded-xs" />
                <span className="w-1 h-3 bg-white rounded-xs" />
              </div>
            ) : (
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={onStop}
            className="p-1 hover:bg-[#282c35] rounded text-gray-400 hover:text-white"
            title="Stop & Reset"
          >
            <Square className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => onStepFrame(true)}
            className="p-1 hover:bg-[#282c35] rounded text-gray-400 hover:text-white"
            title="Step Forward 1 Frame"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            onClick={onToggleLoop}
            className={`p-1 rounded ${
              isLooping ? 'text-cyan-400 hover:bg-[#282c35]' : 'text-gray-400 hover:text-white'
            }`}
            title="Toggle Repeat / Loop"
          >
            <Repeat className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center space-x-2 flex-1">
          <span className="font-mono text-[10px] text-gray-400 w-10 text-right">
            {currentTime.toFixed(2)}s
          </span>
          <input
            id="timeline-scrubber"
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={progress}
            onInput={(e) => onSeek(Number((e.target as HTMLInputElement).value))}
            className="flex-1 h-1.5 accent-cyan-400 cursor-pointer bg-[#262932] rounded"
          />
          <span className="font-mono text-[10px] text-gray-400 w-10">
            {duration.toFixed(2)}s
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-1">
        <span className="text-[10px] text-gray-400 hidden sm:inline mr-1">Speed:</span>
        <div className="flex bg-[#1e2127] p-0.5 rounded border border-[#2d313a]">
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => onSetSpeed(s)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                speed === s
                  ? 'bg-blue-600 text-white font-bold'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};