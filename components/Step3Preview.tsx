'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AppState } from '@/lib/types';
import { ScrollingTextEngine } from '@/lib/canvas-engine';
import { Recorder } from '@/lib/recorder';
import { Play, Pause, RotateCcw, Video, Download, ArrowLeft, Scissors, Rocket, Loader2 } from 'lucide-react';
import { VideoStudio } from './VideoStudio';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

interface Props {
  state: AppState;
  onBack: () => void;
}

export function Step3Preview({ state, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ScrollingTextEngine | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [progress, setProgress] = useState(0);
  const [showStudio, setShowStudio] = useState(false);
  const [turboMode, setTurboMode] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [ffmpeg] = useState(() => new FFmpeg());
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  useEffect(() => {
    const loadFFmpeg = async () => {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      
      ffmpeg.on('log', ({ message }) => {
        console.log('FFmpeg:', message);
      });

      ffmpeg.on('progress', ({ progress }) => {
        const safeProgress = isNaN(progress) || progress < 0 ? 0 : Math.min(1, progress);
        setExportProgress(50 + Math.round(safeProgress * 50));
      });

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setFfmpegLoaded(true);
    };
    loadFFmpeg();
  }, []);

  const stopRecording = async () => {
    if (recorderRef.current) {
      engineRef.current?.setRecordingMode(false);
      const blob = await recorderRef.current.stop();
      setRecordedBlob(blob);
      setIsRecording(false);
      engineRef.current?.pause();
      setIsPlaying(false);
      setProgress(0);
    }
  };

  useEffect(() => {
    if (canvasRef.current) {
      engineRef.current = new ScrollingTextEngine(canvasRef.current, state);
      engineRef.current.onProgress = (p) => {
        setProgress(Math.round(p * 100));
      };
      
      engineRef.current.onComplete = () => {
        setIsPlaying(false);
        if (isRecording) {
          stopRecording();
        }
      };
    }
    return () => {
      engineRef.current?.destroy();
    };
  }, [state]);

  const togglePlay = () => {
    if (engineRef.current) {
      if (isPlaying) {
        engineRef.current.pause();
      } else {
        engineRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const reset = () => {
    if (engineRef.current) {
      engineRef.current.reset();
      setIsPlaying(false);
      setProgress(0);
    }
  };

  const startTurboRecording = async () => {
    if (!canvasRef.current || !engineRef.current || !ffmpegLoaded) return;
    
    setIsRecording(true);
    setIsExporting(true);
    setExportProgress(0);

    const recorder = new Recorder();
    const engine = engineRef.current;
    const canvas = canvasRef.current;

    const TURBO_FACTOR = 4;
    const originalSpeed = state.speed;
    
    engine.setRecordingMode(true);
    engine.updateConfig({ speed: originalSpeed * TURBO_FACTOR });
    engine.reset();

    await recorder.start(canvas, null);
    engine.play();

    const checkInterval = setInterval(async () => {
      if (engine.yOffset < -engine.totalHeight) {
        clearInterval(checkInterval);
        
        const fastBlob = await recorder.stop();
        setExportProgress(50);

        try {
          const fastFile = 'fast.webm';
          const outFile = 'output.mp4';
          
          await ffmpeg.writeFile(fastFile, await fetchFile(fastBlob));
          
          const args = ['-i', fastFile];
          let audioFile = '';
          
          if (state.audioFile) {
            audioFile = 'audio_input' + (state.audioFile.name || '.mp3');
            await ffmpeg.writeFile(audioFile, await fetchFile(state.audioFile));
            args.push('-i', audioFile);
          }

          args.push('-vf', `setpts=${TURBO_FACTOR}*PTS`);
          
          if (state.audioFile) {
            args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28');
            args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
          } else {
            args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-an');
          }
          
          args.push(outFile);
          await ffmpeg.exec(args);
          
          const data = await ffmpeg.readFile(outFile);
          const finalBlob = new Blob([(data as any).buffer], { type: 'video/mp4' });
          
          setRecordedBlob(finalBlob);
          
          await ffmpeg.deleteFile(fastFile);
          if (audioFile) await ffmpeg.deleteFile(audioFile);
          await ffmpeg.deleteFile(outFile);

        } catch (err) {
          console.error('Turbo export failed', err);
          alert('Turbo export failed. Please check the console for details.');
        } finally {
          setIsRecording(false);
          setIsExporting(false);
          engine.updateConfig({ speed: originalSpeed });
          engine.setRecordingMode(false);
          engine.reset();
        }
      }
    }, 500);
  };

  const startRecording = async () => {
    if (canvasRef.current && engineRef.current) {
      if (turboMode) {
        startTurboRecording();
        return;
      }
      recorderRef.current = new Recorder();
      engineRef.current.setRecordingMode(true);
      await recorderRef.current.start(canvasRef.current, state.audioFile);
      engineRef.current.reset();
      engineRef.current.play();
      setIsPlaying(true);
      setIsRecording(true);
      setRecordedBlob(null);
    }
  };

  const downloadVideo = () => {
    if (recordedBlob) {
      const extension = recordedBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const url = URL.createObjectURL(recordedBlob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `cinematic-scroll-${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
        {/* Left Side: Video Preview */}
        <div className="flex-1 w-full lg:order-first order-first">
          <div className="glass p-3 md:p-4 rounded-2xl sticky top-4 lg:top-8 bg-black/20">
            <div className="w-full aspect-[9/16] max-h-[50vh] lg:max-h-[85vh] rounded-xl border border-white/20 overflow-hidden shadow-2xl relative bg-black shadow-yellow-500/5 group">
              <canvas
                ref={canvasRef}
                className="w-full h-full object-contain"
              />
              {isRecording && (
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-red-500/30">
                  <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-red-500 tracking-wider">REC</span>
                </div>
              )}
              
              {/* Seek Slider Overlay (Not recorded) */}
              {!isRecording && (
                <div className="absolute inset-x-0 bottom-0 p-4 md:p-6 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300">
                  <div className="flex items-center gap-4">
                    <input 
                      type="range"
                      min="0"
                      max="1"
                      step="0.001"
                      value={progress / 100}
                      onChange={(e) => {
                        const p = parseFloat(e.target.value);
                        engineRef.current?.pause();
                        setIsPlaying(false);
                        engineRef.current?.setProgress(p);
                        setProgress(Math.round(p * 100));
                      }}
                      className="flex-1 accent-yellow-400 h-1.5 cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-yellow-500 w-8">{progress}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Controls & Info */}
        <div className="w-full lg:w-80 xl:w-96 space-y-4 md:space-y-6">
          <div className="glass p-4 md:p-6 rounded-2xl space-y-6">
            <h3 className="text-xl font-bold font-orbitron flex items-center gap-2">
              <Video className="w-5 h-5 text-green-400" />
              Controls
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-gray-200 flex items-center gap-2">
                    <Rocket className={`w-4 h-4 ${turboMode ? 'text-yellow-500' : 'text-gray-500'}`} />
                    Turbo Mode
                  </span>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Generation at 4x Speed</span>
                </div>
                <button
                  onClick={() => setTurboMode(!turboMode)}
                  disabled={isRecording}
                  className={`w-10 h-5 rounded-full transition-all relative ${turboMode ? 'bg-yellow-500' : 'bg-white/10'} ${isRecording ? 'opacity-50' : ''}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${turboMode ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={togglePlay}
                  disabled={isRecording}
                  className="flex flex-col items-center justify-center gap-2 p-3 md:p-4 bg-white/5 hover:bg-white/10 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPlaying ? <Pause className="w-5 h-5 md:w-6 h-6" /> : <Play className="w-5 h-5 md:w-6 h-6" />}
                  <span className="text-[10px] md:text-xs font-medium">{isPlaying ? 'Pause' : 'Play'}</span>
                </button>
                <button
                  onClick={reset}
                  disabled={isRecording}
                  className="flex flex-col items-center justify-center gap-2 p-3 md:p-4 bg-white/5 hover:bg-white/10 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-5 h-5 md:w-6 h-6" />
                  <span className="text-[10px] md:text-xs font-medium">Reset</span>
                </button>
                <button
                  onClick={isRecording && !isExporting ? stopRecording : startRecording}
                  disabled={isExporting}
                  className={`flex flex-col items-center justify-center gap-2 p-3 md:p-4 rounded-xl transition-all ${
                    isRecording 
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50' 
                      : 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-600/20'
                  } ${isExporting ? 'opacity-50' : ''}`}
                >
                  {isExporting ? (
                    <Loader2 className="w-5 h-5 md:w-6 h-6 animate-spin" />
                  ) : (
                    <div className={`w-5 h-5 md:w-6 h-6 rounded-full border-2 ${isRecording ? 'border-red-400 bg-red-400/20' : 'border-white bg-white/20'}`} />
                  )}
                  <span className="text-[10px] md:text-xs font-bold tracking-wide">
                    {isExporting ? 'EXPORT' : isRecording ? 'STOP' : 'REC'}
                  </span>
                </button>
              </div>
            </div>

            {(isRecording || isExporting) && (
              <div className="pt-4 space-y-2 animate-in fade-in">
                <div className="flex justify-between text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                  <span>{isExporting ? 'Turbo Processing' : 'Recording Progress'}</span>
                  <span>{isExporting ? `${exportProgress}%` : `${progress}%`}</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className={`${isExporting ? 'bg-yellow-500' : 'bg-red-500'} h-full transition-all duration-300 ease-out`} 
                    style={{ width: `${isExporting ? exportProgress : progress}%` }}
                  />
                </div>
              </div>
            )}

            {recordedBlob && (
              <div className="pt-4 border-t border-white/10 animate-in fade-in space-y-3">
                <button
                  onClick={() => setShowStudio(true)}
                  className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 text-black px-6 py-4 rounded-xl font-bold hover:from-yellow-400 hover:to-orange-500 transition-all flex items-center justify-center gap-3 shadow-lg shadow-yellow-500/20 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Scissors className="w-5 h-5" />
                  Open Video Studio
                </button>

                <button
                  onClick={downloadVideo}
                  className="w-full bg-white/5 border border-white/10 text-white px-6 py-4 rounded-xl font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-3"
                >
                  <Download className="w-5 h-5" />
                  Download Video ({recordedBlob.type.includes('mp4') ? 'MP4' : 'WebM'})
                </button>
              </div>
            )}
          </div>

          {showStudio && recordedBlob && (
            <VideoStudio 
              blob={recordedBlob} 
              onClose={() => setShowStudio(false)} 
            />
          )}

          <div className="glass p-6 rounded-2xl space-y-4">
            <h4 className="font-semibold text-gray-300">Export Settings</h4>
            <div className="space-y-2 text-sm text-gray-400">
              <div className="flex justify-between">
                <span>Resolution</span>
                <span className="text-white font-medium">{state.resolution}</span>
              </div>
              <div className="flex justify-between">
                <span>Format</span>
                <span className="text-white font-medium">{recordedBlob?.type.includes('mp4') ? 'MP4 (Standard)' : 'WebM (Native)'}</span>
              </div>
              <div className="flex justify-between">
                <span>Audio</span>
                <span className="text-white font-medium">{state.audioFile ? 'Mixed' : 'None'}</span>
              </div>
              <div className="flex justify-between">
                <span>Framerate</span>
                <span className="text-white font-medium">60 FPS</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-start pt-4">
        <button
          onClick={onBack}
          disabled={isRecording}
          className="px-6 py-3 rounded-full font-semibold text-gray-300 hover:text-white hover:bg-white/5 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Audio
        </button>
      </div>
    </div>
  );
}
