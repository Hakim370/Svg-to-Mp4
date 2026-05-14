import { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';
import { toast } from 'react-hot-toast';
import * as MP4Muxer from 'mp4-muxer';
import { renderSVGFrame, sanitizeSVG } from '../lib/svg-processor';
import { 
  LucideDownload, LucideZap, LucideTrash2, LucidePlay, 
  LucideCheckCircle2, LucideLoader2, LucideFileText, 
  LucideFolderDown, LucideInfo, LucideSettings, LucideSave
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType, loginWithGoogle } from '../lib/firebase';
import { doc, getDoc, updateDoc, increment, serverTimestamp, addDoc, collection, onSnapshot } from 'firebase/firestore';
import JSZip from 'jszip';

interface BatchFile {
  id: string;
  file: File;
  text: string;
  status: 'waiting' | 'processing' | 'success' | 'failed';
  progress: number;
  outURL: string | null;
  outBlob?: Blob;
  error?: string;
  size: number;
}

export function BatchTool() {
  const [queue, setQueue] = useState<BatchFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resolution, setResolution] = useState('1920x1080');
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(6);
  const [bg, setBg] = useState('#000000');
  const [quality, setQuality] = useState(85);
  const [userStats, setUserStats] = useState({ count: 0, limit: 1000 });
  const [isBlocked, setIsBlocked] = useState(false);

  const BATCH_EXPORT_LIMIT = 1000;

  const abortRef = useRef(false);

  const saveSettings = async () => {
    // Local persistence first
    const localData = {
      resolution,
      fps,
      duration,
      bg,
      quality,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem('aura_batch_settings', JSON.stringify(localData));

    if (auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          'batchSettings.resolution': resolution,
          'batchSettings.fps': fps,
          'batchSettings.duration': duration,
          'batchSettings.bg': bg,
          'batchSettings.quality': quality,
          lastUpdated: serverTimestamp()
        });
        toast.success('Settings synced to profile');
      } catch (err) {
        console.error('Cloud sync failed', err);
        toast.success('Settings saved locally');
      }
    } else {
      toast.success('Settings saved locally');
    }
  };

  // Load settings on mount
  useEffect(() => {
    // 1. Try LocalStorage
    const local = localStorage.getItem('aura_batch_settings');
    if (local) {
      try {
        const data = JSON.parse(local);
        setResolution(data.resolution || '1920x1080');
        setFps(data.fps || 30);
        setDuration(data.duration || 6);
        setBg(data.bg || '#000000');
        setQuality(data.quality || 85);
      } catch (e) {
        console.error('Local settings parse error', e);
      }
    }

    // 2. Try Cloud if logged in
    if (auth.currentUser) {
      const loadCloud = async () => {
        const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (snap.exists()) {
          const data = snap.data();
          if (data.batchSettings) {
            setResolution(data.batchSettings.resolution || '1920x1080');
            setFps(data.batchSettings.fps || 30);
            setDuration(data.batchSettings.duration || 6);
            setBg(data.batchSettings.bg || '#000000');
            setQuality(data.batchSettings.quality || 85);
          }
        }
      };
      loadCloud();
    }
  }, []);

  // Sync user stats
  useEffect(() => {
    if (!auth.currentUser) return;
    const userRef = doc(db, 'users', auth.currentUser.uid);
    const unsubscribe = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setIsBlocked(data.isBlocked || false);
        setUserStats({
          count: data.exportCount || 0,
          limit: data.exportLimit ?? 2000
        });
      }
    });
    return () => unsubscribe();
  }, []);

  const QUEUE_LIMIT = 1000;

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    
    if (queue.length + files.length > QUEUE_LIMIT) {
      toast.error(`Queue limit is ${QUEUE_LIMIT} files. Please add fewer files or contact support.`);
      return;
    }

    const newFiles: BatchFile[] = [];
    
    Array.from(files).forEach(f => {
      if (f.type !== 'image/svg+xml' && !f.name.toLowerCase().endsWith('.svg')) {
        toast.error(`${f.name} is not an SVG`);
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = sanitizeSVG(e.target?.result as string);
        const batchFile: BatchFile = {
          id: Math.random().toString(36).substr(2, 9),
          file: f,
          text,
          status: 'waiting',
          progress: 0,
          outURL: null,
          size: Math.round(f.size / 1024)
        };
        setQueue(prev => [...prev, batchFile]);
      };
      reader.readAsText(f);
    });
  };

  const removeFile = (id: string) => {
    setQueue(prev => prev.filter(f => f.id !== id));
  };

  const clearQueue = () => {
    setQueue([]);
    setIsProcessing(false);
  };

  const processQueue = async () => {
    if (isProcessing) {
      abortRef.current = true;
      return;
    }

    if (isBlocked) {
      toast.error('Account restricted');
      return;
    }

    const waiting = queue.filter(f => f.status === 'waiting' || f.status === 'failed');
    if (waiting.length === 0) return;

    if (auth.currentUser && userStats.count + waiting.length > BATCH_EXPORT_LIMIT) {
      toast.error(`Batch Export limit reached (${BATCH_EXPORT_LIMIT}). Please contact support for more.`);
      return;
    }

    setIsProcessing(true);
    abortRef.current = false;

    const [W, H] = resolution.split('x').map(Number);
    const totalFrames = Math.round(fps * duration);

    for (const item of waiting) {
      if (abortRef.current) break;

      try {
        updateFileStatus(item.id, 'processing', 0);
        const blob = await encodeMP4(item.text, W, H, fps, duration, totalFrames, quality / 100, bg, item.id);
        const url = URL.createObjectURL(blob);
        updateFileStatus(item.id, 'success', 100, url, undefined, blob);
        
        // Update Firestore
        if (auth.currentUser) {
           await addDoc(collection(db, 'exports'), {
            userId: auth.currentUser.uid,
            fileName: item.file.name,
            fileSize: Math.round(blob.size / 1024),
            duration,
            fps,
            resolution,
            status: 'completed',
            createdAt: serverTimestamp(),
            isBatch: true
          });
          await updateDoc(doc(db, 'users', auth.currentUser.uid), {
            exportCount: increment(1)
          });
        }
      } catch (err: any) {
        console.error(err);
        updateFileStatus(item.id, 'failed', 0, null, err.message);
      }
    }

    setIsProcessing(false);
    toast.success('Batch Processing Finished');
  };

  const updateFileStatus = (id: string, status: any, progress: number, url?: string | null, error?: string, blob?: Blob) => {
    setQueue(prev => prev.map(f => f.id === id ? { ...f, status, progress, outURL: url ?? f.outURL, error, outBlob: blob ?? f.outBlob } : f));
  };

  const encodeMP4 = async (svg: string, W: number, H: number, fps: number, dur: number, total: number, q: number, background: string, id: string): Promise<Blob> => {
    let muxer = new MP4Muxer.Muxer({
      target: new MP4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H },
      fastStart: 'in-memory'
    });

    const encoder = new VideoEncoder({
      output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
      error: (e) => { throw e; }
    });

    const codec = (W * H > 2073600) ? 'avc1.640034' : 'avc1.64002A';
    
    encoder.configure({
      codec: codec,
      width: W,
      height: H,
      bitrate: Math.round(q * 150000000), // Boosted to 150Mbps for Adobe Stock Quality
      bitrateMode: 'constant',
      framerate: fps,
      avc: { format: 'avc' }
    });

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    for (let f = 0; f < total; f++) {
      if (abortRef.current || encoder.state === 'closed') throw new Error('aborted or encoder failed');
      
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, W, H);
      await renderSVGFrame(ctx, svg, f / fps, W, H);

      if (encoder.state !== 'configured') break;

      const frame = new VideoFrame(canvas, { 
        timestamp: Math.round(f * (1000000 / fps)), 
        duration: Math.round(1000000 / fps) 
      });
      
      try {
        encoder.encode(frame, { keyFrame: f % 30 === 0 });
      } catch (e) {
        frame.close();
        throw e;
      }
      frame.close();

      if (f % 10 === 0) {
        const p = Math.round((f / total) * 100);
        updateFileStatus(id, 'processing', p);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    await encoder.flush();
    encoder.close();
    muxer.finalize();

    return new Blob([(muxer.target as MP4Muxer.ArrayBufferTarget).buffer], { type: 'video/mp4' });
  };

  const downloadAll = async () => {
    const successItems = queue.filter(f => f.outBlob);
    if (successItems.length === 0) {
      toast.error('No successful exports to bundle');
      return;
    }

    const tId = toast.loading(`Bundling ${successItems.length} files...`);
    try {
      const zip = new JSZip();
      for (const item of successItems) {
        if (!item.outBlob) continue;
        zip.file(`${item.file.name.replace(/\.svg$/i, '')}.mp4`, item.outBlob);
      }

      const content = await zip.generateAsync({ 
        type: 'blob',
        compression: 'STORE' // Since MP4 is already compressed
      });
      
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aura_batch_${new Date().getTime()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success('ZIP Export Complete', { id: tId });
    } catch (err) {
      console.error('ZIP Error:', err);
      toast.error('Failed to generate ZIP', { id: tId });
    }
  };

  return (
    <div className="batch-wrap flex flex-col flex-1 px-4 md:px-9 py-8">
      <div className="header-row flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tighter uppercase tracking-[4px]">Batch Processor</h1>
          <p className="font-mono text-[10px] text-text-dim mt-1 uppercase tracking-widest opacity-60">High-speed sequential SVG to MP4 engine</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="sc-mini bg-s1 border border-border-b1 px-4 py-2 rounded-xl flex items-center gap-3">
             <div className="flex flex-col">
                <span className="font-mono text-[8px] text-text-dim tracking-widest uppercase opacity-50">Exports Remaining</span>
                {userStats.count >= BATCH_EXPORT_LIMIT ? (
                  <span className="font-bold text-[10px] text-pink-glow animate-pulse">GET SUPPORT</span>
                ) : (
                  <span className="font-bold text-xs text-purple-glow">{Math.max(0, BATCH_EXPORT_LIMIT - userStats.count)}</span>
                )}
             </div>
             <div className="w-px h-6 bg-border-b1" />
             <div className="flex flex-col">
                <span className="font-mono text-[8px] text-text-dim tracking-widest uppercase opacity-50">Queue Size</span>
                {queue.length >= QUEUE_LIMIT ? (
                  <span className="font-bold text-[10px] text-pink-glow animate-pulse">GET SUPPORT</span>
                ) : (
                  <span className="font-bold text-xs text-cyan-glow">{queue.length}</span>
                )}
             </div>
          </div>
          <button 
            onClick={downloadAll}
            disabled={!queue.some(f => f.outURL)}
            className="px-5 py-2.5 bg-white/5 border border-border-b1 text-text-dim hover:text-white hover:border-white transition-all rounded-xl font-mono text-[10px] uppercase tracking-widest flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <LucideFolderDown size={14} /> ZIP Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8 flex-1">
        <div className="main-col flex flex-col gap-6">
          {/* Dropzone */}
          <div className="card bg-s1 border border-border-b1 rounded-[24px] overflow-hidden group hover:border-border-b2 transition-all">
             <input 
               type="file" 
               multiple 
               accept=".svg" 
               id="batch-upload" 
               className="hidden" 
               onChange={e => handleFiles(e.target.files)}
             />
             <label 
               htmlFor="batch-upload"
               className="flex flex-col items-center justify-center p-12 cursor-pointer bg-[radial-gradient(ellipse_at_center,rgba(155,77,255,0.03),transparent_70%)] animate-pulse-slow"
             >
                <div className="di w-16 h-16 bg-purple-glow/10 border border-purple-glow/20 rounded-2xl flex items-center justify-center text-4xl mb-6 shadow-glow-purple group-hover:-translate-y-1 transition-transform">⚙</div>
                <h2 className="text-xl font-black text-white uppercase tracking-wider">Drag & Drop Batch</h2>
                <p className="font-mono text-[10px] text-text-dim mt-2 tracking-widest">Select multiple SVG files to start queuing</p>
             </label>
          </div>

          {/* Queue List */}
          <div className="queue-container flex flex-col gap-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {queue.length === 0 && (
              <div className="empty-queue flex flex-col items-center justify-center py-20 bg-s1/30 border border-dashed border-border-b1 rounded-[24px] opacity-40 relative group overflow-hidden">
                <div className="absolute top-4 right-6 font-mono text-[8px] text-cyan-glow border border-cyan-glow/30 px-2 py-0.5 rounded uppercase tracking-[2px]">Preview</div>
                <LucideFileText size={48} strokeWidth={1} />
                <p className="font-mono text-[10px] mt-4 tracking-widest uppercase">No files in queue</p>
              </div>
            )}
            {queue.map(item => (
              <div key={item.id} className="item bg-s1 border border-border-b1 hover:border-border-b2 p-4 rounded-2xl transition-all flex items-center justify-between gap-4 group">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center text-lg",
                    item.status === 'processing' ? "bg-cyan-glow/20 text-cyan-glow animate-spin-slow" : 
                    item.status === 'success' ? "bg-green-glow/20 text-green-glow" :
                    item.status === 'failed' ? "bg-pink-glow/20 text-pink-glow" : "bg-white/5 text-text-dim"
                  )}>
                    {item.status === 'processing' ? <LucideLoader2 size={20} /> : 
                     item.status === 'success' ? <LucideCheckCircle2 size={20} /> : 
                     item.status === 'failed' ? '✕' : '⬡'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-xs truncate text-text-main group-hover:text-cyan-glow transition-colors">{item.file.name}</div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="font-mono text-[8px] text-text-dim uppercase tracking-wider">{item.size} KB</span>
                      <span className={cn(
                        "font-mono text-[8px] uppercase tracking-widest px-1.5 py-0.5 rounded",
                        item.status === 'waiting' && "text-text-dim/60",
                        item.status === 'processing' && "text-cyan-glow font-bold",
                        item.status === 'success' && "text-green-glow font-bold",
                        item.status === 'failed' && "text-pink-glow font-bold"
                      )}>
                        {item.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {item.status === 'processing' && (
                    <div className="w-24 h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-glow" style={{ width: `${item.progress}%` }} />
                    </div>
                  )}
                  {item.outURL && (
                    <a href={item.outURL} download={`${item.file.name.replace(/\.svg$/i, '')}.mp4`} className="w-8 h-8 rounded-lg bg-green-glow/10 text-green-glow flex items-center justify-center hover:bg-green-glow/20 transition-all">
                      <LucideDownload size={14} />
                    </a>
                  )}
                  <button onClick={() => removeFile(item.id)} className="w-8 h-8 rounded-lg bg-white/5 text-text-dim hover:bg-pink-glow/10 hover:text-pink-glow transition-all opacity-0 group-hover:opacity-100">
                    <LucideTrash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar flex flex-col gap-6">
          {/* Controls */}
          <div className="card bg-s1 border border-border-b1 rounded-[24px] p-6 shadow-xl shadow-cyan-glow/5">
             <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <LucideSettings size={18} className="text-cyan-glow" />
                  <h3 className="font-bold text-sm text-white uppercase tracking-wider">Batch Setup</h3>
                </div>
                <button 
                  onClick={saveSettings}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-cyan-glow/20 bg-cyan-glow/5 text-cyan-glow hover:bg-cyan-glow/10 transition-all font-mono text-[9px] uppercase tracking-widest"
                  title="Save current settings as default"
                >
                  <LucideSave size={12} />
                  Save
                </button>
             </div>

             <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                   <label className="font-mono text-[9px] text-text-dim uppercase tracking-[2px]">Export Format</label>
                   <div className="bg-s2/50 border border-border-b2/50 p-3 rounded-xl font-mono text-[10px] text-cyan-glow/80 flex items-center gap-2">
                      <LucideZap size={10} className="text-purple-glow" />
                      <span>MP4 — Adobe Stock / Social</span>
                   </div>
                </div>

                <div className="flex flex-col gap-2">
                   <label className="font-mono text-[9px] text-text-dim uppercase tracking-[2px]">Resolution</label>
                   <select value={resolution} onChange={e => setResolution(e.target.value)} className="bg-s2 border border-border-b2 p-3 rounded-xl font-mono text-[10px] text-white outline-none hover:border-cyan-glow/50 transition-all">
                      <option value="1280x720">1280x720 (HD)</option>
                      <option value="1920x1080">1920x1080 (Adobe Stock / FHD)</option>
                      <option value="2560x1440">2560x1440 (2K)</option>
                      <option value="3840x2160">3840x2160 (4K UHD)</option>
                   </select>
                </div>
                <div className="flex flex-col gap-2">
                   <label className="font-mono text-[9px] text-text-dim uppercase tracking-[2px]">Frame Rate</label>
                   <select value={fps} onChange={e => setFps(Number(e.target.value))} className="bg-s2 border border-border-b2 p-3 rounded-xl font-mono text-[10px] text-white outline-none hover:border-cyan-glow/50 transition-all">
                      <option value="24">24 FPS</option>
                      <option value="30">30 FPS</option>
                      <option value="60">60 FPS</option>
                   </select>
                </div>
                <div className="flex flex-col gap-2">
                   <label className="font-mono text-[9px] text-text-dim uppercase tracking-[2px]">Length (sec)</label>
                   <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} className="bg-s2 border border-border-b2 p-3 rounded-xl font-mono text-[10px] text-white outline-none hover:border-cyan-glow/50 transition-all" />
                </div>
                <div className="flex flex-col gap-2">
                   <label className="font-mono text-[9px] text-text-dim uppercase tracking-[2px]">Backfill Color</label>
                   <select value={bg} onChange={e => setBg(e.target.value)} className="bg-s2 border border-border-b2 p-3 rounded-xl font-mono text-[10px] text-white outline-none hover:border-cyan-glow/50 transition-all">
                      <option value="#000000">Black</option>
                      <option value="#111111">Dark Gray</option>
                      <option value="#ffffff">White</option>
                      <option value="#ff00ff">Magenta (Debug)</option>
                   </select>
                </div>

                <div className="flex flex-col gap-2">
                   <div className="flex justify-between items-end">
                     <div className="flex flex-col">
                        <label className="font-mono text-[9px] text-text-dim uppercase tracking-[2px]">Master Quality</label>
                        <span className="text-[7px] text-cyan-glow/40 uppercase tracking-[1px]">Adobe Stock Optimized</span>
                     </div>
                     <span className="font-mono text-[10px] text-cyan-glow font-bold">{quality}%</span>
                   </div>
                   <input 
                     type="range" 
                     value={quality} 
                     onChange={e => setQuality(Number(e.target.value))} 
                     min={80} max={100}
                     className="accent-cyan-glow cursor-pointer mt-1"
                   />
                </div>
                
                <div className="pt-4 flex flex-col gap-3">
                   <button 
                     onClick={processQueue}
                     disabled={queue.length === 0 || userStats.count >= BATCH_EXPORT_LIMIT}
                     className={cn(
                       "w-full py-4 rounded-2xl font-black text-xs tracking-[3px] uppercase transition-all shadow-lg",
                       isProcessing ? "bg-pink-glow text-white animate-pulse" : (userStats.count >= BATCH_EXPORT_LIMIT ? "bg-white/5 text-text-dim cursor-not-allowed" : "bg-gradient-to-r from-cyan-glow to-purple-glow text-white hover:-translate-y-1 hover:shadow-cyan-glow/30")
                     )}
                   >
                     {isProcessing ? '🛑 Stop Engine' : (userStats.count >= BATCH_EXPORT_LIMIT ? 'Limit Reached' : '🚀 Start Engine')}
                   </button>
                   <button 
                     onClick={clearQueue}
                     className="w-full py-3 border border-border-b1 text-text-dim hover:text-white rounded-2xl font-mono text-[9px] uppercase tracking-widest transition-all"
                   >
                     Clear List
                   </button>
                </div>
             </div>
          </div>

          {/* Info Card */}
          <div className="card bg-s1/60 border border-border-b1 rounded-[24px] p-6 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-glow/5 blur-[50px] rounded-full" />
             <div className="flex items-center gap-3 mb-4">
                <LucideInfo size={16} className="text-cyan-glow" />
                <h4 className="font-bold text-[10px] text-white uppercase tracking-widest">Engine Info</h4>
             </div>
             <p className="text-[10px] text-text-dim leading-relaxed font-mono uppercase tracking-wider opacity-70">
                The batch engine processes files sequentially to ensure maximum performance and bypass browser memory limitations. Each file is rendered frame-by-frame and muxed into high-quality MP4.
             </p>
          </div>
        </div>
      </div>
    </div>
  );
}
