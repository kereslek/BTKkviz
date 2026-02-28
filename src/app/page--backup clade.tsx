// src/app/page.tsx
'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import confetti from 'canvas-confetti';
import html2canvas from 'html2canvas';

type Question = {
  criminal: any;
  options: string[];
  correctCrime: string;
  questionNumber: number;
  selectedAnswer?: string | null;
};

type ChatMessage = {
  id: string;
  nickname: string;
  message: string;
  created_at: string;
};

type ScoreEntry = {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  time_taken: number | null;
  created_at: string;
};

const generateUUID = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const cleanCrime = (crime: string) => crime.split(' - ')[0].trim();

export default function Home() {
  const [criminals, setCriminals] = useState<any[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [nickname, setNickname] = useState('Névtelen Játékos');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [usedCriminalIds, setUsedCriminalIds] = useState<Set<string>>(new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatNickname, setChatNickname] = useState('Névtelen');
  const [chatError, setChatError] = useState<string | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [totalGamesPlayed, setTotalGamesPlayed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [introVisible, setIntroVisible] = useState(true);
  const [scanline, setScanline] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resultShareRef = useRef<HTMLDivElement>(null);

  const current = questions[currentIndex];
  const isLatest = currentIndex === questions.length - 1;
  const timeTaken = endTime ? Math.round((endTime - startTime) / 1000) : null;

  // Scanline animation effect
  useEffect(() => {
    const interval = setInterval(() => {
      setScanline((prev) => (prev + 1) % 100);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setChatOpen(window.innerWidth >= 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const channel = supabase.channel('online-players');
    channel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        setOnlinePlayers(Object.keys(presenceState).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online: true, userId: generateUUID() });
        }
      });
    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const sub = supabase
      .channel('chat_messages_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const msg = payload.new as ChatMessage;
        setChatMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  useEffect(() => {
    const fetchTotal = async () => {
      const { count, error } = await supabase.from('high_scores').select('*', { count: 'exact', head: true });
      if (!error) setTotalGamesPlayed(count || 0);
    };
    fetchTotal();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chatNickname');
      if (saved) setChatNickname(saved);
    }
    fetchCriminals();
  }, []);

  const fetchCriminals = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('criminals_cache')
      .select('*')
      .not('police_id', 'is', null)
      .order('fetched_at', { ascending: false });
    if (!error) setCriminals(data || []);
    setLoading(false);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !chatNickname.trim()) return;
    const optimisticMsg: ChatMessage = {
      id: generateUUID(),
      nickname: chatNickname.trim(),
      message: chatInput.trim().slice(0, 200),
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, optimisticMsg]);
    setChatInput('');
    const { error } = await supabase.from('chat_messages').insert({
      nickname: chatNickname.trim(),
      message: optimisticMsg.message,
    });
    if (error) {
      setChatError('Küldési hiba: ' + error.message);
      setChatMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    }
  };

  const runScraper = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/scrape');
      if (response.ok) await fetchCriminals();
    } catch (e) {
      console.error('Scraper error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (criminals.length >= 4 && currentIndex === -1 && !loading && !gameOver) {
      // Auto-start is deferred until user clicks START
    }
  }, [criminals, loading]);

  const startGame = useCallback(() => {
    setQuestions([]);
    setCurrentIndex(-1);
    setScore(0);
    setStreak(0);
    setGameOver(false);
    setSaveStatus('idle');
    setStartTime(Date.now());
    setEndTime(null);
    setUsedCriminalIds(new Set());
    setShareImageUrl(null);
    setIntroVisible(false);
    // Load first question after reset
    setTimeout(() => loadNextQuestion([], new Set(), criminals), 50);
  }, [criminals]);

  const loadNextQuestion = useCallback(
    (
      currentQuestions: Question[],
      currentUsed: Set<string>,
      criminalList: any[]
    ) => {
      setShowFeedback(false);
      if (currentQuestions.length >= 10) {
        setEndTime(Date.now());
        setGameOver(true);
        fetchLeaderboard();
        return;
      }
      if (criminalList.length < 4) return;

      let available = criminalList.filter((c) => c.police_id && !currentUsed.has(c.id));
      if (available.length === 0) {
        available = criminalList.filter((c) => c.police_id);
      }

      const randomIndex = Math.floor(Math.random() * available.length);
      const correct = available[randomIndex];
      const newUsed = new Set([...currentUsed, correct.id]);
      setUsedCriminalIds(newUsed);

      const wrongPool = criminalList
        .filter((c) => c.id !== correct.id && c.crime !== correct.crime && c.police_id)
        .sort(() => 0.5 - Math.random());

      const wrongCrimes: string[] = [];
      for (const c of wrongPool) {
        if (wrongCrimes.length >= 3) break;
        wrongCrimes.push(c.crime);
      }
      while (wrongCrimes.length < 3) {
        wrongCrimes.push('Ismeretlen bűncselekmény');
      }

      const allOptions = [correct.crime, ...wrongCrimes].sort(() => 0.5 - Math.random());
      const newQuestion: Question = {
        criminal: correct,
        options: allOptions,
        correctCrime: correct.crime,
        questionNumber: currentQuestions.length + 1,
        selectedAnswer: null,
      };

      setQuestions((prev) => {
        const updated = [...prev, newQuestion];
        setCurrentIndex(updated.length - 1);
        return updated;
      });
    },
    []
  );

  const handleAnswer = (answer: string) => {
    if (!isLatest || current.selectedAnswer != null) return;
    const isCorrect = answer === current.correctCrime;

    setQuestions((prev) => {
      const updated = [...prev];
      updated[currentIndex] = { ...updated[currentIndex], selectedAnswer: answer };
      return updated;
    });

    if (isCorrect) {
      setScore((prev) => prev + 10);
      setStreak((prev) => prev + 1);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: ['#ef4444', '#f97316', '#fbbf24'] });
    } else {
      setStreak(0);
      setShowFeedback(true);
    }

    setTimeout(() => {
      setShowFeedback(false);
      setQuestions((prev) => {
        const newQs = prev;
        if (newQs.length >= 10) {
          setEndTime(Date.now());
          setGameOver(true);
          fetchLeaderboard();
        } else {
          loadNextQuestion(newQs, usedCriminalIds, criminals);
        }
        return newQs;
      });
    }, 1800);
  };

  const saveScore = async () => {
    if (saveStatus === 'saving' || saveStatus === 'success') return;
    setSaveStatus('saving');
    const { error } = await supabase.from('high_scores').insert({
      nickname: nickname.trim() || 'Névtelen',
      score,
      streak,
      time_taken: timeTaken,
    });
    if (error) {
      setSaveStatus('error');
    } else {
      setSaveStatus('success');
      setTotalGamesPlayed((p) => p + 1);
      fetchLeaderboard();
    }
  };

  const fetchLeaderboard = async () => {
    const { data, error } = await supabase
      .from('high_scores')
      .select('id, nickname, score, streak, time_taken, created_at')
      .order('score', { ascending: false })
      .limit(10);
    if (!error && data) setLeaderboard(data as ScoreEntry[]);
  };

  const generateResultShare = async () => {
    if (!resultShareRef.current) return;
    try {
      const canvas = await html2canvas(resultShareRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#0a0a0a',
      });
      const imageUrl = canvas.toDataURL('image/png');
      setShareImageUrl(imageUrl);
      const link = document.createElement('a');
      link.download = 'btk-kviz-eredmeny.png';
      link.href = imageUrl;
      link.click();
    } catch {
      alert('Kép generálása sikertelen.');
    }
  };

  // Percentage for progress bar
  const progress = questions.length > 0 ? (questions.length / 10) * 100 : 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&family=Source+Code+Pro:wght@400;600&family=Bebas+Neue&display=swap');

        :root {
          --red: #dc2626;
          --red-dim: #7f1d1d;
          --amber: #d97706;
          --paper: #f5f0e8;
          --ink: #1a1a1a;
          --bg: #0d0d0d;
          --surface: #141414;
          --surface2: #1e1e1e;
          --border: #2a2a2a;
          --text: #e8e2d6;
          --text-muted: #6b6560;
          --green: #16a34a;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'Source Code Pro', monospace;
          min-height: 100vh;
          overflow-x: hidden;
        }

        .noise-overlay {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 9999;
          opacity: 0.03;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        .scanline {
          position: fixed;
          left: 0; right: 0;
          height: 2px;
          background: rgba(220, 38, 38, 0.15);
          pointer-events: none;
          z-index: 9998;
          transition: top 0.05s linear;
        }

        .app-layout {
          display: grid;
          grid-template-columns: 1fr;
          min-height: 100vh;
        }

        @media (min-width: 1024px) {
          .app-layout {
            grid-template-columns: 1fr 320px;
          }
        }

        /* HEADER */
        .header {
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          padding: 12px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 100;
          grid-column: 1 / -1;
        }

        .logo {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px;
          letter-spacing: 4px;
          color: var(--red);
          text-shadow: 0 0 20px rgba(220,38,38,0.4);
        }

        .logo span { color: var(--text); }

        .header-stats {
          display: flex;
          gap: 20px;
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .stat-dot {
          display: inline-block;
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--green);
          margin-right: 6px;
          animation: pulse-dot 2s ease-in-out infinite;
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }

        /* DISCLAIMER TAPE */
        .tape-banner {
          background: var(--amber);
          color: #000;
          font-family: 'Oswald', sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 2px;
          text-transform: uppercase;
          padding: 6px 0;
          text-align: center;
          grid-column: 1 / -1;
          overflow: hidden;
          white-space: nowrap;
        }

        .tape-scroll {
          display: inline-block;
          animation: tape-scroll 30s linear infinite;
        }

        @keyframes tape-scroll {
          0% { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }

        /* MAIN CONTENT */
        .main-content {
          padding: 24px;
          max-width: 720px;
          margin: 0 auto;
          width: 100%;
        }

        /* SCORE BAR */
        .score-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          padding: 14px 20px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-left: 3px solid var(--red);
        }

        .score-val {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 32px;
          color: var(--red);
          line-height: 1;
        }

        .score-label {
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .streak-badge {
          background: linear-gradient(135deg, var(--red), #7c0000);
          color: #fff;
          font-family: 'Oswald', sans-serif;
          font-size: 20px;
          padding: 8px 16px;
          letter-spacing: 2px;
          clip-path: polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%);
        }

        /* PROGRESS */
        .progress-wrap {
          margin-bottom: 24px;
        }

        .progress-track {
          height: 3px;
          background: var(--border);
          position: relative;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--red-dim), var(--red));
          transition: width 0.5s ease;
          position: relative;
        }

        .progress-fill::after {
          content: '';
          position: absolute;
          right: 0;
          top: -1px;
          width: 4px;
          height: 5px;
          background: #fff;
          box-shadow: 0 0 8px var(--red);
        }

        .progress-labels {
          display: flex;
          justify-content: space-between;
          margin-top: 6px;
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        /* QUESTION NAVIGATION */
        .q-nav {
          display: flex;
          gap: 4px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .q-pip {
          width: 28px;
          height: 28px;
          border: 1px solid var(--border);
          background: var(--surface);
          font-size: 10px;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Source Code Pro', monospace;
          transition: all 0.15s;
        }

        .q-pip.answered-correct { background: #14532d; border-color: #16a34a; color: #4ade80; }
        .q-pip.answered-wrong { background: #450a0a; border-color: var(--red); color: #f87171; }
        .q-pip.current { border-color: var(--amber); color: var(--amber); }

        /* CRIMINAL CARD */
        .criminal-card {
          background: var(--surface);
          border: 1px solid var(--border);
          margin-bottom: 20px;
          position: relative;
          overflow: hidden;
        }

        .criminal-card::before {
          content: 'KÖRÖZÉSI ADATlap';
          position: absolute;
          top: 12px;
          right: 12px;
          font-size: 9px;
          color: var(--text-muted);
          letter-spacing: 2px;
          font-family: 'Oswald', sans-serif;
        }

        .criminal-card-inner {
          display: flex;
          gap: 0;
        }

        .photo-wrapper {
          width: 180px;
          min-width: 180px;
          height: 220px;
          background: #111;
          position: relative;
          flex-shrink: 0;
          overflow: hidden;
        }

        @media (max-width: 480px) {
          .photo-wrapper {
            width: 120px;
            min-width: 120px;
            height: 160px;
          }
        }

        .photo-wrapper img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: sepia(20%) contrast(1.05);
        }

        .photo-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          font-size: 11px;
          letter-spacing: 1px;
          text-transform: uppercase;
          gap: 12px;
        }

        .photo-placeholder svg {
          width: 48px;
          height: 48px;
          opacity: 0.3;
        }

        .photo-grid {
          position: absolute;
          inset: 0;
          background-image: repeating-linear-gradient(
            0deg, transparent, transparent 19px, rgba(255,255,255,0.03) 20px
          ), repeating-linear-gradient(
            90deg, transparent, transparent 19px, rgba(255,255,255,0.03) 20px
          );
          pointer-events: none;
        }

        .criminal-info {
          padding: 20px;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .criminal-name {
          font-family: 'Oswald', sans-serif;
          font-size: 22px;
          font-weight: 600;
          color: var(--text);
          letter-spacing: 1px;
          line-height: 1.2;
          margin-bottom: 8px;
        }

        .field-row {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-bottom: 12px;
        }

        .field-label {
          font-size: 9px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 2px;
        }

        .field-val {
          font-size: 12px;
          color: var(--text);
        }

        .question-prompt {
          font-family: 'Oswald', sans-serif;
          font-size: 15px;
          color: var(--amber);
          text-transform: uppercase;
          letter-spacing: 2px;
          border-top: 1px solid var(--border);
          padding-top: 12px;
          margin-top: auto;
        }

        /* OPTIONS */
        .options-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 20px;
        }

        @media (max-width: 480px) {
          .options-grid {
            grid-template-columns: 1fr;
          }
        }

        .option-btn {
          padding: 16px;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Source Code Pro', monospace;
          font-size: 12px;
          text-align: left;
          cursor: pointer;
          transition: all 0.15s;
          position: relative;
          overflow: hidden;
          line-height: 1.4;
        }

        .option-btn::before {
          content: '';
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 3px;
          background: transparent;
          transition: background 0.15s;
        }

        .option-btn:hover:not(:disabled) {
          background: var(--surface2);
          border-color: #3d3d3d;
        }

        .option-btn:hover:not(:disabled)::before {
          background: var(--red);
        }

        .option-btn.correct {
          background: #052e16;
          border-color: var(--green);
          color: #4ade80;
        }

        .option-btn.correct::before { background: var(--green); }

        .option-btn.wrong {
          background: #450a0a;
          border-color: var(--red);
          color: #f87171;
        }

        .option-btn.wrong::before { background: var(--red); }

        .option-btn.reveal {
          border-color: var(--green);
          animation: pulse-green 1s ease-in-out infinite;
        }

        @keyframes pulse-green {
          0%, 100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.3); }
          50% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
        }

        .option-btn:disabled { cursor: not-allowed; opacity: 0.5; }

        .option-letter {
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 4px;
          display: block;
        }

        /* NAVIGATION ARROWS */
        .nav-arrows {
          display: flex;
          gap: 8px;
          margin-bottom: 20px;
        }

        .nav-btn {
          flex: 1;
          padding: 10px;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text-muted);
          font-family: 'Source Code Pro', monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .nav-btn:hover:not(:disabled) { border-color: #444; color: var(--text); }
        .nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .new-game-btn {
          width: 100%;
          padding: 16px;
          background: transparent;
          border: 1px solid var(--red);
          color: var(--red);
          font-family: 'Oswald', sans-serif;
          font-size: 16px;
          letter-spacing: 4px;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s;
          margin-bottom: 20px;
        }

        .new-game-btn:hover {
          background: var(--red);
          color: #fff;
          box-shadow: 0 0 30px rgba(220, 38, 38, 0.3);
        }

        /* INTRO / LOADING */
        .center-screen {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 60vh;
          gap: 32px;
          text-align: center;
        }

        .wanted-poster {
          background: var(--paper);
          color: var(--ink);
          padding: 32px 40px;
          max-width: 380px;
          width: 100%;
          position: relative;
          box-shadow: 8px 8px 0 rgba(0,0,0,0.5);
          transform: rotate(-0.5deg);
        }

        .wanted-poster::before {
          content: '';
          position: absolute;
          inset: 6px;
          border: 2px solid var(--ink);
          pointer-events: none;
        }

        .wanted-header {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 52px;
          letter-spacing: 6px;
          color: var(--ink);
          border-bottom: 3px solid var(--ink);
          padding-bottom: 8px;
          margin-bottom: 8px;
          line-height: 1;
        }

        .wanted-sub {
          font-family: 'Oswald', sans-serif;
          font-size: 13px;
          letter-spacing: 3px;
          color: #555;
          text-transform: uppercase;
          margin-bottom: 24px;
        }

        .wanted-body {
          font-size: 13px;
          color: #333;
          line-height: 1.7;
          margin-bottom: 24px;
        }

        .start-btn {
          width: 100%;
          padding: 16px;
          background: var(--ink);
          color: var(--paper);
          border: none;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px;
          letter-spacing: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .start-btn:hover {
          background: var(--red);
        }

        .loading-text {
          font-family: 'Oswald', sans-serif;
          font-size: 20px;
          color: var(--text-muted);
          letter-spacing: 4px;
          text-transform: uppercase;
          animation: blink 1.2s ease-in-out infinite;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        /* GAME OVER */
        .game-over-card {
          background: var(--surface);
          border: 1px solid var(--border);
          padding: 28px;
          margin-bottom: 20px;
        }

        .game-over-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 48px;
          letter-spacing: 4px;
          color: var(--red);
          text-shadow: 0 0 30px rgba(220,38,38,0.4);
          margin-bottom: 8px;
        }

        .score-final {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 64px;
          color: var(--text);
          line-height: 1;
          margin-bottom: 16px;
        }

        .score-final span {
          font-size: 24px;
          color: var(--text-muted);
          font-family: 'Oswald', sans-serif;
          letter-spacing: 2px;
        }

        .nickname-input {
          width: 100%;
          padding: 14px 16px;
          background: #0a0a0a;
          border: 1px solid var(--border);
          border-left: 3px solid var(--red);
          color: var(--text);
          font-family: 'Oswald', sans-serif;
          font-size: 18px;
          letter-spacing: 1px;
          margin-bottom: 12px;
          outline: none;
          transition: border-color 0.15s;
        }

        .nickname-input:focus { border-color: var(--amber); }

        .save-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, var(--red), #7c0000);
          border: none;
          color: #fff;
          font-family: 'Oswald', sans-serif;
          font-size: 18px;
          letter-spacing: 3px;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s;
          margin-bottom: 16px;
        }

        .save-btn:hover { opacity: 0.85; }
        .save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .share-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }

        .share-btn {
          flex: 1;
          min-width: 120px;
          padding: 10px 14px;
          background: var(--surface2);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Source Code Pro', monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .share-btn:hover { border-color: #555; background: #252525; }

        /* LEADERBOARD */
        .leaderboard {
          background: var(--surface);
          border: 1px solid var(--border);
          padding: 20px;
          margin-bottom: 20px;
        }

        .lb-title {
          font-family: 'Oswald', sans-serif;
          font-size: 14px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 16px;
          border-bottom: 1px solid var(--border);
          padding-bottom: 10px;
        }

        .lb-row {
          display: flex;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid #1a1a1a;
          gap: 12px;
        }

        .lb-rank {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 20px;
          color: var(--text-muted);
          width: 28px;
          text-align: center;
          flex-shrink: 0;
        }

        .lb-rank.gold { color: #fbbf24; }
        .lb-rank.silver { color: #9ca3af; }
        .lb-rank.bronze { color: #92400e; }

        .lb-name {
          flex: 1;
          font-family: 'Oswald', sans-serif;
          font-size: 15px;
          color: var(--text);
        }

        .lb-score {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px;
          color: var(--red);
        }

        .lb-meta {
          font-size: 10px;
          color: var(--text-muted);
          text-align: right;
        }

        /* CHAT SIDEBAR */
        .chat-sidebar {
          background: var(--surface);
          border-left: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          height: 100vh;
          position: sticky;
          top: 0;
        }

        .chat-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .chat-title {
          font-family: 'Oswald', sans-serif;
          font-size: 14px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .chat-close-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
        }

        .chat-close-btn:hover { color: var(--text); }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          scrollbar-width: thin;
          scrollbar-color: var(--border) transparent;
        }

        .chat-msg {
          background: var(--surface2);
          border: 1px solid var(--border);
          padding: 10px 12px;
          border-left: 2px solid var(--red-dim);
        }

        .chat-msg-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 4px;
        }

        .chat-nick {
          font-family: 'Oswald', sans-serif;
          font-size: 12px;
          color: var(--amber);
          letter-spacing: 1px;
        }

        .chat-time {
          font-size: 10px;
          color: var(--text-muted);
        }

        .chat-text {
          font-size: 12px;
          color: var(--text);
          line-height: 1.5;
          word-break: break-word;
        }

        .chat-empty {
          text-align: center;
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 2px;
          padding: 20px 0;
        }

        .chat-input-area {
          padding: 16px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .chat-nick-input, .chat-msg-input {
          background: #0a0a0a;
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Source Code Pro', monospace;
          font-size: 12px;
          padding: 10px 12px;
          outline: none;
          width: 100%;
          transition: border-color 0.15s;
        }

        .chat-nick-input:focus, .chat-msg-input:focus { border-color: var(--red); }

        .chat-send-row {
          display: flex;
          gap: 8px;
        }

        .chat-send-btn {
          background: var(--red);
          border: none;
          color: #fff;
          font-family: 'Oswald', sans-serif;
          font-size: 13px;
          letter-spacing: 2px;
          text-transform: uppercase;
          padding: 10px 16px;
          cursor: pointer;
          transition: opacity 0.15s;
          flex-shrink: 0;
        }

        .chat-send-btn:hover { opacity: 0.85; }

        /* CHAT FAB */
        .chat-fab {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 52px;
          height: 52px;
          background: var(--red);
          border: none;
          color: #fff;
          cursor: pointer;
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 20px rgba(220,38,38,0.4);
          transition: transform 0.2s;
        }

        .chat-fab:hover { transform: scale(1.1); }

        /* MOBILE CHAT OVERLAY */
        .chat-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.8);
          z-index: 150;
          display: flex;
          align-items: stretch;
          justify-content: flex-end;
        }

        .chat-panel-mobile {
          background: var(--surface);
          width: min(360px, 100vw);
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        /* HIDDEN SHARE CARD */
        .share-card-hidden {
          position: fixed;
          left: -9999px;
          top: 0;
          width: 500px;
          background: #0a0a0a;
          padding: 32px;
          border: 2px solid var(--red);
        }

        .share-card-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 40px;
          color: var(--red);
          letter-spacing: 4px;
        }

        .share-card-score {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 72px;
          color: var(--text);
          line-height: 1;
        }

        .share-card-meta {
          font-size: 14px;
          color: var(--text-muted);
          margin-top: 8px;
          font-family: 'Oswald', sans-serif;
          letter-spacing: 2px;
        }

        .share-card-url {
          margin-top: 20px;
          font-family: 'Oswald', sans-serif;
          font-size: 16px;
          color: var(--amber);
          letter-spacing: 3px;
        }

        /* STATUS BANNER */
        .status-banner {
          padding: 10px 16px;
          border-left: 3px solid;
          font-size: 12px;
          margin-bottom: 12px;
        }

        .status-banner.success {
          border-color: var(--green);
          background: #052e16;
          color: #4ade80;
        }

        .status-banner.error {
          border-color: var(--red);
          background: #450a0a;
          color: #f87171;
        }

        /* FOOTER */
        .footer {
          padding: 16px 24px;
          border-top: 1px solid var(--border);
          font-size: 10px;
          color: var(--text-muted);
          text-align: center;
          letter-spacing: 1px;
          grid-column: 1 / -1;
          line-height: 1.8;
        }

        /* MOBILE LAYOUT */
        @media (max-width: 1023px) {
          .chat-sidebar { display: none; }
        }
      `}</style>

      <div className="noise-overlay" />
      <div className="scanline" style={{ top: `${scanline}%` }} />

      <div className="app-layout">
        {/* HEADER */}
        <header className="header">
          <div className="logo">BTK<span>kvíz</span></div>
          <div className="header-stats">
            <span><span className="stat-dot" />{onlinePlayers} online</span>
            <span>{totalGamesPlayed} játék</span>
          </div>
        </header>

        {/* TAPE BANNER */}
        <div className="tape-banner">
          <span className="tape-scroll">
            ⚠ Szórakoztató és oktatási célú kvízjáték — A hatóságok munkájának segítésére és közbiztonsági tudatosság növelése céljából
            &nbsp;&nbsp;&nbsp;&nbsp;◆&nbsp;&nbsp;&nbsp;&nbsp;
            ⚠ Szórakoztató és oktatási célú kvízjáték — A hatóságok munkájának segítésére és közbiztonsági tudatosság növelése céljából
            &nbsp;&nbsp;&nbsp;&nbsp;◆&nbsp;&nbsp;&nbsp;&nbsp;
          </span>
        </div>

        {/* MAIN */}
        <main className="main-content">

          {/* LOADING */}
          {loading && (
            <div className="center-screen">
              <div className="loading-text">Rendszer inicializálás...</div>
            </div>
          )}

          {/* NO DATA */}
          {!loading && criminals.length < 4 && (
            <div className="center-screen">
              <div className="wanted-poster">
                <div className="wanted-header">HIÁNYZÓ</div>
                <div className="wanted-sub">Adatbázis üres</div>
                <div className="wanted-body">
                  A körözési adatbázisban nincs elegendő bejegyzés a játék elindításához. Futtasd le a scrapert az adatok feltöltéséhez.
                </div>
                <button className="start-btn" onClick={runScraper} disabled={loading}>
                  SCRAPER INDÍTÁSA
                </button>
              </div>
            </div>
          )}

          {/* INTRO / READY */}
          {!loading && criminals.length >= 4 && introVisible && !gameOver && (
            <div className="center-screen">
              <div className="wanted-poster">
                <div className="wanted-header">KÖRÖZÖTT</div>
                <div className="wanted-sub">Magyar Rendőrség Körözési Adatbázis</div>
                <div className="wanted-body">
                  10 körözött személy fotóját mutatjuk meg. Neked kell kitalálni, milyen bűncselekményt követtek el. 4 lehetséges válasz közül választhatsz.
                  <br /><br />
                  <strong>Helyes válasz: +10 pont</strong>
                </div>
                <button className="start-btn" onClick={startGame}>
                  JÁTÉK INDÍTÁSA
                </button>
              </div>
            </div>
          )}

          {/* GAME */}
          {!loading && criminals.length >= 4 && !introVisible && !gameOver && current && (
            <>
              {/* SCORE BAR */}
              <div className="score-bar">
                <div>
                  <div className="score-val">{score}</div>
                  <div className="score-label">pont</div>
                </div>
                <div className="streak-badge">
                  {streak} 🔥 STREAK
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: 'var(--text)' }}>
                    {current.questionNumber}<span style={{ color: 'var(--text-muted)', fontSize: 16 }}>/10</span>
                  </div>
                  <div className="score-label">kérdés</div>
                </div>
              </div>

              {/* PROGRESS */}
              <div className="progress-wrap">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="progress-labels">
                  <span>Haladás</span>
                  <span>{Math.round(progress)}%</span>
                </div>
              </div>

              {/* Q NAVIGATION PIPS */}
              <div className="q-nav">
                {questions.map((q, idx) => {
                  let cls = 'q-pip';
                  if (idx === currentIndex) cls += ' current';
                  else if (q.selectedAnswer) {
                    cls += q.selectedAnswer === q.correctCrime ? ' answered-correct' : ' answered-wrong';
                  }
                  return (
                    <button key={idx} className={cls} onClick={() => setCurrentIndex(idx)}>
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              {/* CRIMINAL CARD */}
              <div className="criminal-card">
                <div className="criminal-card-inner">
                  <div className="photo-wrapper">
                    {current.criminal.photo_url ? (
                      <img
                        src={current.criminal.photo_url}
                        alt={current.criminal.name}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="photo-placeholder">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                        </svg>
                        <span>Nincs fotó</span>
                      </div>
                    )}
                    <div className="photo-grid" />
                  </div>
                  <div className="criminal-info">
                    <div>
                      <div className="criminal-name">{current.criminal.name || 'Ismeretlen'}</div>
                      <div className="field-row">
                        <span className="field-label">Azonosító</span>
                        <span className="field-val">#{current.criminal.police_id}</span>
                      </div>
                      <div className="field-row">
                        <span className="field-label">Forrás</span>
                        <span className="field-val" style={{ fontSize: 11 }}>Magyar Rendőrség Körözési Nyilvántartás</span>
                      </div>
                    </div>
                    <div className="question-prompt">
                      Mit követett el ez a személy?
                    </div>
                  </div>
                </div>
              </div>

              {/* OPTIONS */}
              <div className="options-grid">
                {current.options.map((opt, idx) => {
                  const labels = ['A', 'B', 'C', 'D'];
                  const isSelected = current.selectedAnswer === opt;
                  const isCorrectOpt = opt === current.correctCrime;
                  const isWrong = isSelected && !isCorrectOpt;
                  const isCorrectShown = (isSelected && isCorrectOpt) || (showFeedback && isCorrectOpt);

                  let cls = 'option-btn';
                  if (isCorrectShown) cls += ' correct';
                  else if (isWrong) cls += ' wrong';
                  else if (showFeedback && isCorrectOpt) cls += ' reveal';

                  return (
                    <button
                      key={idx}
                      className={cls}
                      onClick={() => isLatest && !current.selectedAnswer && handleAnswer(opt)}
                      disabled={!isLatest || current.selectedAnswer != null}
                    >
                      <span className="option-letter">{labels[idx]}</span>
                      {cleanCrime(opt)}
                    </button>
                  );
                })}
              </div>

              {/* NAVIGATION */}
              <div className="nav-arrows">
                <button className="nav-btn" onClick={() => setCurrentIndex((p) => p - 1)} disabled={currentIndex === 0}>
                  ← Vissza
                </button>
                <button className="nav-btn" onClick={() => setCurrentIndex((p) => p + 1)} disabled={currentIndex === questions.length - 1}>
                  Előre →
                </button>
              </div>

              <button className="new-game-btn" onClick={startGame}>
                ↺ ÚJ JÁTÉK
              </button>
            </>
          )}

          {/* GAME OVER */}
          {!loading && gameOver && (
            <>
              <div className="game-over-card">
                <div className="game-over-title">Eredmény</div>
                <div className="score-final">
                  {score} <span>PONT</span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24, fontFamily: "'Oswald', sans-serif", letterSpacing: 2 }}>
                  STREAK: {streak} 🔥 &nbsp;|&nbsp; IDŐ: {timeTaken ? `${timeTaken} mp` : '—'}
                </div>

                <input
                  className="nickname-input"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Neved a ranglistához..."
                  disabled={saveStatus === 'saving' || saveStatus === 'success'}
                />

                {saveStatus === 'success' && (
                  <div className="status-banner success">✓ Pontjaid mentve a ranglistára!</div>
                )}
                {saveStatus === 'error' && (
                  <div className="status-banner error">✗ Mentési hiba – próbáld újra!</div>
                )}

                <button
                  className="save-btn"
                  onClick={saveScore}
                  disabled={saveStatus === 'saving' || saveStatus === 'success'}
                >
                  {saveStatus === 'saving' ? 'Mentés...' : saveStatus === 'success' ? '✓ MENTVE' : 'MENTÉS A RANGLISTÁRA'}
                </button>

                <div className="share-row">
                  <button className="share-btn" onClick={generateResultShare}>⬇ Kép letöltés</button>
                  <button
                    className="share-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.origin);
                      alert('Link másolva!');
                    }}
                  >
                    🔗 Link másolás
                  </button>
                  <button
                    className="share-btn"
                    onClick={async () => {
                      if (navigator.share) {
                        try {
                          await navigator.share({
                            title: 'BTK kvíz eredményem!',
                            text: `${score} pontot értem el! (Streak: ${streak} 🔥, ${timeTaken} mp) Te tudod verni?`,
                            url: window.location.origin,
                          });
                        } catch {}
                      } else {
                        alert('Natív megosztás nem támogatott – használd a Link másolást!');
                      }
                    }}
                  >
                    ↗ Megosztás
                  </button>
                </div>
              </div>

              {/* LEADERBOARD */}
              <div className="leaderboard">
                <div className="lb-title">▶ Ranglista — Top 10</div>
                {leaderboard.length === 0 ? (
                  <div className="chat-empty">Még nincsenek mentett pontok</div>
                ) : (
                  leaderboard.map((entry, idx) => (
                    <div className="lb-row" key={entry.id}>
                      <div className={`lb-rank ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''}`}>
                        {idx + 1}
                      </div>
                      <div>
                        <div className="lb-name">{entry.nickname}</div>
                        <div className="lb-meta">Streak: {entry.streak} 🔥 | {entry.time_taken ? `${entry.time_taken} mp` : '?'}</div>
                      </div>
                      <div className="lb-score">{entry.score}</div>
                    </div>
                  ))
                )}
              </div>

              <button className="new-game-btn" onClick={() => { setIntroVisible(true); setGameOver(false); }}>
                ↺ ÚJ JÁTÉK
              </button>
            </>
          )}
        </main>

        {/* DESKTOP CHAT SIDEBAR */}
        <aside className="chat-sidebar" style={{ display: chatOpen ? undefined : 'none' }}>
          <div className="chat-header">
            <div className="chat-title">Élő chat</div>
            <button className="chat-close-btn" onClick={() => setChatOpen(false)}>×</button>
          </div>
          <div className="chat-messages">
            {chatMessages.length === 0 && <div className="chat-empty">Még nincsenek üzenetek...</div>}
            {chatMessages.map((msg) => (
              <div className="chat-msg" key={msg.id}>
                <div className="chat-msg-header">
                  <span className="chat-nick">{msg.nickname}</span>
                  <span className="chat-time">
                    {new Date(msg.created_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="chat-text">{msg.message}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input-area">
            {chatError && <div className="status-banner error" style={{ marginBottom: 8 }}>{chatError}</div>}
            <input
              className="chat-nick-input"
              value={chatNickname}
              onChange={(e) => setChatNickname(e.target.value.slice(0, 30))}
              placeholder="Beceneved..."
              onBlur={() => { if (typeof window !== 'undefined') localStorage.setItem('chatNickname', chatNickname); }}
            />
            <div className="chat-send-row">
              <input
                className="chat-msg-input"
                style={{ flex: 1 }}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                placeholder="Üzenet..."
              />
              <button className="chat-send-btn" onClick={sendChatMessage}>Küld</button>
            </div>
          </div>
        </aside>

        {/* FOOTER */}
        <footer className="footer">
          Ez kizárólag szórakoztató és oktatási célú kvízjáték, a hatóságok munkájának segítése és a közbiztonsági tudatosság növelése céljából.
          <br />Kérdés esetén: kereslek.wanted@proton.me
        </footer>
      </div>

      {/* MOBILE CHAT FAB */}
      {!chatOpen && (
        <button className="chat-fab" onClick={() => setChatOpen(true)} style={{ display: window && window.innerWidth >= 1024 ? 'none' : undefined }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
        </button>
      )}

      {/* MOBILE CHAT OVERLAY */}
      {chatOpen && typeof window !== 'undefined' && window.innerWidth < 1024 && (
        <div className="chat-overlay" onClick={(e) => { if (e.target === e.currentTarget) setChatOpen(false); }}>
          <div className="chat-panel-mobile">
            <div className="chat-header">
              <div className="chat-title">Élő chat</div>
              <button className="chat-close-btn" onClick={() => setChatOpen(false)}>×</button>
            </div>
            <div className="chat-messages">
              {chatMessages.length === 0 && <div className="chat-empty">Még nincsenek üzenetek...</div>}
              {chatMessages.map((msg) => (
                <div className="chat-msg" key={msg.id}>
                  <div className="chat-msg-header">
                    <span className="chat-nick">{msg.nickname}</span>
                    <span className="chat-time">
                      {new Date(msg.created_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="chat-text">{msg.message}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-area">
              {chatError && <div className="status-banner error" style={{ marginBottom: 8 }}>{chatError}</div>}
              <input
                className="chat-nick-input"
                value={chatNickname}
                onChange={(e) => setChatNickname(e.target.value.slice(0, 30))}
                placeholder="Beceneved..."
              />
              <div className="chat-send-row">
                <input
                  className="chat-msg-input"
                  style={{ flex: 1 }}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                  placeholder="Üzenet..."
                />
                <button className="chat-send-btn" onClick={sendChatMessage}>Küld</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HIDDEN SHARE CARD */}
      <div ref={resultShareRef} className="share-card-hidden">
        <div className="share-card-title">BTK KVÍZ</div>
        <div className="share-card-score">{score}</div>
        <div style={{ fontFamily: "'Oswald', sans-serif", color: 'var(--text)', fontSize: 18, letterSpacing: 2 }}>PONT</div>
        <div className="share-card-meta">STREAK: {streak} 🔥 | IDŐ: {timeTaken ? `${timeTaken} mp` : '?'}</div>
        <div className="share-card-url">btkkviz.hu</div>
      </div>
    </>
  );
}
