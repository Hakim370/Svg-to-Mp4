import { Tab } from '../App';
import { cn } from '../lib/utils';

interface HeaderProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export function Header({ activeTab, onTabChange }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 md:px-9 py-4 border-b border-border-b2 backdrop-blur-3xl bg-bg/80 sticky top-0 z-[99]">
      <div className="logo flex items-center gap-3.5">
        <div className="lm w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-glow to-purple-glow flex items-center justify-center font-black text-xl text-white shadow-[0_0_30px_rgba(0,212,255,0.35)] relative overflow-hidden logo-shine-animate">
          A
        </div>
        <div className="ln text-base font-black tracking-[4px] bg-gradient-to-br from-text-main to-cyan-glow bg-clip-text text-transparent leading-none">
          AURA <br/> <span className="text-[10px] tracking-[2px] opacity-80">SVG STUDIO</span>
        </div>
        <div className="hbadge hidden sm:block font-mono text-[8px] text-cyan-glow border border-cyan-glow/30 px-2.5 py-1 rounded-full bg-cyan-glow/5 tracking-[2.5px] shadow-[0_0_12px_rgba(0,212,255,0.1)]">
          SVG → WEBM
        </div>
      </div>

      <div className="hright flex items-center gap-4">
        <nav className="pg-nav flex items-center gap-1.5">
          <button 
            type="button"
            onClick={() => onTabChange('aura')}
            className={cn(
              "font-mono text-[9px] font-bold tracking-[2px] px-4 py-2 rounded-full border transition-all uppercase whitespace-nowrap",
              activeTab === 'aura' 
                ? "bg-gradient-to-br from-cyan-glow/20 to-purple-glow/15 border-cyan-glow text-text-main shadow-[0_0_14px_rgba(0,212,255,0.2)]" 
                : "border-border-b2 bg-cyan-glow/5 text-text-dim hover:border-cyan-glow hover:text-cyan-glow"
            )}
          >
            ⬡ AURA STUDIO
          </button>
          <button 
            type="button"
            onClick={() => onTabChange('playground')}
            className={cn(
              "font-mono text-[9px] font-bold tracking-[2px] px-4 py-2 rounded-full border transition-all uppercase whitespace-nowrap",
              activeTab === 'playground' 
                ? "bg-gradient-to-br from-cyan-glow/20 to-purple-glow/15 border-cyan-glow text-text-main shadow-[0_0_14px_rgba(0,212,255,0.2)]" 
                : "border-border-b2 bg-cyan-glow/5 text-text-dim hover:border-cyan-glow hover:text-cyan-glow"
            )}
          >
            ✦ SVG PLAYGROUND
          </button>
        </nav>

        <div className="hs hidden lg:flex items-center gap-2 font-mono text-[9px] text-text-dim tracking-wider">
          <div className="dot w-2 h-2 rounded-full bg-green-glow shadow-[0_0_10px_var(--color-green-glow),0_0_20px_rgba(0,255,157,0.3)] animate-[pulse-dot_2s_infinite]" />
          ENGINE READY
        </div>

        <span className="px-3.5 py-1.5 rounded-full text-[10px] font-bold font-mono bg-green-glow/10 text-green-glow border border-green-glow/25 shadow-[0_0_15px_rgba(0,255,157,0.08)] tracking-wider">
          UNLIMITED ACCESS
        </span>
      </div>
    </header>
  );
}
