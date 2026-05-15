import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';
import { LucideTerminal, LucidePlay, LucideTrash2, LucideCopy, LucideRefreshCcw, LucideZap, LucideSend } from 'lucide-react';
import { sanitizeSVG } from '../lib/svg-processor';
import { toast } from 'react-hot-toast';

interface PlaygroundProps {
  onSendToAura: (svg: string) => void;
}

const PG_SAMPLE = `<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <rect width="1920" height="1080" fill="#070d14"/>
  
  <g transform="translate(960, 540)">
    <!-- GRID LINES -->
    <path d="M-500,0 L500,0 M0,-500 L0,500" stroke="#00d4ff" stroke-width="1" opacity="0.1"/>
    
    <!-- MAIN CIRCLE -->
    <circle r="200" fill="none" stroke="#00d4ff" stroke-width="2" stroke-dasharray="10, 5">
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="10s" repeatCount="indefinite"/>
    </circle>
    
    <circle r="180" fill="none" stroke="#9b4dff" stroke-width="1" opacity="0.5">
      <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="20s" repeatCount="indefinite"/>
    </circle>

    <!-- CORE PULSE -->
    <circle r="40" fill="#00d4ff">
      <animate attributeName="r" values="40;60;40" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"/>
    </circle>

    <!-- FLOATING BITS -->
    <g>
      <rect x="220" y="-10" width="40" height="20" fill="#ff3d7f">
        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"/>
      </rect>
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="8s" repeatCount="indefinite"/>
    </g>
  </g>

  <!-- SCAN LINE -->
  <rect width="1920" height="2" fill="#00d4ff" opacity="0.3">
    <animate attributeName="y" values="0;1080;0" dur="4s" repeatCount="indefinite"/>
  </rect>

  <text x="960" y="850" fill="#e8f4ff" font-family="Outfit" font-size="40" font-weight="bold" text-anchor="middle" letter-spacing="10">
    AURA ENGINE
    <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite"/>
  </text>
</svg>`;

