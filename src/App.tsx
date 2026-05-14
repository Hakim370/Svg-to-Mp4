/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { Header } from './components/Header';
import { Ticker } from './components/Ticker';
import { VectraTool } from './components/VectraTool';
import { GiftraTool } from './components/GiftraTool';
import { BatchTool } from './components/BatchTool';
import { Playground } from './components/Playground';
import { AdminDashboard } from './components/AdminDashboard';
import { Toaster, toast } from 'react-hot-toast';
import { auth, db, loginWithGoogle } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export type Tab = 'aura' | 'playground' | 'gif' | 'batch' | 'admin';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('aura');
  const [playgroundSVG, setPlaygroundSVG] = useState<string | null>(null);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('aura_welcomed'));

  const closeWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem('aura_welcomed', 'true');
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u); // Set user immediately
      setLoading(false); // Stop loading immediately

      if (u) {
        try {
          // Sync user to Firestore in the background
          const userRef = doc(db, 'users', u.uid);
          const userSnap = await getDoc(userRef);
          const isMaster = u.email === 'hakimmia370@gmail.com';
          
          if (!userSnap.exists()) {
            const newUser = {
              uid: u.uid,
              email: u.email,
              displayName: u.displayName,
              photoURL: u.photoURL,
              role: isMaster ? 'admin' : 'user',
              createdAt: serverTimestamp(),
              lastLogin: serverTimestamp(),
              exportCount: 0,
              exportLimit: isMaster ? 999999 : 2000,
              isBlocked: false
            };
            await setDoc(userRef, newUser);
            
            if (isMaster) {
              await setDoc(doc(db, 'admins', u.uid), {
                email: u.email,
                createdAt: serverTimestamp()
              });
            }
          } else {
            const data = userSnap.data();
            // Force upgrade master user limits if they are legacy or manually edited down
            if (isMaster && (data.exportLimit || 0) < 999999) {
              await setDoc(userRef, { 
                exportLimit: 999999,
                role: 'admin'
              }, { merge: true });
            }

            await setDoc(userRef, {
              lastLogin: serverTimestamp()
            }, { merge: true });
          }
        } catch (err: any) {
          console.error("Firestore sync error:", err);
          // Don't log out the user, just notify
          toast.error("Cloud data sync failed. Some features might be restricted.");
        }
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
      toast.success('Session Initiated');
    } catch (err: any) {
      console.error("Login attempt failed:", err);
      toast.error(err.message || 'Login failed');
      
      if (err.message.includes('authorized domains')) {
        toast('Diagnostic: Add ' + window.location.hostname + ' to Firebase Auth settings.', {
          icon: '🛡️',
          duration: 6000
        });
      }
    }
  };

  const handleSendToAura = useCallback((svg: string) => {
    setPlaygroundSVG(svg);
    setActiveTab('aura');
    toast.success('SVG loaded into AURA!');
  }, []);

  return (
    <div className="app flex flex-col min-h-screen relative z-10 selection:bg-cyan-glow selection:text-black">
      <div className="bg-grid fixed inset-0 pointer-events-none z-[-1]" />
      
      {/* Background Orbs */}
      <div className="orbs fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
        <div className="orb w-[900px] h-[900px] bg-[radial-gradient(circle_at_40%_40%,rgba(0,150,255,0.12),transparent_70%)] -top-[400px] -left-[300px] animate-[da_22s_ease-in-out_infinite]" />
        <div className="orb w-[700px] h-[700px] bg-[radial-gradient(circle_at_60%_60%,rgba(155,77,255,0.1),transparent_70%)] -bottom-[300px] -right-[200px] animate-[db_18s_ease-in-out_infinite]" />
        <div className="orb w-[500px] h-[500px] bg-[radial-gradient(circle_at_50%_50%,rgba(0,255,157,0.07),transparent_70%)] top-[45%] left-[55%] animate-[dc_14s_ease-in-out_infinite]" />
        <div className="orb w-[300px] h-[300px] bg-[radial-gradient(circle_at_50%_50%,rgba(255,61,127,0.08),transparent_70%)] top-[20%] right-[15%] animate-[dd_10s_ease-in-out_infinite]" />
      </div>

      <Ticker />

      {showWelcome && (
        <div className="welcome-banner px-4 md:px-9 py-6 bg-gradient-to-r from-cyan-glow/10 via-purple-glow/5 to-transparent border-b border-border-b1 animate-in fade-in slide-in-from-top-4 duration-700 relative overflow-hidden group">
          <div className="absolute inset-0 bg-grid opacity-20" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex-1 max-w-2xl">
              <h1 className="text-xl md:text-2xl font-black text-white mb-2 tracking-tighter uppercase tracking-[2px]">Aura Studio — Professional SVG to MP4 & GIF</h1>
              <p className="text-xs text-text-dim leading-relaxed font-mono uppercase tracking-wider opacity-80">
                The most powerful web-based SVG engine for generating professional video and high-quality GIFs. 
                <span className="hidden sm:inline"> Simply upload an SVG, adjust your render settings, and export for Adobe Stock or Social Media.</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => {
                  setPlaygroundSVG(`<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:%2300D4FF;stop-opacity:1" /><stop offset="100%" style="stop-color:%239B4DFF;stop-opacity:1" /></linearGradient></defs><rect width="100%" height="100%" fill="%23050505"/><circle cx="960" cy="540" r="300" stroke="url(%23g)" stroke-width="20" fill="none"><animate attributeName="r" values="300;450;300" dur="4s" repeatCount="indefinite" /></circle><text x="50%" y="54%" font-family="monospace" font-weight="900" font-size="60" fill="white" text-anchor="middle" letter-spacing="20">AURA ENGINE</text></svg>`);
                  setActiveTab('aura');
                  closeWelcome();
                }}
                className="px-6 py-2.5 bg-cyan-glow text-black font-black text-[10px] rounded-xl hover:bg-white transition-all uppercase tracking-widest shadow-[0_4px_25px_rgba(0,212,255,0.3)]"
              >
                Try Demo
              </button>
              <button 
                onClick={closeWelcome}
                className="px-6 py-2.5 bg-white/5 border border-border-b2 text-text-dim hover:text-white hover:border-white transition-all rounded-xl font-mono text-[10px] uppercase tracking-widest"
              >
                Got it
              </button>
            </div>
          </div>
          <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-glow/5 rounded-full blur-[100px] -mr-32 -mt-32" />
        </div>
      )}

      <Header activeTab={activeTab} onTabChange={setActiveTab} user={user} />

      <main className="flex-1 flex flex-col">
        {activeTab === 'aura' && (
          <VectraTool initialSVG={playgroundSVG} clearInitialSVG={() => setPlaygroundSVG(null)} />
        )}
        {activeTab === 'playground' && (
          <Playground onSendToAura={handleSendToAura} />
        )}
        {activeTab === 'gif' && (
          <GiftraTool initialSVG={playgroundSVG} clearInitialSVG={() => setPlaygroundSVG(null)} />
        )}
        {activeTab === 'batch' && (
          <BatchTool />
        )}
        {activeTab === 'admin' && (
          !user ? (
            <div className="flex-1 flex flex-col items-center justify-center p-4">
              <div className="max-w-md w-full bg-s1/40 border border-border-b1 backdrop-blur-xl rounded-[32px] p-8 md:p-12 text-center relative overflow-hidden group shadow-[0_0_80px_rgba(0,212,255,0.08)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,212,255,0.1),transparent_70%)]" />
                
                <div className="relative z-10">
                  <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-cyan-glow to-purple-glow rounded-3xl flex items-center justify-center font-black text-4xl text-white shadow-[0_0_50px_rgba(0,212,255,0.4)]">
                    A
                  </div>
                  
                  <h1 className="text-2xl font-black text-white mb-2 tracking-tighter uppercase tracking-[3px]">Admin Clearance</h1>
                  <p className="font-mono text-[10px] text-text-dim mb-8 leading-relaxed uppercase tracking-widest">
                    Secure Dashboard for System Administration
                  </p>

                  <button 
                    onClick={handleLogin}
                    className="w-full py-4 bg-gradient-to-r from-cyan-glow to-purple-glow rounded-2xl text-white font-bold text-xs tracking-[4px] uppercase shadow-[0_10px_30px_rgba(0,212,255,0.3)] hover:-translate-y-1 hover:shadow-[0_15px_45px_rgba(0,212,255,0.45)] transition-all flex items-center justify-center gap-3 active:scale-95"
                  >
                    IDENTIFY & LOGIN
                  </button>
                  
                  {/* Common Fix for new domains */}
                  <div className="mt-10 pt-6 border-t border-white/5 text-left">
                    <div className="flex items-center gap-2 text-cyan-glow font-bold text-[9px] mb-3 uppercase tracking-widest">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-glow animate-pulse" />
                      Domain Config Helper
                    </div>
                    <p className="text-[9px] text-text-dim leading-relaxed mb-3">
                      If you see an "unauthorized domain" error, add this host to your Firebase Auth settings:
                    </p>
                    <div className="bg-black/60 p-3 rounded-xl border border-white/10 font-mono text-[9px] text-cyan-glow break-all flex justify-between items-center group">
                      {window.location.hostname}
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(window.location.hostname);
                          toast.success('Domain copied');
                        }}
                        className="p-1 px-2 bg-white/5 hover:bg-white/10 rounded transition-all text-[8px]"
                      >
                        COPY
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <AdminDashboard />
          )
        )}
      </main>

      <div className="help-bar bg-[linear-gradient(90deg,rgba(0,212,255,0.08),rgba(155,77,255,0.06),rgba(255,61,127,0.06))] border-t border-border-b1 px-4 md:px-9 py-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="help-text font-mono text-[9px] text-text-dim flex items-center gap-2">
           Need help or see any error? <span className="text-cyan-glow font-bold">Contact us</span> <span className="font-sans text-text-dim">+880 1761 709821</span>
        </div>
        <a 
          href="https://wa.me/8801761709821" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="help-wa flex items-center gap-2 px-4 py-1.5 bg-[#25D366]/10 border border-[#25D366]/20 rounded-full text-[#25D366] font-mono text-[9px] font-bold tracking-wider hover:bg-[#25D366]/20 transition-all animate-[wa-pulse_3s_infinite]"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          GET SUPPORT
        </a>
      </div>

      <footer className="footer-dev text-center py-6 px-5 font-mono text-[10px] text-text-dim border-t border-border-b1 bg-bg/95 backdrop-blur-sm tracking-wider">
        Developed with ❤️ by <b className="text-cyan-glow tracking-[2px]">Hakim Ullah</b> (@hakimullah0370)
      </footer>

      <Toaster 
        position="bottom-right"
        toastOptions={{
          className: 'bg-s1/80 border border-border-b1 text-text-main backdrop-blur-md font-mono text-[10px]',
          style: {
            borderRadius: '12px',
          }
        }} 
      />
    </div>
  );
}