export function Playground({ onSendToAura }: PlaygroundProps) {
  const [code, setCode] = useState(PG_SAMPLE);
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(1);
  const [status, setStatus] = useState('IDLE — paste SVG to begin');
  const [isRendered, setIsRendered] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumsRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    updateLineNums();
    const timer = setTimeout(() => {
      if (code.trim()) {
        runPreview();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [code, showGrid]);

  useEffect(() => {
    if (frameRef.current && frameRef.current.contentWindow) {
      frameRef.current.contentWindow.postMessage({ type: 'HIGHLIGHT_SVG', id: highlightedElementId }, '*');
    }
  }, [highlightedElementId]);

  const updateLineNums = () => {
    const lines = code.split('\n').length;
    setLineCount(lines);
  };

  const handleScroll = () => {
    if (editorRef.current && lineNumsRef.current) {
      lineNumsRef.current.scrollTop = editorRef.current.scrollTop;
    }
    if (editorRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = editorRef.current.scrollTop;
      highlightRef.current.scrollLeft = editorRef.current.scrollLeft;
    }
  };

  const highlightInPreview = (e: React.MouseEvent<HTMLTextAreaElement> | React.KeyboardEvent<HTMLTextAreaElement> | React.FocusEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const textBefore = code.substring(0, start);
    const lines = textBefore.split('\n');
    const currentLineIdx = lines.length - 1;
    const allLines = code.split('\n');
    const currentLineText = allLines[currentLineIdx];

    // Detect ID or tag on current line
    const idMatch = currentLineText.match(/id=["']([^"']+)["']/i);
    const tagMatch = currentLineText.match(/<([a-z0-9]+)/i);

    if (idMatch) {
      setHighlightedElementId(idMatch[1]);
    } else if (tagMatch && !tagMatch[1].toLowerCase().startsWith('svg')) {
      const tagName = tagMatch[1];
      let occurrenceIndex = 0;
      for (let i = 0; i <= currentLineIdx; i++) {
        const line = allLines[i];
        const matches = line.match(new RegExp(`<${tagName}\\b`, 'gi'));
        if (matches) {
          occurrenceIndex += matches.length;
        }
      }
      setHighlightedElementId(`tag:${tagName}:${occurrenceIndex}`);
    } else {
      setHighlightedElementId(null);
    }
  };

  const highlightSVGCode = (svg: string) => {
    if (!svg) return '';
    return svg
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/(&lt;\/?[a-z0-9]+)(\s|&gt;)/gi, '<span class="text-pink-400">$1</span>$2') 
      .replace(/\s([a-z0-9-]+)=/gi, ' <span class="text-orange-300">$1</span>=') 
      .replace(/="([^"]*)"/g, '="<span class="text-green-300">$1</span>"')
      .replace(/(&lt;!--.*?--&gt;)/g, '<span class="text-gray-500 italic">$1</span>');
  };

  const runPreview = () => {
    const sanitized = sanitizeSVG(code);
    if (!sanitized.trim()) {
      setStatus('AWAITING CODE...');
      return;
    }

    // Advanced Validation using DOMParser for detailed errors
    const parser = new DOMParser();
    const doc = parser.parseFromString(code, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');

    if (parseError) {
      const errorText = parseError.textContent || '';
      // Extract line number if possible
      const lineMatch = errorText.match(/line\s+(\d+)/i) || errorText.match(/:(\d+):(\d+)/);
      const lineNo = lineMatch ? lineMatch[1] : '?';
      
      let cleanMsg = errorText.split('\n')[0];
      if (cleanMsg.includes('-->')) cleanMsg = cleanMsg.split('-->')[1]?.trim() || cleanMsg;
      
      setStatus(`Invalid SVG\nLine ${lineNo}:0\n${cleanMsg}`);
      setIsRendered(false);
      return;
    }

    if (!sanitized.includes('<svg')) {
      setStatus('⚠️ INVALID SVG — Missing <svg> tag');
      return;
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin:0; padding:0; box-sizing:border-box }
    html, body { width:100%; height:100%; background:#000; display:flex; align-items:center; justify-content:center; overflow:hidden }
    svg { max-width:100%; max-height:100%; width:auto; height:auto; transition: all 0.3s ease; position: relative; z-index: 2; }
    
    .inspector-glow {
      outline: 2px solid #00d4ff !important;
      outline-offset: 4px !important;
      filter: drop-shadow(0 0 12px #00d4ff) !important;
      transition: all 0.2s ease !important;
      stroke: #00d4ff !important;
      stroke-width: 2px !important;
    }

    .grid {
      position: absolute;
      inset: 0;
      background-image: 
        linear-gradient(to right, #111 1px, transparent 1px),
        linear-gradient(to bottom, #111 1px, transparent 1px);
      background-size: 20px 20px;
      display: ${showGrid ? 'block' : 'none'};
      z-index: 1;
    }
  </style>
</head>
<body>
  <div class="grid"></div>
  ${sanitized}
  <script>
    window.addEventListener('message', (e) => {
      if (e.data.type === 'HIGHLIGHT_SVG') {
        const prev = document.querySelectorAll('.inspector-glow');
        prev.forEach(el => el.classList.remove('inspector-glow'));
        
        let target = null;
        const info = e.data.id;
        if (!info) return;

        if (info.startsWith('tag:')) {
          const parts = info.split(':');
          const tagName = parts[1];
          const index = parseInt(parts[2]) - 1;
          const targets = document.querySelectorAll(tagName);
          target = targets[index] || targets[0];
        } else {
          target = document.getElementById(info);
        }

        if (target) {
          target.classList.add('inspector-glow');
        }
      }
    });
  </script>
</body>
</html>`;

    if (previewURL) URL.revokeObjectURL(previewURL);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setPreviewURL(url);
    setIsRendered(true);
    setStatus('⚡ LIVE — SYNCHRONIZED');
  };

  const clearEditor = () => {
    setCode('');
    setPreviewURL(null);
    setIsRendered(false);
    setStatus('IDLE — paste SVG to begin');
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setStatus('SVG CODE COPIED TO CLIPBOARD');
    setTimeout(() => setStatus('SVG VALID — preview running'), 2000);
  };

  const downloadSVG = () => {
    if (!code.trim()) return;
    const blob = new Blob([code], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aura-design.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus('SVG FILE DOWNLOADED');
    setTimeout(() => setStatus('SVG VALID — preview running'), 2000);
  };

  const loadSample = () => {
    setCode(PG_SAMPLE);
    runPreview();
  };

  const handleSendToAura = (svg: string) => {
    onSendToAura(sanitizeSVG(svg));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (re) => {
        const content = re.target?.result as string;
        if (content.includes('<svg')) {
          setCode(content);
          setStatus('SVG FILE LOADED');
        } else {
          toast.error('Invalid SVG file');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setIsDragging(true);
    if (e.type === 'dragleave') setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (re) => {
        const content = re.target?.result as string;
        if (content.includes('<svg')) {
          setCode(content);
          setStatus('SVG DROPPED & LOADED');
        } else {
          toast.error('Invalid SVG dropped');
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="flex flex-col flex-1 h-full">
      <div className="pg-info-row flex gap-2.5 px-4 md:px-9 pt-6 flex-wrap">
        <div className="pg-info-chip flex items-center gap-2 font-mono text-[8px] text-text-dim px-3 py-1.5 bg-cyan-glow/5 border border-border-b1 rounded-lg tracking-wider">
          ✦ <b className="text-cyan-glow uppercase">SVG Playground</b> — write or paste SVG code and see it live
        </div>
        <div className="pg-info-chip flex items-center gap-2 font-mono text-[8px] text-text-dim px-3 py-1.5 bg-cyan-glow/5 border border-border-b1 rounded-lg tracking-wider">
          🎞 <b className="text-cyan-glow uppercase">Animations supported</b> — CSS keyframes & SMIL
        </div>
        <div className="pg-info-chip flex items-center gap-2 font-mono text-[8px] text-text-dim px-3 py-1.5 bg-cyan-glow/5 border border-border-b1 rounded-lg tracking-wider">
          ▶ <b className="text-cyan-glow uppercase">Send to AURA</b> — convert your SVG to WebM video
        </div>
      </div>

      <div className="pg-wrap grid grid-cols-1 lg:grid-cols-2 gap-6 p-4 md:p-9 items-start">
        {/* Editor Panel */}
        <div className="pg-card bg-s1 border border-border-b1 rounded-[18px] overflow-hidden flex flex-col h-[600px] shadow-2xl">
          <div className="pg-card-head px-5 py-3.5 border-b border-border-b1 flex items-center justify-between bg-gradient-to-r from-cyan-glow/5 to-transparent">
            <div className="pg-card-title flex items-center gap-2.5 font-mono text-[8px] font-bold tracking-[3px] text-text-dim uppercase">
              <div className="step-num w-6 h-6 rounded-lg bg-cyan-glow/15 border border-cyan-glow/25 flex items-center justify-center text-cyan-glow">01</div>
              SVG CODE EDITOR
            </div>
            <div className="pg-actions flex items-center gap-2">
              <label className="pg-btn font-mono text-[8px] font-bold tracking-wider px-3 py-1 rounded bg-cyan-glow/5 border border-cyan-glow/25 text-cyan-glow hover:bg-cyan-glow/15 uppercase transition-all cursor-pointer">
                UPLOAD
                <input type="file" accept=".svg" onChange={handleFileUpload} className="hidden" />
              </label>
              <button onClick={copyCode} className="pg-btn font-mono text-[8px] font-bold tracking-wider px-3 py-1 rounded bg-cyan-glow/5 border border-cyan-glow/25 text-cyan-glow hover:bg-cyan-glow/15 uppercase transition-all">COPY</button>
              <button onClick={clearEditor} className="pg-btn font-mono text-[8px] font-bold tracking-wider px-3 py-1 rounded bg-pink-glow/5 border border-pink-glow/25 text-pink-glow hover:bg-pink-glow/15 uppercase transition-all">CLEAR</button>
              <div className="px-3 py-1 rounded bg-green-glow/10 border border-green-glow/20 text-green-glow font-mono text-[8px] font-bold tracking-wider uppercase animate-pulse">LIVE</div>
            </div>
          </div>
          
          <div 
            className={cn(
              "pg-editor-wrap flex-1 relative overflow-hidden bg-[#05111b] transition-colors",
              isDragging && "bg-cyan-glow/5"
            )}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
          >
            <div ref={lineNumsRef} className="pg-line-nums absolute left-0 top-0 bottom-0 w-[42px] bg-black/35 border-r border-cyan-glow/10 py-[18px] px-2 font-mono text-xs leading-[1.7] text-cyan-glow/20 text-right select-none pointer-events-none custom-scrollbar overflow-hidden">
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <div className="absolute inset-0 left-[42px] overflow-hidden custom-scrollbar">
              <pre
                ref={highlightRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 p-4 pt-[18px] font-mono text-xs leading-[1.7] whitespace-pre break-all select-none overflow-hidden"
                dangerouslySetInnerHTML={{ __html: highlightSVGCode(code) + '\n\n' }}
              />
              <textarea 
                ref={editorRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onScroll={handleScroll}
                onKeyUp={highlightInPreview}
                onClick={highlightInPreview}
                onSelect={highlightInPreview}
                onFocus={(e) => { setIsFocused(true); highlightInPreview(e); }}
                onBlur={() => setIsFocused(false)}
                spellCheck={false}
                className="w-full h-full bg-transparent text-transparent caret-cyan-glow font-mono text-xs leading-[1.7] p-4 outline-none resize-none tab-[2] selection:bg-cyan-glow/20 whitespace-pre overflow-auto custom-scrollbar"
                placeholder="Paste or type your SVG code here…"
              />
            </div>
          </div>

          <div className="pg-status-bar px-4 py-2 border-t border-border-b1 bg-black/30 flex items-center justify-between">
            <div className="pg-status flex items-center gap-2 font-mono text-[8px] text-text-dim tracking-wider uppercase whitespace-pre-line">
              <div className={cn("w-1.5 h-1.5 rounded-full", isRendered ? "bg-green-glow shadow-[0_0_6px_var(--color-green-glow)]" : "bg-text-dim")} />
              {status}
            </div>
            <div className="font-mono text-[8px] text-cyan-glow/30 tracking-widest uppercase">{lineCount} lines</div>
          </div>

          <button 
            onClick={() => handleSendToAura(code)}
            className="pg-send-btn w-full py-4 bg-gradient-to-r from-cyan-glow to-purple-glow text-white font-bold text-xs tracking-[2.5px] uppercase hover:tracking-[3.5px] transition-all disabled:opacity-30 disabled:cursor-not-allowed button-shine-effect"
            disabled={!code.trim()}
          >
            ⬡ SEND TO AURA & CONVERT TO VIDEO
          </button>
        </div>

        {/* Live Preview Panel */}
        <div className="pg-card bg-s1 border border-border-b1 rounded-[18px] overflow-hidden flex flex-col h-[600px] shadow-2xl">
          <div className="pg-card-head px-5 py-3.5 border-b border-border-b1 flex items-center justify-between bg-gradient-to-r from-cyan-glow/5 to-transparent">
            <div className="pg-card-title flex items-center gap-2.5 font-mono text-[8px] font-bold tracking-[3px] text-text-dim uppercase">
              <div className="step-num w-6 h-6 rounded-lg bg-cyan-glow/15 border border-cyan-glow/25 flex items-center justify-center text-cyan-glow">02</div>
              LIVE PREVIEW
            </div>
            <div className="pg-actions flex items-center gap-2">
              <button 
                onClick={() => setShowGrid(!showGrid)} 
                className={cn(
                  "pg-btn font-mono text-[8px] font-bold tracking-wider px-3 py-1 rounded border transition-all uppercase",
                  showGrid ? "bg-cyan-glow text-black border-cyan-glow shadow-[0_0_10px_rgba(0,212,255,0.3)]" : "bg-cyan-glow/5 border-cyan-glow/25 text-cyan-glow hover:bg-cyan-glow/15"
                )}
              >
                GRID: {showGrid ? 'ON' : 'OFF'}
              </button>
              <button onClick={downloadSVG} className="pg-btn font-mono text-[8px] font-bold tracking-wider px-3 py-1 rounded bg-cyan-glow/5 border border-cyan-glow/25 text-cyan-glow hover:bg-cyan-glow/15 uppercase transition-all">DOWNLOAD</button>
              <button onClick={loadSample} className="pg-btn font-mono text-[8px] font-bold tracking-wider px-3 py-1 rounded bg-cyan-glow/5 border border-cyan-glow/25 text-cyan-glow hover:bg-cyan-glow/15 uppercase transition-all">SAMPLE</button>
              <button onClick={runPreview} title="Force Refresh" className="pg-btn font-mono text-[8px] font-bold tracking-wider p-1.5 rounded bg-cyan-glow/5 border border-cyan-glow/25 text-cyan-glow hover:bg-cyan-glow/15 uppercase transition-all">
                <LucideRefreshCcw size={10} />
              </button>
            </div>
          </div>

          <div className="pg-preview-wrap flex-1 bg-black overflow-hidden flex items-center justify-center relative">
            {!isRendered ? (
              <div className="pg-preview-empty flex flex-col items-center gap-3 text-text-dim font-mono text-[9px] tracking-[1px] opacity-50">
                 <LucidePlay size={40} strokeWidth={1} />
                 <span>Click RUN to preview your SVG</span>
              </div>
            ) : (
              <iframe 
                ref={frameRef} 
                src={previewURL || 'about:blank'} 
                className="w-full h-full border-none block"
              />
            )}
          </div>

          <div className="pg-status-bar px-4 py-2 border-t border-border-b1 bg-black/30 flex items-center justify-between">
            <div className="pg-status flex items-center gap-2 font-mono text-[8px] text-text-dim tracking-wider uppercase">
              <div className={cn("w-1.5 h-1.5 rounded-full", isRendered ? "bg-green-glow shadow-[0_0_6px_var(--color-green-glow)]" : "bg-text-dim")} />
              {isRendered ? 'RENDERING LIVE' : 'AWAITING RENDER'}
            </div>
            <div className="font-mono text-[8px] text-cyan-glow/30 tracking-widest uppercase">
              {isRendered ? (code.length / 1024).toFixed(1) + ' KB' : '—'}
            </div>
          </div>
          
          <div className="p-4 bg-black/25 border-t border-border-b1 font-mono text-[8px] text-text-dim leading-[2] tracking-wider">
            💡 <b className="text-cyan-glow">TIP:</b> After previewing, click <b className="text-text-main">"Send to AURA"</b> to instantly load this SVG into the converter and render it as a full WebM video with your chosen resolution & frame rate.
          </div>
        </div>
      </div>
    </div>
  );
}
