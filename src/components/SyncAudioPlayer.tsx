import { useState, useRef, useEffect, useCallback, useMemo, memo, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { Responsive as ResponsiveGridLayout, WidthProvider, type Layouts } from "react-grid-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Volume1,
  Rewind, FastForward, RotateCcw, Maximize2, Minimize2,
  AudioLines, Waves, Zap, Download, Link, Unlink,
  ShieldCheck, Mic, SlidersHorizontal, Sparkles, Brain,
  Wind, Radio, Filter, Settings2, ChevronDown, ChevronUp,
  Save, Trash2, AlertTriangle, Scissors,
  Gauge, Activity, Power, Search, BarChart3, X,
  Upload, Square, Circle, MicOff, Layers,
  GripVertical, LayoutGrid, RotateCw,
} from "lucide-react";
import {
  loadStudioLayouts,
  saveStudioLayouts,
  resetStudioLayouts,
  isStudioEditModeEnabled,
  setStudioEditModeEnabled,
} from "@/lib/studioLayout";

const ResponsiveReactGridLayout = WidthProvider(ResponsiveGridLayout);

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

// ─── Visual Knob Component ─────────────────────────────────────
const Knob = ({ value, min, max, onChange, label, className }: { value: number, min: number, max: number, onChange: (val: number) => void, label: string, className?: string }) => {
  const knobRef = useRef<HTMLDivElement>(null);
  
  const handleDrag = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    e.preventDefault();
    if (!knobRef.current) return;
    const rect = knobRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
    
    // Calculate angle from center to mouse
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90; // +90 to make 0 deg at top
    if (angle < 0) angle += 360;

    // We want the knob to go from ~225 deg (min) to ~135 deg (max), giving a 270 deg range
    // 0 deg is top.
    // Let's make physical angle range:
    // Left: -135 deg
    // Right: 135 deg
    let angleFromTop = angle <= 180 ? angle : angle - 360;
    
    // Clamp to -135 .. 135
    if (angleFromTop < -135) angleFromTop = -135;
    if (angleFromTop > 135) angleFromTop = 135;

    const percent = (angleFromTop + 135) / 270;
    let newVal = min + percent * (max - min);
    
    // Snap to 0.5 steps
    newVal = Math.round(newVal * 2) / 2;
    onChange(newVal);
  }, [min, max, onChange]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    
    const onMove = (moveEv: PointerEvent) => handleDrag(moveEv);
    const onUp = (upEv: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const percent = (value - min) / (max - min);
  const angle = -135 + percent * 270;

  return (
    <div className={`flex flex-col items-center gap-1 ${className || ''}`}>
      <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
      <div 
        ref={knobRef}
        className="relative w-8 h-8 rounded-full bg-accent border select-none cursor-ns-resize shadow-inner flex items-center justify-center"
        onPointerDown={handlePointerDown}
      >
        <div 
          className="absolute w-0.5 h-3.5 bg-primary rounded-full top-1 transition-transform"
          style={{ transform: `rotate(${angle}deg)`, transformOrigin: '50% 12px' }}
        />
      </div>
      <span className="text-[9px] font-mono">{value > 0 ? '+' : ''}{value}</span>
    </div>
  );
};


// ─── 31-Band EQ Definition (1/3 octave, ISO standard) ──────────
const EQ_BANDS_31 = [
  { freq: 20, label: '20', q: 4.3, color: 'text-rose-500' },
  { freq: 25, label: '25', q: 4.3, color: 'text-rose-500' },
  { freq: 31, label: '31', q: 4.3, color: 'text-rose-400' },
  { freq: 40, label: '40', q: 4.3, color: 'text-red-400' },
  { freq: 50, label: '50', q: 4.3, color: 'text-red-400' },
  { freq: 63, label: '63', q: 4.3, color: 'text-red-400' },
  { freq: 80, label: '80', q: 4.3, color: 'text-orange-400' },
  { freq: 100, label: '100', q: 4.3, color: 'text-orange-400' },
  { freq: 125, label: '125', q: 4.3, color: 'text-orange-400' },
  { freq: 160, label: '160', q: 4.3, color: 'text-amber-400' },
  { freq: 200, label: '200', q: 4.3, color: 'text-amber-400' },
  { freq: 250, label: '250', q: 4.3, color: 'text-amber-400' },
  { freq: 315, label: '315', q: 4.3, color: 'text-yellow-400' },
  { freq: 400, label: '400', q: 4.3, color: 'text-yellow-400' },
  { freq: 500, label: '500', q: 4.3, color: 'text-yellow-400' },
  { freq: 630, label: '630', q: 4.3, color: 'text-lime-400' },
  { freq: 800, label: '800', q: 4.3, color: 'text-lime-400' },
  { freq: 1000, label: '1k', q: 4.3, color: 'text-green-400' },
  { freq: 1250, label: '1.2k', q: 4.3, color: 'text-green-400' },
  { freq: 1600, label: '1.6k', q: 4.3, color: 'text-emerald-400' },
  { freq: 2000, label: '2k', q: 4.3, color: 'text-emerald-400' },
  { freq: 2500, label: '2.5k', q: 4.3, color: 'text-teal-400' },
  { freq: 3150, label: '3.1k', q: 4.3, color: 'text-teal-400' },
  { freq: 4000, label: '4k', q: 4.3, color: 'text-cyan-400' },
  { freq: 5000, label: '5k', q: 4.3, color: 'text-cyan-400' },
  { freq: 6300, label: '6.3k', q: 4.3, color: 'text-sky-400' },
  { freq: 8000, label: '8k', q: 4.3, color: 'text-blue-400' },
  { freq: 10000, label: '10k', q: 4.3, color: 'text-blue-400' },
  { freq: 12500, label: '12.5k', q: 4.3, color: 'text-indigo-400' },
  { freq: 16000, label: '16k', q: 4.3, color: 'text-violet-400' },
  { freq: 20000, label: '20k', q: 4.3, color: 'text-purple-400' },
] as const;

type EqBandCount = 10 | 31;
const EQ_BANDS_10_INDICES = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29]; // indices into EQ_BANDS_31 for the classic 10-band

// ─── Frequency Range Tooltips (Hebrew) ────────────────────────
const EQ_FREQ_TOOLTIPS: Record<number, string> = {
  20: 'סאב-בס עמוק — רעידות, רעש רקע נמוך',
  25: 'סאב-בס — תהודת חדר, רטט',
  31: 'סאב-בס — רעש רוח, דפיקות',
  40: 'בס נמוך — עומק קולי, רעש מזגן',
  50: 'בס — זמזום חשמל (50Hz), רעש רשת',
  63: 'בס — גוף הקול הגברי, באס גיטרה',
  80: 'בס עליון — חום בקול, בום בחדר',
  100: 'בס עליון — מלאות הקול, תהודת מיקרופון',
  125: 'מעבר לאמצעים — עובי הדיבור',
  160: 'אמצעים נמוכים — גוף הקול',
  200: 'אמצעים נמוכים — צליל "קרטוני", מאדי',
  250: 'אמצעים — צליל "קופסה", טשטוש',
  315: 'אמצעים — בהירות ראשונית',
  400: 'אמצעים — נזליות, אף',
  500: 'אמצעים — ליבת הדיבור, בהירות',
  630: 'אמצעים עליונים — נוכחות קולית',
  800: 'אמצעים עליונים — חדות דיבור',
  1000: 'תדר התייחסות (1kHz) — ליבת השמיעה',
  1250: 'נוכחות — בהירות הגה',
  1600: 'נוכחות — חדות עיצורים',
  2000: 'נוכחות גבוהה — "ש", "ס", אינטליגנציה',
  2500: 'חדות — הבנת דיבור, תחושת קרבה',
  3150: 'חדות עליונה — חיתוך דרך המיקס',
  4000: 'ברק — אטאק, "ת", "ק", "פ"',
  5000: 'ברק עליון — סיבילנס, שריקה',
  6300: 'אוויר נמוך — נשימתיות, דה-אסינג',
  8000: 'אוויר — פתיחות, צלילי "ס"',
  10000: 'אוויר גבוה — נוצץ, ברק',
  12500: 'סופר-אוויר — הרמוניות עליונות',
  16000: 'אולטרה — אוויריות דקה',
  20000: 'אולטרה גבוה — נוכחות סטריאופונית',
};

// ─── EQ Slider Visual Themes ──────────────────────────────────
type EqSliderTheme = 'default' | 'neon' | 'led' | 'glass' | 'gradient' | 'minimal' | 'console' | 'vu' | 'studio' | 'retro' | 'cyber';
const EQ_SLIDER_THEMES: { id: EqSliderTheme; label: string; icon: string }[] = [
  { id: 'default', label: 'רגיל', icon: '▦' },
  { id: 'console', label: 'מיקסר', icon: '🎛️' },
  { id: 'vu', label: 'VU מד', icon: '🟩' },
  { id: 'studio', label: 'סטודיו', icon: '🎚️' },
  { id: 'retro', label: 'רטרו', icon: '📻' },
  { id: 'cyber', label: 'סייבר', icon: '⚡' },
  { id: 'neon', label: 'ניאון', icon: '💡' },
  { id: 'led', label: 'LED', icon: '💚' },
  { id: 'glass', label: 'זכוכית', icon: '🔮' },
  { id: 'gradient', label: 'גרדיאנט', icon: '🌈' },
  { id: 'minimal', label: 'מינימלי', icon: '◻️' },
];

// ─── AI Noise Reduction Presets ───────────────────────────────
interface NoisePreset {
  id: string;
  nameHe: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  // Filter params
  highpassFreq: number;
  lowpassFreq: number;
  voiceBoostGain: number;
  voiceBoostQ: number;
  compThreshold: number;
  compRatio: number;
  compKnee: number;
  compAttack: number;
  compRelease: number;
  // Multi-band EQ
  deSibilance: boolean;   // reduce 6-8kHz
  deRumble: boolean;      // reduce <100Hz
  presenceBoost: boolean; // boost 2-5kHz
  warmth: boolean;        // boost 200-400Hz
  gateThreshold: number;  // noise gate -100 to -20 dB (0=off)
}

const NOISE_PRESETS: NoisePreset[] = [
  {
    id: 'off', nameHe: 'כבוי', icon: VolumeX, description: 'ללא עיבוד',
    highpassFreq: 20, lowpassFreq: 20000, voiceBoostGain: 0, voiceBoostQ: 1,
    compThreshold: -50, compRatio: 1, compKnee: 40, compAttack: 0.003, compRelease: 0.25,
    deSibilance: false, deRumble: false, presenceBoost: false, warmth: false, gateThreshold: 0,
  },
  {
    id: 'light', nameHe: 'קלה', icon: Wind, description: 'הפחתה עדינה — רעש רקע קל',
    highpassFreq: 80, lowpassFreq: 16000, voiceBoostGain: 2, voiceBoostQ: 1,
    compThreshold: -30, compRatio: 3, compKnee: 15, compAttack: 0.005, compRelease: 0.2,
    deSibilance: false, deRumble: true, presenceBoost: false, warmth: false, gateThreshold: -60,
  },
  {
    id: 'medium', nameHe: 'בינונית', icon: Filter, description: 'רעש מאוורר / מזגן',
    highpassFreq: 150, lowpassFreq: 14000, voiceBoostGain: 5, voiceBoostQ: 1.2,
    compThreshold: -28, compRatio: 5, compKnee: 10, compAttack: 0.003, compRelease: 0.2,
    deSibilance: false, deRumble: true, presenceBoost: true, warmth: false, gateThreshold: -45,
  },
  {
    id: 'aggressive', nameHe: 'חזקה', icon: ShieldCheck, description: 'סביבה רועשת מאוד',
    highpassFreq: 200, lowpassFreq: 12000, voiceBoostGain: 8, voiceBoostQ: 1.5,
    compThreshold: -35, compRatio: 8, compKnee: 5, compAttack: 0.002, compRelease: 0.15,
    deSibilance: true, deRumble: true, presenceBoost: true, warmth: true, gateThreshold: -35,
  },
  {
    id: 'ai-voice', nameHe: 'AI קול טהור', icon: Brain, description: 'מיטוב חכם לדיבור עברי',
    highpassFreq: 120, lowpassFreq: 13000, voiceBoostGain: 6, voiceBoostQ: 1.3,
    compThreshold: -32, compRatio: 6, compKnee: 8, compAttack: 0.003, compRelease: 0.18,
    deSibilance: true, deRumble: true, presenceBoost: true, warmth: true, gateThreshold: -40,
  },
  {
    id: 'podcast', nameHe: 'פודקאסט', icon: Radio, description: 'קול חם ומקצועי',
    highpassFreq: 90, lowpassFreq: 15000, voiceBoostGain: 4, voiceBoostQ: 0.8,
    compThreshold: -24, compRatio: 4, compKnee: 12, compAttack: 0.005, compRelease: 0.25,
    deSibilance: true, deRumble: true, presenceBoost: false, warmth: true, gateThreshold: -55,
  },
  {
    id: 'lecture', nameHe: 'הרצאה', icon: Mic, description: 'דיבור באולם / שטח',
    highpassFreq: 160, lowpassFreq: 13000, voiceBoostGain: 7, voiceBoostQ: 1.4,
    compThreshold: -30, compRatio: 6, compKnee: 8, compAttack: 0.003, compRelease: 0.2,
    deSibilance: false, deRumble: true, presenceBoost: true, warmth: false, gateThreshold: -42,
  },
];

export interface SyncAudioPlayerRef {
  seekTo: (time: number) => void;
  play: () => void;
  pause: () => void;
}

export interface SpeakerSegmentForWaveform {
  start: number;
  end: number;
  speaker: string;
}

interface SyncAudioPlayerProps {
  audioUrl: string | null;
  wordTimings: WordTiming[];
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
  onWordClick?: (index: number, timing: WordTiming) => void;
  syncEnabled?: boolean;
  onSyncToggle?: (enabled: boolean) => void;
  compact?: boolean;
  eqWide?: boolean;
  eqFloating?: boolean;
  eqPortalTarget?: HTMLDivElement | null;
  onPlayStateChange?: (playing: boolean) => void;
  speakerSegments?: SpeakerSegmentForWaveform[];
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const QUICK_SPEED_OPTIONS = [0.75, 0.9, 0.95, 1, 1.05, 1.1, 1.25, 1.5];

function clampSpeed(v: number): number {
  return Math.min(2, Math.max(0.5, Number(v.toFixed(2))));
}

type IssueType = 'low-volume' | 'clipping' | 'hiss-risk' | 'hiss';

interface ProblemSegment {
  id: string;
  issueType: IssueType;
  start: number;
  end: number;
  severity: number;
}

interface UserNoisePreset {
  id: string;
  name: string;
  enhancementStrength: number;
  presetId: string;
  manualHighpass: number;
  manualLowpass: number;
  manualVoiceBoost: number;
  manualCompRatio: number;
  manualGate: number;
  humNotchEnabled: boolean;
  humNotchFreq: '50' | '60' | '100' | '120';
}

const USER_PRESETS_KEY = 'sync_audio_user_presets_v1';
const USER_EQ_PRESETS_KEY = 'sync_audio_user_eq_presets_v1';

interface UserEqPreset {
  id: string;
  name: string;
  gains: number[];
  qValues: number[];
  createdAt: number;
}

function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const numChannels = 1;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export const SyncAudioPlayer = memo(forwardRef<SyncAudioPlayerRef, SyncAudioPlayerProps>(({
  audioUrl,
  wordTimings,
  currentTime: externalTime,
  onTimeUpdate,
  onWordClick,
  syncEnabled: externalSync,
  onSyncToggle,
  compact,
  eqWide,
  eqFloating,
  eqPortalTarget,
  onPlayStateChange,
  speakerSegments,
}, ref) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const lastDrawTimeRef = useRef<number>(0);

  // Static waveform
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaksData, setPeaksData] = useState<Float32Array | null>(null);
  const [decodedDuration, setDecodedDuration] = useState<number>(0);
  const staticAnimFrameRef = useRef<number>(0);

  // Speaker color palette
  const SPEAKER_COLORS = useMemo(() => [
    '#6366f1', // indigo
    '#f59e0b', // amber
    '#10b981', // emerald
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#f97316', // orange
    '#ec4899', // pink
  ], []);

  const speakerColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!speakerSegments) return map;
    const speakers = [...new Set(speakerSegments.map(s => s.speaker))];
    speakers.forEach((sp, i) => { map[sp] = SPEAKER_COLORS[i % SPEAKER_COLORS.length]; });
    return map;
  }, [speakerSegments, SPEAKER_COLORS]);

  // Audio graph nodes
  const gainNodeRef = useRef<GainNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const highpassRef = useRef<BiquadFilterNode | null>(null);
  const lowpassRef = useRef<BiquadFilterNode | null>(null);
  const voiceBoostRef = useRef<BiquadFilterNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const humNotchRef = useRef<BiquadFilterNode | null>(null);
  // Multi-band EQ nodes
  const deSibilanceRef = useRef<BiquadFilterNode | null>(null);
  const deRumbleRef = useRef<BiquadFilterNode | null>(null);
  const presenceRef = useRef<BiquadFilterNode | null>(null);
  const warmthRef = useRef<BiquadFilterNode | null>(null);
  // Vocal Doubler nodes
  const doublerDryRef = useRef<GainNode | null>(null);
  const doublerWet1Ref = useRef<GainNode | null>(null);
  const doublerWet2Ref = useRef<GainNode | null>(null);
  const doublerDelay1Ref = useRef<DelayNode | null>(null);
  const doublerDelay2Ref = useRef<DelayNode | null>(null);
  const doublerLfo1Ref = useRef<OscillatorNode | null>(null);
  const doublerLfo2Ref = useRef<OscillatorNode | null>(null);
  const doublerLfoGain1Ref = useRef<GainNode | null>(null);
  const doublerLfoGain2Ref = useRef<GainNode | null>(null);
  const doublerMergeRef = useRef<GainNode | null>(null);
  // Vocal Overlay (personal sync) nodes
  const overlayGainRef = useRef<GainNode | null>(null);
  const overlaySourceRef = useRef<AudioBufferSourceNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Equalizer
  const eqCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eqAnimFrameRef = useRef<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showSpeedControl, setShowSpeedControl] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showEnhance, setShowEnhance] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAdvancedDialog, setShowAdvancedDialog] = useState(false);
  const [isNoisePanelCollapsed, setIsNoisePanelCollapsed] = useState(false);
  const [isFocusPanelCollapsed, setIsFocusPanelCollapsed] = useState(false);
  const [isMixerConsoleCollapsed, setIsMixerConsoleCollapsed] = useState(false);
  const [isMixerFullscreen, setIsMixerFullscreen] = useState(false);
  // Master ON/OFF toggle for the entire mixer/EQ panel.
  // When OFF: only a small "Power" button is shown (panel collapsed entirely).
  // When ON: the panel expands to FULL horizontal width of the page.
  const [isEqPanelOpen, setIsEqPanelOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('eq_panel_open') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('eq_panel_open', isEqPanelOpen ? '1' : '0'); } catch { /* ignore */ }
  }, [isEqPanelOpen]);

  // ─── Draggable widget grid (Studio layout) ──────────────────
  const [studioLayouts, setStudioLayouts] = useState<Layouts>(() => loadStudioLayouts());
  const [layoutEditMode, setLayoutEditMode] = useState<boolean>(() => isStudioEditModeEnabled());
  const handleStudioLayoutChange = useCallback((_current: any, all: Layouts) => {
    setStudioLayouts(all);
    saveStudioLayouts(all);
  }, []);
  const handleResetStudioLayout = useCallback(() => {
    const fresh = resetStudioLayouts();
    setStudioLayouts(fresh);
  }, []);
  useEffect(() => {
    setStudioEditModeEnabled(layoutEditMode);
  }, [layoutEditMode]);

  const [outputGain, setOutputGain] = useState(1.0); // 0.0 to 3.0 (multiply)
  const [showEqualizer, setShowEqualizer] = useState(true);
  // 31-band parametric EQ user controls (dB, -12 to +12)
  const [eqGains, setEqGains] = useState<number[]>(() => new Array(31).fill(0));
  const [eqQValues, setEqQValues] = useState<number[]>(() => EQ_BANDS_31.map(b => b.q));
  const [eqBandCount, setEqBandCount] = useState<EqBandCount>(31);
  const [eqViewMode, setEqViewMode] = useState<'vertical' | 'horizontal' | 'circular' | 'parametric'>('vertical');
  const [selectedParamBand, setSelectedParamBand] = useState<number | null>(null);
  const [advVerticalView, setAdvVerticalView] = useState(false);
  const [eqVizStyle, setEqVizStyle] = useState<'bars' | 'mirror' | 'wave' | 'circle' | 'spectrum' | 'flame' | 'radar' | 'dots'>('bars');
  const [eqSliderTheme, setEqSliderTheme] = useState<EqSliderTheme>('default');
  const [userEqPresets, setUserEqPresets] = useState<UserEqPreset[]>(() => {
    try { const raw = localStorage.getItem(USER_EQ_PRESETS_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });
  const [userEqPresetName, setUserEqPresetName] = useState('');
  const [showSaveEqPreset, setShowSaveEqPreset] = useState(false);
  const [eqStyleBarCollapsed, setEqStyleBarCollapsed] = useState(false);
  const [eqCanvasCollapsed, setEqCanvasCollapsed] = useState(false);
  // Vocal Doubler state
  const [doublerEnabled, setDoublerEnabled] = useState(false);
  const [doublerMix, setDoublerMix] = useState(0.4); // 0=dry only, 1=wet only
  const [doublerDetune1, setDoublerDetune1] = useState(7); // cents for voice 1
  const [doublerDetune2, setDoublerDetune2] = useState(-5); // cents for voice 2
  const [doublerDelay1Ms, setDoublerDelay1Ms] = useState(18); // ms
  const [doublerDelay2Ms, setDoublerDelay2Ms] = useState(25); // ms
  const [doublerDepth, setDoublerDepth] = useState(0.002); // LFO depth (seconds)
  const [doublerRate, setDoublerRate] = useState(0.8); // LFO rate Hz
  const [doublerMode, setDoublerMode] = useState<'chorus' | 'harmony' | 'octave'>('chorus');
  // Vocal Overlay (personal sync) state
  const [overlayBuffer, setOverlayBuffer] = useState<AudioBuffer | null>(null);
  const [overlayFileName, setOverlayFileName] = useState<string>('');
  const [overlayVolume, setOverlayVolume] = useState(0.8);
  const [overlayOffset, setOverlayOffset] = useState(0); // seconds — where in the main track to start overlay
  const [overlayTrimStart, setOverlayTrimStart] = useState(0); // seconds — trim from beginning of overlay
  const [overlayTrimEnd, setOverlayTrimEnd] = useState(0); // seconds — will be set to overlay duration
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [overlayIsPlaying, setOverlayIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<number>(0);
  const [showOverlayPanel, setShowOverlayPanel] = useState(false);
  const overlayFileInputRef = useRef<HTMLInputElement | null>(null);
  const [eqStyleBarHover, setEqStyleBarHover] = useState(false);
  const [eqCanvasHover, setEqCanvasHover] = useState(false);
  const [staticWaveCollapsed, setStaticWaveCollapsed] = useState(false);
  const [staticWaveHover, setStaticWaveHover] = useState(false);
  const [seekBarCollapsed, setSeekBarCollapsed] = useState(false);
  const [seekBarHover, setSeekBarHover] = useState(false);
  const eqBandsRef = useRef<BiquadFilterNode[]>([]);
  // Helper: get/set individual band gain
  const setEqBand = useCallback((index: number, value: number) => {
    setEqGains(prev => { const next = [...prev]; next[index] = value; return next; });
  }, []);
  // Helper: get/set individual band Q (bandwidth)
  const setEqQ = useCallback((index: number, value: number) => {
    setEqQValues(prev => { const next = [...prev]; next[index] = value; return next; });
  }, []);
  // Save/delete custom EQ presets (localStorage)
  const saveUserEqPreset = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newPreset: UserEqPreset = { id: `eq_${Date.now()}`, name: trimmed, gains: [...eqGains], qValues: [...eqQValues], createdAt: Date.now() };
    setUserEqPresets(prev => {
      const next = [...prev, newPreset];
      try { localStorage.setItem(USER_EQ_PRESETS_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
    setUserEqPresetName('');
    setShowSaveEqPreset(false);
  }, [eqGains, eqQValues]);
  const deleteUserEqPreset = useCallback((id: string) => {
    setUserEqPresets(prev => {
      const next = prev.filter(p => p.id !== id);
      try { localStorage.setItem(USER_EQ_PRESETS_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);
  const loadUserEqPreset = useCallback((preset: UserEqPreset) => {
    setEqGains([...preset.gains]);
    if (preset.qValues?.length === 31) setEqQValues([...preset.qValues]);
  }, []);
  // Legacy aliases for backward compat with presets (map to 31-band indices)
  const eq31 = eqGains[2]; const eq63 = eqGains[5]; const eq125 = eqGains[8];
  const eq250 = eqGains[11]; const eq500 = eqGains[14]; const eq1k = eqGains[17];
  const eq2k = eqGains[20]; const eq4k = eqGains[23]; const eq8k = eqGains[26]; const eq16k = eqGains[29];
  const setEq31 = (v: number) => setEqBand(2, v);
  const setEq63 = (v: number) => setEqBand(5, v);
  const setEq125 = (v: number) => setEqBand(8, v);
  const setEq250 = (v: number) => setEqBand(11, v);
  const setEq500 = (v: number) => setEqBand(14, v);
  const setEq1k = (v: number) => setEqBand(17, v);
  const setEq2k = (v: number) => setEqBand(20, v);
  const setEq4k = (v: number) => setEqBand(23, v);
  const setEq8k = (v: number) => setEqBand(26, v);
  const setEq16k = (v: number) => setEqBand(29, v);

  // A-B focused processing (speed + enhancement on selected segment only)
  const [focusEnabled, setFocusEnabled] = useState(false);
  const [focusStart, setFocusStart] = useState(0);
  const [focusEnd, setFocusEnd] = useState(0);
  const [focusLoop, setFocusLoop] = useState(false);

  // Waveform bookmarks
  interface Bookmark { time: number; label: string; color: string }
  const BOOKMARK_STORAGE = 'waveform_bookmarks_v1';
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    try { const raw = localStorage.getItem(BOOKMARK_STORAGE); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });
  const [editingBookmarkIdx, setEditingBookmarkIdx] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem(BOOKMARK_STORAGE, JSON.stringify(bookmarks));
  }, [bookmarks]);

  // Escape key closes mixer fullscreen
  useEffect(() => {
    if (!isMixerFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMixerFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMixerFullscreen]);

  const addBookmark = useCallback((time: number) => {
    const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
    setBookmarks(prev => [...prev, { time, label: `סימנייה ${prev.length + 1}`, color: COLORS[prev.length % COLORS.length] }]);
  }, []);

  const removeBookmark = useCallback((idx: number) => {
    setBookmarks(prev => prev.filter((_, i) => i !== idx));
    setEditingBookmarkIdx(null);
  }, []);

  const updateBookmarkLabel = useCallback((idx: number, label: string) => {
    setBookmarks(prev => prev.map((b, i) => i === idx ? { ...b, label } : b));
  }, []);

  const hasValidFocusRange = focusEnd > focusStart;
  const isWithinFocusedSegment = !focusEnabled || !hasValidFocusRange
    ? true
    : currentTime >= focusStart && currentTime <= focusEnd;

  // Sync toggle (internal + external)
  const [internalSync, setInternalSync] = useState(true);
  const isSyncEnabled = externalSync !== undefined ? externalSync : internalSync;
  const toggleSync = useCallback(() => {
    const next = !isSyncEnabled;
    setInternalSync(next);
    onSyncToggle?.(next);
  }, [isSyncEnabled, onSyncToggle]);

  // Imperative ref for external control (e.g. from SpeakerDiarization)
  useImperativeHandle(ref, () => ({
    seekTo: (time: number) => {
      if (audioRef.current) {
        audioRef.current.currentTime = time;
        setCurrentTime(time);
        onTimeUpdate?.(time);
      }
    },
    play: () => {
      if (audioRef.current && audioRef.current.paused) {
        initAudioContext();
        if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume();
        audioRef.current.play();
        setIsPlaying(true);
      }
    },
    pause: () => {
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    },
  }));

  // Notify parent of play state changes
  useEffect(() => { onPlayStateChange?.(isPlaying); }, [isPlaying, onPlayStateChange]);

  // Noise reduction state
  const [presetId, setPresetId] = useState('off');
  const currentPreset = NOISE_PRESETS.find(p => p.id === presetId) || NOISE_PRESETS[0];

  // Advanced manual overrides
  const [manualHighpass, setManualHighpass] = useState(80);
  const [manualLowpass, setManualLowpass] = useState(16000);
  const [manualVoiceBoost, setManualVoiceBoost] = useState(0);
  const [manualGate, setManualGate] = useState(0);
  const [manualCompRatio, setManualCompRatio] = useState(1);
  const [humNotchEnabled, setHumNotchEnabled] = useState(false);
  const [humNotchFreq, setHumNotchFreq] = useState<'50' | '60' | '100' | '120'>('50');
  const isManualMode = presetId === 'manual';
  const [enhancementStrength, setEnhancementStrength] = useState(55);
  const [isBypassEnhancement, setIsBypassEnhancement] = useState(false);
  const [problemSegments, setProblemSegments] = useState<ProblemSegment[]>([]);
  const [userPresets, setUserPresets] = useState<UserNoisePreset[]>([]);
  const [userPresetName, setUserPresetName] = useState('');

  // ─── Advanced Audio Processing State ─────────────────────────
  const [aiDenoiseEnabled, setAiDenoiseEnabled] = useState(false);
  const [aiDenoiseStrength, setAiDenoiseStrength] = useState(70);
  const [spectralGateEnabled, setSpectralGateEnabled] = useState(false);
  const [spectralGateReduction, setSpectralGateReduction] = useState(-12);
  const [isLearningNoise, setIsLearningNoise] = useState(false);
  const [hasNoiseProfile, setHasNoiseProfile] = useState(false);
  const [vadEnabled, setVadEnabled] = useState(false);
  const [vadAutoMute, setVadAutoMute] = useState(false);
  const [vadIsSpeech, setVadIsSpeech] = useState(false);
  const [vadThreshold, setVadThreshold] = useState(0.015);
  const [deHumEnabled, setDeHumEnabled] = useState(false);
  const [deHumDetectedFreq, setDeHumDetectedFreq] = useState<50 | 60 | null>(null);
  const [deHumHarmonics, setDeHumHarmonics] = useState(4);
  const [lufsEnabled, setLufsEnabled] = useState(false);
  const [lufsNormalize, setLufsNormalize] = useState(false);
  const [lufsTarget, setLufsTarget] = useState(-16);
  const [lufsMomentary, setLufsMomentary] = useState(-Infinity);
  const [lufsShortTerm, setLufsShortTerm] = useState(-Infinity);
  const [lufsIntegrated, setLufsIntegrated] = useState(-Infinity);

  // Refs for advanced processing modules
  const aiDenoiseRef = useRef<Awaited<ReturnType<typeof import('@/lib/rnnoiseProcessor').createNoiseSuppressionChain>> | null>(null);
  const spectralGateRef = useRef<ReturnType<typeof import('@/lib/spectralGate').createSpectralGate> | null>(null);
  const vadRef = useRef<ReturnType<typeof import('@/lib/voiceActivityDetection').createVAD> | null>(null);
  const deHumRef = useRef<ReturnType<typeof import('@/lib/deHum').createDeHum> | null>(null);
  const lufsRef = useRef<ReturnType<typeof import('@/lib/loudnessNorm').createLoudnessNorm> | null>(null);

  // Current word index for sync
  const currentWordIndex = useMemo(() => {
    if (!isSyncEnabled || !wordTimings.length) return -1;
    for (let i = wordTimings.length - 1; i >= 0; i--) {
      if (currentTime >= wordTimings[i].start) return i;
    }
    return -1;
  }, [currentTime, wordTimings, isSyncEnabled]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_PRESETS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setUserPresets(parsed.filter((p) => p && p.id && p.name));
      }
    } catch {
      // ignore corrupted local data
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(userPresets));
    } catch {
      // localStorage quota/availability issues are non-fatal
    }
  }, [userPresets]);

  const saveCurrentAsUserPreset = useCallback(() => {
    const name = userPresetName.trim();
    if (!name) return;
    const next: UserNoisePreset = {
      id: crypto.randomUUID(),
      name,
      enhancementStrength,
      presetId,
      manualHighpass,
      manualLowpass,
      manualVoiceBoost,
      manualCompRatio,
      manualGate,
      humNotchEnabled,
      humNotchFreq,
    };
    setUserPresets((prev) => [next, ...prev].slice(0, 20));
    setUserPresetName('');
  }, [
    userPresetName,
    enhancementStrength,
    presetId,
    manualHighpass,
    manualLowpass,
    manualVoiceBoost,
    manualCompRatio,
    manualGate,
    humNotchEnabled,
    humNotchFreq,
  ]);

  const applyUserPreset = useCallback((preset: UserNoisePreset) => {
    setEnhancementStrength(preset.enhancementStrength);
    setPresetId(preset.presetId);
    setManualHighpass(preset.manualHighpass);
    setManualLowpass(preset.manualLowpass);
    setManualVoiceBoost(preset.manualVoiceBoost);
    setManualCompRatio(preset.manualCompRatio);
    setManualGate(preset.manualGate);
    setHumNotchEnabled(preset.humNotchEnabled);
    setHumNotchFreq(preset.humNotchFreq);
  }, []);

  const removeUserPreset = useCallback((id: string) => {
    setUserPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const enhancementSettings = useMemo(() => {
    const strength = Math.max(0, Math.min(1, enhancementStrength / 100));
    const lerp = (from: number, to: number) => from + (to - from) * strength;

    const neutral = {
      hp: 20,
      lp: 20000,
      vbGain: 0,
      vbQ: 1,
      cThresh: -50,
      cRatio: 1,
      cKnee: 40,
      cAttack: 0.003,
      cRelease: 0.25,
      deSibilanceGain: 0,
      deRumbleFreq: 20,
      presenceGain: 0,
      warmthGain: 0,
      gateThreshold: 0,
    };

    if (isBypassEnhancement || presetId === 'off') {
      return neutral;
    }

    const p = isManualMode ? null : currentPreset;
    const targetHp = p ? p.highpassFreq : manualHighpass;
    const targetLp = p ? p.lowpassFreq : manualLowpass;
    const targetVbGain = p ? p.voiceBoostGain : manualVoiceBoost;
    const targetVbQ = p ? p.voiceBoostQ : 1;
    const targetThresh = p ? p.compThreshold : -50 + (manualCompRatio > 1 ? -(manualCompRatio * 3) : 0);
    const targetRatio = p ? p.compRatio : manualCompRatio;
    const targetKnee = p ? p.compKnee : 10;
    const targetAttack = p ? p.compAttack : 0.003;
    const targetRelease = p ? p.compRelease : 0.2;

    return {
      hp: lerp(neutral.hp, targetHp),
      lp: lerp(neutral.lp, targetLp),
      vbGain: lerp(neutral.vbGain, targetVbGain),
      vbQ: lerp(neutral.vbQ, targetVbQ),
      cThresh: lerp(neutral.cThresh, targetThresh),
      cRatio: lerp(neutral.cRatio, targetRatio),
      cKnee: lerp(neutral.cKnee, targetKnee),
      cAttack: lerp(neutral.cAttack, targetAttack),
      cRelease: lerp(neutral.cRelease, targetRelease),
      deSibilanceGain: (!isManualMode && p?.deSibilance && strength > 0.25) ? lerp(0, -6) : 0,
      deRumbleFreq: (!isManualMode && p?.deRumble && strength > 0.2) ? lerp(20, 100) : 20,
      presenceGain: (!isManualMode && p?.presenceBoost && strength > 0.35) ? lerp(0, 4) : 0,
      warmthGain: (!isManualMode && p?.warmth && strength > 0.35) ? lerp(0, 3) : 0,
      gateThreshold: p ? lerp(0, p.gateThreshold) : lerp(0, manualGate),
    };
  }, [
    enhancementStrength,
    isBypassEnhancement,
    presetId,
    isManualMode,
    currentPreset,
    manualHighpass,
    manualLowpass,
    manualVoiceBoost,
    manualCompRatio,
    manualGate,
  ]);

  // ─── Initialize Web Audio API ────────────────────────────────
  const initAudioContext = useCallback(() => {
    if (audioContextRef.current || !audioRef.current) return;

    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    const source = ctx.createMediaElementSource(audioRef.current);
    sourceRef.current = source;

    const gain = ctx.createGain();
    gainNodeRef.current = gain;

    // Output gain (post-processing volume boost)
    const outGain = ctx.createGain();
    outGain.gain.value = outputGain;
    outputGainRef.current = outGain;

    // Highpass (rumble cut)
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    highpass.Q.value = 0.7;
    highpassRef.current = highpass;

    // Lowpass (hiss reduction)
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 20000;
    lowpass.Q.value = 0.7;
    lowpassRef.current = lowpass;

    // Voice presence boost (peaking EQ at 3kHz)
    const voiceBoost = ctx.createBiquadFilter();
    voiceBoost.type = 'peaking';
    voiceBoost.frequency.value = 3000;
    voiceBoost.gain.value = 0;
    voiceBoost.Q.value = 1;
    voiceBoostRef.current = voiceBoost;

    // De-sibilance (notch at 7kHz)
    const deSibilance = ctx.createBiquadFilter();
    deSibilance.type = 'peaking';
    deSibilance.frequency.value = 7000;
    deSibilance.gain.value = 0;
    deSibilance.Q.value = 2;
    deSibilanceRef.current = deSibilance;

    // De-rumble (extra steep cut below 100Hz)
    const deRumble = ctx.createBiquadFilter();
    deRumble.type = 'highpass';
    deRumble.frequency.value = 20;
    deRumble.Q.value = 0.5;
    deRumbleRef.current = deRumble;

    // Presence boost (broad peak at 3.5kHz)
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3500;
    presence.gain.value = 0;
    presence.Q.value = 0.8;
    presenceRef.current = presence;

    // Warmth boost (200-400Hz shelf)
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowshelf';
    warmth.frequency.value = 300;
    warmth.gain.value = 0;
    warmthRef.current = warmth;

    // Compressor
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.ratio.value = 1;
    compressor.knee.value = 40;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    compressorRef.current = compressor;

    // Hum notch (50/60Hz and harmonics)
    const humNotch = ctx.createBiquadFilter();
    humNotch.type = 'notch';
    humNotch.frequency.value = 50;
    humNotch.Q.value = 8;
    humNotchRef.current = humNotch;

    // 31-band parametric EQ (1/3 octave, ISO standard)
    const eqNodes: BiquadFilterNode[] = EQ_BANDS_31.map((band, i) => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = band.freq;
      f.Q.value = band.q;
      f.gain.value = eqGains[i] || 0;
      return f;
    });
    // Chain EQ nodes together
    for (let i = 1; i < eqNodes.length; i++) {
      eqNodes[i - 1].connect(eqNodes[i]);
    }
    eqBandsRef.current = eqNodes;

    // Analyser
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    // Chain: source → deRumble → highpass → lowpass → humNotch → voiceBoost → deSibilance → presence → warmth → compressor → EQ bands → outputGain → gain → analyser → output
    source.connect(deRumble);
    deRumble.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(humNotch);
    humNotch.connect(voiceBoost);
    voiceBoost.connect(deSibilance);
    deSibilance.connect(presence);
    presence.connect(warmth);
    warmth.connect(compressor);
    compressor.connect(eqNodes[0]);
    eqNodes[eqNodes.length - 1].connect(outGain);

    // ─── Vocal Doubler (chorus/doubling effect) ───
    // Dry path
    const doublerDry = ctx.createGain();
    doublerDry.gain.value = 1.0; // controlled by doublerMix
    doublerDryRef.current = doublerDry;
    // Merge node (collects dry + wet)
    const doublerMerge = ctx.createGain();
    doublerMerge.gain.value = 1.0;
    doublerMergeRef.current = doublerMerge;
    // Wet voice 1: slight delay + LFO modulation
    const delay1 = ctx.createDelay(0.2);
    delay1.delayTime.value = 0.018; // 18ms
    doublerDelay1Ref.current = delay1;
    const wet1 = ctx.createGain();
    wet1.gain.value = 0; // off by default
    doublerWet1Ref.current = wet1;
    const lfo1 = ctx.createOscillator();
    lfo1.type = 'sine';
    lfo1.frequency.value = 0.8;
    const lfoGain1 = ctx.createGain();
    lfoGain1.gain.value = 0.002; // depth in seconds
    lfo1.connect(lfoGain1);
    lfoGain1.connect(delay1.delayTime);
    lfo1.start();
    doublerLfo1Ref.current = lfo1;
    doublerLfoGain1Ref.current = lfoGain1;
    // Wet voice 2: different delay + LFO
    const delay2 = ctx.createDelay(0.2);
    delay2.delayTime.value = 0.025; // 25ms
    doublerDelay2Ref.current = delay2;
    const wet2 = ctx.createGain();
    wet2.gain.value = 0; // off by default
    doublerWet2Ref.current = wet2;
    const lfo2 = ctx.createOscillator();
    lfo2.type = 'sine';
    lfo2.frequency.value = 1.1; // slightly different rate
    const lfoGain2 = ctx.createGain();
    lfoGain2.gain.value = 0.003;
    lfo2.connect(lfoGain2);
    lfoGain2.connect(delay2.delayTime);
    lfo2.start();
    doublerLfo2Ref.current = lfo2;
    doublerLfoGain2Ref.current = lfoGain2;
    // Connect doubler paths: outGain → dry → merge; outGain → delay → wet → merge
    outGain.connect(doublerDry);
    doublerDry.connect(doublerMerge);
    outGain.connect(delay1);
    delay1.connect(wet1);
    wet1.connect(doublerMerge);
    outGain.connect(delay2);
    delay2.connect(wet2);
    wet2.connect(doublerMerge);

    doublerMerge.connect(gain);

    // Overlay (personal sync) gain — secondary audio source mixes in here
    const overlayGain = ctx.createGain();
    overlayGain.gain.value = 0.8;
    overlayGainRef.current = overlayGain;
    overlayGain.connect(gain);

    gain.connect(analyser);
    analyser.connect(ctx.destination);
  }, []);

  // ─── Apply preset or manual params ───────────────────────────
  useEffect(() => {
    if (!highpassRef.current) return;

    const processingActive = !focusEnabled || !hasValidFocusRange || isWithinFocusedSegment;
    if (!processingActive) {
      highpassRef.current.frequency.value = 20;
      if (lowpassRef.current) lowpassRef.current.frequency.value = 20000;
      if (voiceBoostRef.current) {
        voiceBoostRef.current.gain.value = 0;
        voiceBoostRef.current.Q.value = 1;
      }
      if (compressorRef.current) {
        compressorRef.current.threshold.value = -50;
        compressorRef.current.ratio.value = 1;
        compressorRef.current.knee.value = 40;
        compressorRef.current.attack.value = 0.003;
        compressorRef.current.release.value = 0.25;
      }
      if (deSibilanceRef.current) deSibilanceRef.current.gain.value = 0;
      if (deRumbleRef.current) deRumbleRef.current.frequency.value = 20;
      if (presenceRef.current) presenceRef.current.gain.value = 0;
      if (warmthRef.current) warmthRef.current.gain.value = 0;
      return;
    }

    highpassRef.current.frequency.value = enhancementSettings.hp;
    if (lowpassRef.current) {
      lowpassRef.current.frequency.value = enhancementSettings.lp;
    }
    if (voiceBoostRef.current) {
      voiceBoostRef.current.gain.value = enhancementSettings.vbGain;
      voiceBoostRef.current.Q.value = enhancementSettings.vbQ;
    }
    if (compressorRef.current) {
      compressorRef.current.threshold.value = enhancementSettings.cThresh;
      compressorRef.current.ratio.value = enhancementSettings.cRatio;
      compressorRef.current.knee.value = enhancementSettings.cKnee;
      compressorRef.current.attack.value = enhancementSettings.cAttack;
      compressorRef.current.release.value = enhancementSettings.cRelease;
    }

    // Multi-band toggles
    if (deSibilanceRef.current) {
      deSibilanceRef.current.gain.value = enhancementSettings.deSibilanceGain;
    }
    if (deRumbleRef.current) {
      deRumbleRef.current.frequency.value = enhancementSettings.deRumbleFreq;
    }
    if (presenceRef.current) {
      presenceRef.current.gain.value = enhancementSettings.presenceGain;
    }
    if (warmthRef.current) {
      warmthRef.current.gain.value = enhancementSettings.warmthGain;
    }
  }, [
    enhancementSettings,
    focusEnabled,
    hasValidFocusRange,
    isWithinFocusedSegment,
  ]);

  useEffect(() => {
    if (!humNotchRef.current) return;
    if (humNotchEnabled && !isBypassEnhancement && enhancementStrength > 10) {
      humNotchRef.current.frequency.value = Number(humNotchFreq);
      humNotchRef.current.Q.value = 10;
    } else {
      humNotchRef.current.frequency.value = 10;
      humNotchRef.current.Q.value = 0.0001;
    }
  }, [humNotchEnabled, humNotchFreq, isBypassEnhancement, enhancementStrength]);

  // ─── Output Gain (volume boost after processing) ─────────────
  useEffect(() => {
    if (outputGainRef.current) {
      outputGainRef.current.gain.value = outputGain;
    }
  }, [outputGain]);

  // ─── 31-band EQ real-time update (gain + Q) ──────────────────
  useEffect(() => {
    eqBandsRef.current.forEach((node, i) => {
      if (node) node.gain.value = eqGains[i] || 0;
    });
  }, [eqGains]);
  useEffect(() => {
    eqBandsRef.current.forEach((node, i) => {
      if (node && eqQValues[i] != null) node.Q.value = eqQValues[i];
    });
  }, [eqQValues]);

  // ─── Vocal Doubler real-time param sync ──────────────────────
  useEffect(() => {
    if (!doublerDryRef.current || !doublerWet1Ref.current || !doublerWet2Ref.current) return;
    if (doublerEnabled) {
      // dry = 1 - mix, each wet voice = mix * 0.5
      doublerDryRef.current.gain.value = 1 - doublerMix * 0.5;
      doublerWet1Ref.current.gain.value = doublerMix * 0.6;
      doublerWet2Ref.current.gain.value = doublerMix * 0.5;
    } else {
      doublerDryRef.current.gain.value = 1;
      doublerWet1Ref.current.gain.value = 0;
      doublerWet2Ref.current.gain.value = 0;
    }
  }, [doublerEnabled, doublerMix]);

  useEffect(() => {
    if (doublerDelay1Ref.current) doublerDelay1Ref.current.delayTime.value = doublerDelay1Ms / 1000;
    if (doublerDelay2Ref.current) doublerDelay2Ref.current.delayTime.value = doublerDelay2Ms / 1000;
  }, [doublerDelay1Ms, doublerDelay2Ms]);

  useEffect(() => {
    if (doublerLfo1Ref.current) doublerLfo1Ref.current.frequency.value = doublerRate;
    if (doublerLfo2Ref.current) doublerLfo2Ref.current.frequency.value = doublerRate * 1.37; // offset for natural feel
  }, [doublerRate]);

  useEffect(() => {
    // Update LFO depth (modulation amount) and detune offsets
    if (doublerLfoGain1Ref.current) doublerLfoGain1Ref.current.gain.value = doublerDepth;
    if (doublerLfoGain2Ref.current) doublerLfoGain2Ref.current.gain.value = doublerDepth * 1.3;
    if (doublerDelay1Ref.current) {
      doublerDelay1Ref.current.delayTime.value = doublerDelay1Ms / 1000 + (doublerDetune1 * 0.00002);
    }
    if (doublerDelay2Ref.current) {
      doublerDelay2Ref.current.delayTime.value = doublerDelay2Ms / 1000 + (Math.abs(doublerDetune2) * 0.00002);
    }
  }, [doublerDetune1, doublerDetune2, doublerDelay1Ms, doublerDelay2Ms, doublerDepth]);

  useEffect(() => {
    // Mode presets
    if (!doublerEnabled) return;
    if (doublerMode === 'chorus') {
      setDoublerDetune1(7); setDoublerDetune2(-5);
      setDoublerDelay1Ms(18); setDoublerDelay2Ms(25);
      setDoublerDepth(0.002); setDoublerRate(0.8);
    } else if (doublerMode === 'harmony') {
      setDoublerDetune1(15); setDoublerDetune2(-12);
      setDoublerDelay1Ms(22); setDoublerDelay2Ms(30);
      setDoublerDepth(0.004); setDoublerRate(0.6);
    } else if (doublerMode === 'octave') {
      setDoublerDetune1(25); setDoublerDetune2(-20);
      setDoublerDelay1Ms(12); setDoublerDelay2Ms(35);
      setDoublerDepth(0.006); setDoublerRate(0.4);
    }
  }, [doublerMode, doublerEnabled]);

  // ─── Vocal Overlay callbacks ─────────────────────────────────
  // Import overlay from file
  const handleOverlayFileImport = useCallback(async (file: File) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    try {
      const arrayBuf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      setOverlayBuffer(decoded);
      setOverlayFileName(file.name);
      setOverlayTrimStart(0);
      setOverlayTrimEnd(decoded.duration);
      setOverlayEnabled(true);
    } catch (err) {
      console.error('Failed to decode overlay audio:', err);
    }
  }, []);

  // Start microphone recording
  const startOverlayRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micStreamRef.current = stream;
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType });
        const ctx = audioContextRef.current;
        if (!ctx) return;
        try {
          const arrayBuf = await blob.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuf);
          setOverlayBuffer(decoded);
          setOverlayFileName('הקלטה חיה');
          setOverlayTrimStart(0);
          setOverlayTrimEnd(decoded.duration);
          setOverlayEnabled(true);
        } catch (err) { console.error('Failed to decode recording:', err); }
        // Stop mic
        stream.getTracks().forEach(t => t.stop());
        micStreamRef.current = null;
      };
      recorder.start(200); // collect data every 200ms
      setIsRecording(true);
      setRecordingDuration(0);
      // Use the overlay offset as the sync point — record starts at current playback position
      setOverlayOffset(audioRef.current?.currentTime ?? 0);
      const startTime = Date.now();
      const timer = window.setInterval(() => setRecordingDuration((Date.now() - startTime) / 1000), 200);
      recordingTimerRef.current = timer;
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, []);

  const stopOverlayRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = 0; }
  }, []);

  // Play overlay in sync with main track
  const playOverlaySync = useCallback(() => {
    const ctx = audioContextRef.current;
    const buf = overlayBuffer;
    if (!ctx || !buf || !overlayEnabled) return;
    // Stop previous if playing
    try { overlaySourceRef.current?.stop(); } catch { /* already stopped */ }
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(overlayGainRef.current || ctx.destination);
    overlaySourceRef.current = source;
    const mainTime = audioRef.current?.currentTime ?? 0;
    const relativePos = mainTime - overlayOffset;
    if (relativePos >= 0 && relativePos < (overlayTrimEnd - overlayTrimStart)) {
      // Main track is within overlay range — start overlay from correct position
      source.start(0, overlayTrimStart + relativePos, overlayTrimEnd - overlayTrimStart - relativePos);
    } else if (relativePos < 0) {
      // Main track hasn't reached overlay yet — schedule overlay to start later
      source.start(ctx.currentTime + Math.abs(relativePos), overlayTrimStart, overlayTrimEnd - overlayTrimStart);
    }
    setOverlayIsPlaying(true);
    source.onended = () => setOverlayIsPlaying(false);
  }, [overlayBuffer, overlayEnabled, overlayOffset, overlayTrimStart, overlayTrimEnd]);

  const stopOverlaySync = useCallback(() => {
    try { overlaySourceRef.current?.stop(); } catch { /* ok */ }
    setOverlayIsPlaying(false);
  }, []);

  // Sync overlay volume
  useEffect(() => {
    if (overlayGainRef.current) overlayGainRef.current.gain.value = overlayEnabled ? overlayVolume : 0;
  }, [overlayVolume, overlayEnabled]);

  // Auto-play/stop overlay with main track
  useEffect(() => {
    if (!overlayBuffer || !overlayEnabled) return;
    if (isPlaying) {
      playOverlaySync();
    } else {
      stopOverlaySync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      micStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ─── Frequency Spectrum (Equalizer) Visualization ────────────
  const drawEqualizer = useCallback(() => {
    const canvas = eqCanvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.fillRect(0, 0, W, H);

    const barCount = 64;
    const step = Math.floor(bufferLength / barCount);

    if (eqVizStyle === 'bars') {
      const barW = W / barCount;
      const gap = 1;
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const barH = (avg / 255) * H * 0.9;
        const hue = 200 + (i / barCount) * 120;
        ctx.fillStyle = `hsla(${hue}, 80%, 60%, 0.85)`;
        ctx.fillRect(i * barW + gap / 2, H - barH, barW - gap, barH);
        ctx.fillStyle = `hsla(${hue}, 90%, 75%, 0.5)`;
        ctx.fillRect(i * barW + gap / 2, H - barH, barW - gap, 2);
      }
    } else if (eqVizStyle === 'mirror') {
      const barW = W / barCount;
      const gap = 1;
      const mid = H / 2;
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const barH = (avg / 255) * mid * 0.85;
        const hue = 280 + (i / barCount) * 80;
        ctx.fillStyle = `hsla(${hue}, 75%, 55%, 0.8)`;
        ctx.fillRect(i * barW + gap / 2, mid - barH, barW - gap, barH);
        ctx.fillStyle = `hsla(${hue}, 60%, 50%, 0.4)`;
        ctx.fillRect(i * barW + gap / 2, mid, barW - gap, barH * 0.7);
      }
      ctx.strokeStyle = 'hsla(280, 80%, 70%, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    } else if (eqVizStyle === 'wave') {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const y = H - (avg / 255) * H * 0.85;
        const x = (i / barCount) * W;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'hsla(160, 80%, 60%, 0.7)');
      grad.addColorStop(1, 'hsla(200, 80%, 40%, 0.1)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'hsla(160, 90%, 70%, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const y = H - (avg / 255) * H * 0.85;
        const x = (i / barCount) * W;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (eqVizStyle === 'circle') {
      const cx = W / 2;
      const cy = H / 2;
      const maxR = Math.min(W, H) * 0.45;
      const minR = maxR * 0.3;
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
        const r = minR + (avg / 255) * (maxR - minR);
        const x1 = cx + Math.cos(angle) * minR;
        const y1 = cy + Math.sin(angle) * minR;
        const x2 = cx + Math.cos(angle) * r;
        const y2 = cy + Math.sin(angle) * r;
        const hue = (i / barCount) * 360;
        ctx.strokeStyle = `hsla(${hue}, 80%, 60%, 0.8)`;
        ctx.lineWidth = Math.max(1, (W / barCount) * 0.6);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.strokeStyle = 'hsla(220, 60%, 50%, 0.2)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, minR, 0, Math.PI * 2); ctx.stroke();
    } else if (eqVizStyle === 'spectrum') {
      // Smooth spectrum curve with glowing peaks
      const points: {x:number,y:number}[] = [];
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const x = (i / (barCount - 1)) * W;
        const y = H - (avg / 255) * H * 0.85;
        points.push({x, y});
      }
      // Filled gradient area
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (const p of points) ctx.lineTo(p.x, p.y);
      ctx.lineTo(W, H);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, 'hsla(280, 80%, 50%, 0.3)');
      grad.addColorStop(0.33, 'hsla(200, 80%, 50%, 0.3)');
      grad.addColorStop(0.66, 'hsla(120, 80%, 50%, 0.3)');
      grad.addColorStop(1, 'hsla(40, 80%, 50%, 0.3)');
      ctx.fillStyle = grad;
      ctx.fill();
      // Smooth curve on top
      ctx.strokeStyle = 'hsla(200, 90%, 70%, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const cpx = (points[i].x + points[i + 1].x) / 2;
        const cpy = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, cpx, cpy);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
      // Peak dots
      for (const p of points) {
        if (p.y < H * 0.5) {
          ctx.fillStyle = 'hsla(50, 100%, 70%, 0.9)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (eqVizStyle === 'flame') {
      // Flame-style rising columns with gradient fire
      const barW = W / barCount;
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const barH = (avg / 255) * H * 0.92;
        const x = i * barW;
        const grad = ctx.createLinearGradient(x, H, x, H - barH);
        grad.addColorStop(0, 'hsla(0, 100%, 50%, 0.9)');
        grad.addColorStop(0.35, 'hsla(30, 100%, 55%, 0.8)');
        grad.addColorStop(0.65, 'hsla(50, 100%, 60%, 0.6)');
        grad.addColorStop(1, 'hsla(60, 100%, 80%, 0.1)');
        ctx.fillStyle = grad;
        // Rounded top
        const r = Math.min(barW * 0.4, barH * 0.15);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, H);
        ctx.lineTo(x + 0.5, H - barH + r);
        ctx.quadraticCurveTo(x + 0.5, H - barH, x + barW / 2, H - barH);
        ctx.quadraticCurveTo(x + barW - 0.5, H - barH, x + barW - 0.5, H - barH + r);
        ctx.lineTo(x + barW - 0.5, H);
        ctx.closePath();
        ctx.fill();
      }
    } else if (eqVizStyle === 'radar') {
      // Rotating radar sweep with afterglow
      const cx = W / 2;
      const cy = H / 2;
      const maxR = Math.min(W, H) * 0.45;
      // Concentric grid
      for (let r = 1; r <= 3; r++) {
        ctx.strokeStyle = `hsla(140, 60%, 40%, ${0.15})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, maxR * r / 3, 0, Math.PI * 2); ctx.stroke();
      }
      // Data as filled polygon
      ctx.beginPath();
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
        const r = (avg / 255) * maxR;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const rGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      rGrad.addColorStop(0, 'hsla(140, 80%, 60%, 0.4)');
      rGrad.addColorStop(1, 'hsla(140, 60%, 40%, 0.1)');
      ctx.fillStyle = rGrad;
      ctx.fill();
      ctx.strokeStyle = 'hsla(140, 90%, 65%, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (eqVizStyle === 'dots') {
      // Floating dots / particles
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
        const avg = sum / step;
        const x = (i / barCount) * W + (W / barCount) / 2;
        const baseY = H;
        const dotCount = Math.floor((avg / 255) * 8) + 1;
        const hue = (i / barCount) * 360;
        for (let d = 0; d < dotCount; d++) {
          const y = baseY - (d + 1) * (H / 10) - (avg / 255) * (d * 2);
          const radius = 1.5 + (avg / 255) * 2.5;
          const alpha = 0.3 + (1 - d / dotCount) * 0.6;
          ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
          ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    eqAnimFrameRef.current = requestAnimationFrame(drawEqualizer);
  }, [eqVizStyle]);

  useEffect(() => {
    if (isPlaying && showEqualizer && analyserRef.current) {
      drawEqualizer();
    }
    return () => {
      if (eqAnimFrameRef.current) cancelAnimationFrame(eqAnimFrameRef.current);
    };
  }, [isPlaying, showEqualizer, drawEqualizer]);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, width, height);

    // Gradient background (RTL: right-to-left)
    const isActive = presetId !== 'off';
    const grad = ctx.createLinearGradient(width, 0, 0, 0);
    if (isActive) {
      grad.addColorStop(0, 'rgba(34, 197, 94, 0.08)');
      grad.addColorStop(0.5, 'rgba(99, 102, 241, 0.08)');
      grad.addColorStop(1, 'rgba(139, 92, 246, 0.08)');
    } else {
      grad.addColorStop(0, 'rgba(99, 102, 241, 0.1)');
      grad.addColorStop(1, 'rgba(139, 92, 246, 0.1)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Center line
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Waveform line (RTL: right-to-left)
    ctx.lineWidth = 2;
    const gradient = ctx.createLinearGradient(width, 0, 0, 0);
    if (isPlaying) {
      gradient.addColorStop(0, isActive ? '#22c55e' : '#6366f1');
      gradient.addColorStop(1, isActive ? '#3b82f6' : '#8b5cf6');
    } else {
      gradient.addColorStop(0, '#94a3b8');
      gradient.addColorStop(1, '#94a3b8');
    }
    ctx.strokeStyle = gradient;
    ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = width; // RTL: start drawing from right
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x -= sliceWidth;
    }
    ctx.lineTo(0, height / 2);
    ctx.stroke();

    // Progress overlay (RTL: fills from right)
    if (duration > 0) {
      const progressFraction = currentTime / duration;
      const progressW = progressFraction * width;
      const playheadX = width - progressW;
      ctx.fillStyle = isActive ? 'rgba(34,197,94,0.12)' : 'rgba(99, 102, 241, 0.15)';
      ctx.fillRect(playheadX, 0, progressW, height);

      // Playhead line
      ctx.strokeStyle = isActive ? '#22c55e' : '#6366f1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }

    animFrameRef.current = requestAnimationFrame((timestamp) => {
      // Throttle to ~15fps (66ms between frames)
      if (timestamp - lastDrawTimeRef.current < 66) {
        animFrameRef.current = requestAnimationFrame(drawWaveform);
        return;
      }
      lastDrawTimeRef.current = timestamp;
      drawWaveform();
    });
  }, [isPlaying, currentTime, duration, presetId]);

  useEffect(() => {
    if (isPlaying && analyserRef.current) {
      drawWaveform();
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, drawWaveform]);

  // ─── Initialize advanced processing modules ──────────────────
  useEffect(() => {
    const ctx = audioContextRef.current;
    const source = sourceRef.current;
    const gain = gainNodeRef.current;
    if (!ctx || !source || !gain) return;

    // Lazy-import and initialize modules
    (async () => {
      const [rnnoiseModule, spectralModule, vadModule, deHumModule, lufsModule] = await Promise.all([
        import('@/lib/rnnoiseProcessor'),
        import('@/lib/spectralGate'),
        import('@/lib/voiceActivityDetection'),
        import('@/lib/deHum'),
        import('@/lib/loudnessNorm'),
      ]);

      // These modules connect input→processing→output internally
      // We use the analyser as a tap point (non-destructive)
      if (!aiDenoiseRef.current) {
        aiDenoiseRef.current = await rnnoiseModule.createNoiseSuppressionChain(ctx, gain, ctx.destination);
      }
      if (!spectralGateRef.current) {
        spectralGateRef.current = spectralModule.createSpectralGate(ctx, gain, ctx.destination);
      }
      if (!vadRef.current) {
        const vad = vadModule.createVAD(ctx, gain, ctx.destination);
        vad.onStateChange((state) => {
          setVadIsSpeech(state.isSpeech);
        });
        vadRef.current = vad;
      }
      if (!deHumRef.current) {
        deHumRef.current = deHumModule.createDeHum(ctx, gain, ctx.destination);
      }
      if (!lufsRef.current) {
        const lufs = lufsModule.createLoudnessNorm(ctx, gain, ctx.destination);
        lufs.onUpdate((state) => {
          setLufsMomentary(state.momentary);
          setLufsShortTerm(state.shortTerm);
          setLufsIntegrated(state.integrated);
        });
        lufsRef.current = lufs;
      }
    })();
  }, [isPlaying]); // Re-check when playing starts (audio context gets created)

  // ─── Cleanup AudioContext on unmount ─────────────────────────
  useEffect(() => {
    return () => {
      aiDenoiseRef.current?.destroy();
      spectralGateRef.current?.destroy();
      vadRef.current?.destroy();
      deHumRef.current?.destroy();
      lufsRef.current?.destroy();
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  // ─── Decode audio → peaks for static waveform ───────────────
  useEffect(() => {
    if (!audioUrl) { setPeaksData(null); setDecodedDuration(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(audioUrl);
        if (cancelled) return;
        const arrayBuf = await resp.arrayBuffer();
        if (cancelled) return;
        const offlineCtx = new OfflineAudioContext(1, 1, 44100);
        const decoded = await offlineCtx.decodeAudioData(arrayBuf);
        if (cancelled) return;

        // Use decoded.duration as the authoritative duration (fixes WebM blob issues)
        const realDuration = decoded.duration;
        if (realDuration && isFinite(realDuration) && realDuration > 0) {
          setDuration(realDuration);
          setDecodedDuration(realDuration);
        }

        const raw = decoded.getChannelData(0);
        const BARS = 300;
        const peaks = new Float32Array(BARS);
        const blockSize = Math.floor(raw.length / BARS);
        for (let i = 0; i < BARS; i++) {
          let sum = 0;
          const start = i * blockSize;
          for (let j = start; j < start + blockSize && j < raw.length; j++) {
            sum += Math.abs(raw[j]);
          }
          peaks[i] = sum / blockSize;
        }
        // Normalize to 0-1
        const max = Math.max(...peaks) || 1;
        for (let i = 0; i < BARS; i++) peaks[i] /= max;
        if (!cancelled) setPeaksData(peaks);
      } catch { /* decode not supported for this format */ }
    })();
    return () => { cancelled = true; };
  }, [audioUrl]);

  // Use the best available duration (decoded is most reliable)
  const effectiveDuration = decodedDuration > 0 ? decodedDuration : duration;

  // ─── Draw static waveform with speaker colors + playhead ────
  const drawStaticWaveform = useCallback(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas || !peaksData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const BARS = peaksData.length;
    const barW = W / BARS;
    const gap = Math.max(1, barW * 0.15);
    const dur = effectiveDuration || 1;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = 'rgba(241, 245, 249, 0.5)';
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < BARS; i++) {
      // RTL: bar 0 = right edge
      const x = W - (i + 1) * barW;
      const barH = Math.max(2, peaksData[i] * (H * 0.85));
      const y = (H - barH) / 2;

      // Determine bar time position for speaker coloring
      const barTimeFraction = i / BARS;
      const barTime = barTimeFraction * dur;

      // Find speaker for this time
      let color = 'rgba(99, 102, 241, 0.6)'; // default indigo
      if (speakerSegments?.length) {
        for (const seg of speakerSegments) {
          if (barTime >= seg.start && barTime <= seg.end) {
            color = speakerColorMap[seg.speaker] || color;
            break;
          }
        }
      }

      // Dim bars after playhead (already played = full, upcoming = dimmed)
      const playFraction = dur > 0 ? currentTime / dur : 0;
      const opacity = barTimeFraction <= playFraction ? 1.0 : 0.35;

      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.fillRect(x + gap / 2, y, barW - gap, barH);
    }
    ctx.globalAlpha = 1.0;

    // Playhead line (thin red line)
    if (dur > 0) {
      const playFraction = currentTime / dur;
      const headX = W - playFraction * W; // RTL
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(headX, 0);
      ctx.lineTo(headX, H);
      ctx.stroke();
    }

    // Bookmark pins on waveform
    if (dur > 0 && bookmarks.length > 0) {
      for (const bm of bookmarks) {
        const fraction = bm.time / dur;
        const bx = W - fraction * W; // RTL
        // Vertical dashed line
        ctx.strokeStyle = bm.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(bx, 0);
        ctx.lineTo(bx, H);
        ctx.stroke();
        ctx.setLineDash([]);
        // Pin triangle at top
        ctx.fillStyle = bm.color;
        ctx.beginPath();
        ctx.moveTo(bx, 0);
        ctx.lineTo(bx - 5, 10);
        ctx.lineTo(bx + 5, 10);
        ctx.closePath();
        ctx.fill();
      }
    }
  }, [currentTime, effectiveDuration, peaksData, speakerSegments, speakerColorMap, bookmarks]);

  // Redraw static waveform on time/peaks change
  useEffect(() => {
    if (staticAnimFrameRef.current) cancelAnimationFrame(staticAnimFrameRef.current);
    staticAnimFrameRef.current = requestAnimationFrame(drawStaticWaveform);
    return () => { if (staticAnimFrameRef.current) cancelAnimationFrame(staticAnimFrameRef.current); };
  }, [drawStaticWaveform]);

  // ─── External time sync ──────────────────────────────────────
  useEffect(() => {
    if (isSyncEnabled && externalTime !== undefined && audioRef.current && Math.abs(audioRef.current.currentTime - externalTime) > 0.2) {
      audioRef.current.currentTime = externalTime;
      setCurrentTime(externalTime);
    }
  }, [externalTime, isSyncEnabled]);

  // ─── Audio event handlers ────────────────────────────────────
  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    const t = audioRef.current.currentTime;

    if (focusEnabled && focusLoop && hasValidFocusRange && t >= focusEnd - 0.01) {
      audioRef.current.currentTime = focusStart;
      setCurrentTime(focusStart);
      onTimeUpdate?.(focusStart);
      return;
    }

    setCurrentTime(t);
    onTimeUpdate?.(t);
  }, [onTimeUpdate, focusEnabled, focusLoop, hasValidFocusRange, focusEnd, focusStart]);

  const handleLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    const d = audioRef.current.duration;
    if (d && isFinite(d) && d > 0) setDuration(d);
  }, []);

  // WebM blobs from MediaRecorder often report wrong duration initially
  const handleDurationChange = useCallback(() => {
    if (!audioRef.current) return;
    const d = audioRef.current.duration;
    if (d && isFinite(d) && d > 0) setDuration(d);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    // Fix duration from actual playback end time
    if (audioRef.current) {
      const t = audioRef.current.currentTime;
      if (t > duration) setDuration(t);
    }
  }, [duration]);

  // ─── Playback controls ──────────────────────────────────────
  const togglePlay = useCallback(() => {
    if (!audioRef.current || !audioUrl) return;
    initAudioContext();
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  }, [isPlaying, audioUrl, initAudioContext]);

  const seek = useCallback((seconds: number) => {
    if (!audioRef.current) return;
    const t = Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds));
    audioRef.current.currentTime = t;
    setCurrentTime(t);
  }, [duration]);

  const seekTo = useCallback((time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
    onTimeUpdate?.(time);
  }, [onTimeUpdate]);

  const handleSliderSeek = useCallback((value: number[]) => seekTo(value[0]), [seekTo]);

  const handleVolumeChange = useCallback((value: number[]) => {
    const v = value[0];
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
    setIsMuted(v === 0);
  }, []);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    if (isMuted) { audioRef.current.volume = volume || 0.5; setIsMuted(false); }
    else { audioRef.current.volume = 0; setIsMuted(true); }
  }, [isMuted, volume]);

  const cycleSpeed = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(speed);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [speed]);

  const setPlaybackSpeed = useCallback((next: number) => {
    const clamped = clampSpeed(next);
    setSpeed(clamped);
    if (audioRef.current) {
      const effective = (focusEnabled && hasValidFocusRange && !isWithinFocusedSegment) ? 1 : clamped;
      audioRef.current.playbackRate = effective;
    }
  }, [focusEnabled, hasValidFocusRange, isWithinFocusedSegment]);

  const nudgeSpeed = useCallback((delta: number) => {
    setPlaybackSpeed(speed + delta);
  }, [setPlaybackSpeed, speed]);

  const markFocusStartFromCurrent = useCallback(() => {
    setFocusStart(currentTime);
    if (focusEnd <= currentTime) {
      setFocusEnd(Math.min(effectiveDuration || currentTime + 0.1, currentTime + 10));
    }
  }, [currentTime, focusEnd, effectiveDuration]);

  const markFocusEndFromCurrent = useCallback(() => {
    const nextEnd = Math.max(currentTime, focusStart + 0.1);
    setFocusEnd(nextEnd);
  }, [currentTime, focusStart]);

  const restart = useCallback(() => {
    seekTo(0);
    if (!isPlaying) togglePlay();
  }, [seekTo, isPlaying, togglePlay]);

  const jumpToWord = useCallback((direction: 'prev' | 'next') => {
    if (!wordTimings.length) return;
    const targetIdx = direction === 'next'
      ? Math.min(currentWordIndex + 1, wordTimings.length - 1)
      : Math.max(currentWordIndex - 1, 0);
    seekTo(wordTimings[targetIdx].start);
  }, [wordTimings, currentWordIndex, seekTo]);

  // ─── Keyboard Shortcuts ──────────────────────────────────────
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  const volumeUp = useCallback(() => {
    const v = Math.min(1, volume + 0.05);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
    setIsMuted(false);
  }, [volume]);

  const volumeDown = useCallback(() => {
    const v = Math.max(0, volume - 0.05);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
    if (v === 0) setIsMuted(true);
  }, [volume]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't interfere with input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      // ── Play / Pause ──
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      // ── Seek: arrows without modifiers = ±5s ──
      else if (e.code === 'ArrowLeft' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        seek(5); // RTL: left = forward in time
      } else if (e.code === 'ArrowRight' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        seek(-5); // RTL: right = backward in time
      }
      // ── Seek: Ctrl+arrows = ±15s (large jump) ──
      else if (e.code === 'ArrowLeft' && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        seek(15); // RTL
      } else if (e.code === 'ArrowRight' && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        seek(-15); // RTL
      }
      // ── Word navigation: Shift+arrows ──
      else if (e.code === 'ArrowLeft' && e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        jumpToWord('next'); // RTL: left = forward
      } else if (e.code === 'ArrowRight' && e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        jumpToWord('prev'); // RTL: right = backward
      }
      // ── Fine seek: , and . = ±0.5s (frame-by-frame) ──
      else if (e.code === 'Comma') {
        e.preventDefault();
        seek(0.5); // RTL-aware: , = forward
      } else if (e.code === 'Period') {
        e.preventDefault();
        seek(-0.5); // RTL-aware: . = backward
      }
      // ── Volume: Up / Down arrows ──
      else if (e.code === 'ArrowUp') {
        e.preventDefault();
        volumeUp();
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        volumeDown();
      }
      // ── Mute toggle ──
      else if (e.code === 'KeyM' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleMute();
      }
      // ── Speed: [ = slower, ] = faster, \ = reset to 1x ──
      else if (e.code === 'BracketLeft' && !e.ctrlKey) {
        e.preventDefault();
        nudgeSpeed(-0.25);
      } else if (e.code === 'BracketRight' && !e.ctrlKey) {
        e.preventDefault();
        nudgeSpeed(0.25);
      } else if (e.code === 'Backslash' && !e.ctrlKey) {
        e.preventDefault();
        setPlaybackSpeed(1);
      }
      // ── Home = restart, End = jump to end ──
      else if (e.code === 'Home') {
        e.preventDefault();
        seekTo(0);
      } else if (e.code === 'End') {
        e.preventDefault();
        seekTo(Math.max(0, (effectiveDuration || duration) - 0.5));
      }
      // ── Ctrl+R = restart and play ──
      else if (e.code === 'KeyR' && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        restart();
      }
      // ── A/B focus marks ──
      else if (e.code === 'KeyA' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        markFocusStartFromCurrent();
      } else if (e.code === 'KeyB' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        markFocusEndFromCurrent();
      } else if (e.code === 'KeyL' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setFocusLoop(prev => !prev);
      }
      // ── ? = toggle keyboard help ──
      else if (e.code === 'Slash' && e.shiftKey) {
        e.preventDefault();
        setShowKeyboardHelp(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, seek, seekTo, jumpToWord, restart, toggleMute, volumeUp, volumeDown, nudgeSpeed, setPlaybackSpeed, markFocusStartFromCurrent, markFocusEndFromCurrent, effectiveDuration, duration]);

  const formatTime = (t: number) => {
    if (!isFinite(t)) return '00:00';
    const m = Math.floor(t / 60).toString().padStart(2, '0');
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleDownload = useCallback(() => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `recording-${Date.now()}.webm`;
    a.click();
  }, [audioUrl]);

  const exportFocusedProcessedSegment = useCallback(async () => {
    if (!audioUrl || !hasValidFocusRange || !effectiveDuration) return;

    const startSec = Math.max(0, Math.min(focusStart, effectiveDuration - 0.05));
    const endSec = Math.max(startSec + 0.05, Math.min(focusEnd, effectiveDuration));

    const resp = await fetch(audioUrl);
    const arrayBuf = await resp.arrayBuffer();
    const decodeCtx = new OfflineAudioContext(1, 1, 44100);
    const decoded = await decodeCtx.decodeAudioData(arrayBuf);

    const sampleRate = decoded.sampleRate;
    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.min(Math.floor(endSec * sampleRate), decoded.length);
    const length = Math.max(1, endSample - startSample);

    const sourceData = decoded.getChannelData(0).slice(startSample, endSample);
    const segBuffer = new AudioBuffer({ length, sampleRate, numberOfChannels: 1 });
    segBuffer.copyToChannel(sourceData, 0, 0);

    const offline = new OfflineAudioContext(1, length, sampleRate);
    const src = offline.createBufferSource();
    src.buffer = segBuffer;

    const deRumble = offline.createBiquadFilter();
    deRumble.type = 'highpass';
    deRumble.frequency.value = enhancementSettings.deRumbleFreq;
    deRumble.Q.value = 0.8;

    const highpass = offline.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = enhancementSettings.hp;
    highpass.Q.value = 0.7;

    const lowpass = offline.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = enhancementSettings.lp;
    lowpass.Q.value = 0.7;

    const notch = offline.createBiquadFilter();
    notch.type = 'notch';
    if (humNotchEnabled && !isBypassEnhancement && enhancementStrength > 10) {
      notch.frequency.value = Number(humNotchFreq);
      notch.Q.value = 10;
    } else {
      notch.frequency.value = 10;
      notch.Q.value = 0.0001;
    }

    const voice = offline.createBiquadFilter();
    voice.type = 'peaking';
    voice.frequency.value = 3000;
    voice.Q.value = enhancementSettings.vbQ;
    voice.gain.value = enhancementSettings.vbGain;

    const deSibilance = offline.createBiquadFilter();
    deSibilance.type = 'peaking';
    deSibilance.frequency.value = 6500;
    deSibilance.Q.value = 2.5;
    deSibilance.gain.value = enhancementSettings.deSibilanceGain;

    const presence = offline.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3200;
    presence.Q.value = 1.2;
    presence.gain.value = enhancementSettings.presenceGain;

    const warmth = offline.createBiquadFilter();
    warmth.type = 'peaking';
    warmth.frequency.value = 260;
    warmth.Q.value = 0.9;
    warmth.gain.value = enhancementSettings.warmthGain;

    const compressor = offline.createDynamicsCompressor();
    compressor.threshold.value = enhancementSettings.cThresh;
    compressor.ratio.value = enhancementSettings.cRatio;
    compressor.knee.value = enhancementSettings.cKnee;
    compressor.attack.value = enhancementSettings.cAttack;
    compressor.release.value = enhancementSettings.cRelease;

    src.connect(deRumble);
    deRumble.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(notch);
    notch.connect(voice);
    voice.connect(deSibilance);
    deSibilance.connect(presence);
    presence.connect(warmth);
    warmth.connect(compressor);
    compressor.connect(offline.destination);

    src.start(0);
    const rendered = await offline.startRendering();
    const wavBuffer = encodeWavFromFloat32(rendered.getChannelData(0), sampleRate);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focused-segment-${Math.round(startSec)}-${Math.round(endSec)}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }, [
    audioUrl,
    hasValidFocusRange,
    effectiveDuration,
    focusStart,
    focusEnd,
    enhancementSettings,
    humNotchEnabled,
    humNotchFreq,
    isBypassEnhancement,
    enhancementStrength,
  ]);

  useEffect(() => {
    if (!peaksData || !effectiveDuration) {
      setProblemSegments([]);
      return;
    }

    const bars = peaksData.length;
    if (!bars) {
      setProblemSegments([]);
      return;
    }

    const found: ProblemSegment[] = [];
    const pushSegment = (issue: IssueType, i: number, severity: number) => {
      const start = (i / bars) * effectiveDuration;
      const end = ((i + 1) / bars) * effectiveDuration;
      const prev = found[found.length - 1];
      if (prev && prev.issueType === issue && start - prev.end < 0.6) {
        prev.end = end;
        prev.severity = Math.max(prev.severity, severity);
        return;
      }
      found.push({
        id: `${issue}-${i}`,
        issueType: issue,
        start,
        end,
        severity,
      });
    };

    for (let i = 1; i < bars - 1; i++) {
      const amp = peaksData[i];
      const roughness = Math.abs(peaksData[i] - peaksData[i - 1]) + Math.abs(peaksData[i] - peaksData[i + 1]);

      if (amp > 0.96) {
        pushSegment('clipping', i, Math.min(1, (amp - 0.96) / 0.04));
      } else if (amp < 0.06) {
        pushSegment('low-volume', i, Math.min(1, (0.06 - amp) / 0.06));
      } else if (amp < 0.35 && roughness > 0.22) {
        pushSegment('hiss', i, Math.min(1, (roughness - 0.22) / 0.5));
      }
    }

    setProblemSegments(found.slice(0, 25));
  }, [peaksData, effectiveDuration]);

  // Volume icon selection
  const VolumeIcon = isMuted ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  useEffect(() => {
    if (effectiveDuration > 0 && focusEnd <= 0) {
      setFocusEnd(effectiveDuration);
    }
  }, [effectiveDuration, focusEnd]);

  useEffect(() => {
    if (!audioRef.current) return;
    const effective = (focusEnabled && hasValidFocusRange && !isWithinFocusedSegment) ? 1 : speed;
    audioRef.current.playbackRate = effective;
  }, [speed, focusEnabled, hasValidFocusRange, isWithinFocusedSegment]);

  if (!audioUrl) {
    if (compact) return null;
    return (
      <Card className="p-8 text-center" dir="rtl">
        <AudioLines className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold mb-2">אין קובץ אודיו</h3>
        <p className="text-muted-foreground text-sm">הקלט או העלה קובץ אודיו כדי להשתמש בנגן הסינכרוני</p>
      </Card>
    );
  }

  const Wrapper = compact ? 'div' as const : Card;
  const wrapperClass = compact
    ? 'p-3 rounded-xl border bg-gradient-to-l from-primary/5 to-transparent space-y-3'
    : `p-4 space-y-3 ${isExpanded ? 'fixed inset-4 z-50 overflow-auto' : ''}`;

  // ─── Mixer Panel (extracted for split layout) ───────────────
  const mixerPanel = (
    <div className="space-y-2 rounded-lg border bg-background/40 p-2 group/panel-noise">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary no-theme-icon" />
          הפחתת רעש חכמה
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 transition-opacity group-hover/panel-noise:opacity-100 focus-visible:opacity-100"
            onClick={() => setIsNoisePanelCollapsed((v) => !v)}
            title={isNoisePanelCollapsed ? "הרחב פונקציות" : "מזער פונקציות"}
          >
            {isNoisePanelCollapsed
              ? <ChevronDown className="w-3.5 h-3.5 no-theme-icon" />
              : <ChevronUp className="w-3.5 h-3.5 no-theme-icon" />}
          </Button>
          <Label className="text-[11px] text-muted-foreground">השוואת מקור A/B</Label>
          <Switch checked={isBypassEnhancement} onCheckedChange={setIsBypassEnhancement} />
          <Badge variant="outline" className="text-xs">
            {isBypassEnhancement ? 'מקור (Bypass)' : presetId === 'off' ? 'כבוי' : currentPreset.nameHe}
          </Badge>
        </div>
      </div>

      {isNoisePanelCollapsed && (
        <p className="text-[11px] text-muted-foreground px-1">פונקציות ניקוי רעש ממוזערות. רחף על הכרטיס ולחץ על האייקון כדי לפתוח שוב.</p>
      )}

      {!isNoisePanelCollapsed && (
        <>

      {/* Strength slider */}
      <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs">איכות מול בטיחות דיבור</span>
          <span className="text-xs font-mono tabular-nums">{enhancementStrength}%</span>
        </div>
        <Slider value={[enhancementStrength]} min={0} max={100} step={1} onValueChange={([v]) => setEnhancementStrength(v)} />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>שומר טבעיות</span>
          <span>ניקוי אגרסיבי</span>
        </div>
      </div>

      {/* Output Gain */}
      <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium flex items-center gap-1">
            <Volume2 className="w-3.5 h-3.5 no-theme-icon" />
            הגברת עוצמה (פיצוי אחרי עיבוד)
          </span>
          <span className="text-xs font-mono tabular-nums">{Math.round(outputGain * 100)}%</span>
        </div>
        <Slider value={[outputGain]} min={0} max={3} step={0.05} onValueChange={([v]) => setOutputGain(v)} />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>שקט</span>
          <span>רגיל (100%)</span>
          <span>הגברה מקסימלית (300%)</span>
        </div>
      </div>

      {/* User preset save */}
      <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
        <div className="flex items-center gap-1.5">
          <Input
            value={userPresetName}
            onChange={(e) => setUserPresetName(e.target.value)}
            placeholder="שם לפריסט אישי"
            className="h-7 text-xs"
          />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={saveCurrentAsUserPreset} disabled={!userPresetName.trim()}>
            <Save className="w-3 h-3 ml-1 no-theme-icon" />
            שמור
          </Button>
        </div>
        {userPresets.length > 0 && (
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {userPresets.map((preset) => (
              <div key={preset.id} className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] flex-1 justify-start" onClick={() => applyUserPreset(preset)}>
                  {preset.name}
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeUserPreset(preset.id)} title="מחק פריסט">
                  <Trash2 className="w-3 h-3 no-theme-icon" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preset Grid */}
      <div className="grid grid-cols-4 gap-1.5">
        {NOISE_PRESETS.map(p => {
          const Icon = p.icon;
          const isActive = presetId === p.id;
          return (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <button
                  className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs transition-all
                    ${isActive ? 'bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]' : 'border-border hover:bg-muted'}
                  `}
                  onClick={() => setPresetId(p.id)}
                >
                  <Icon className={`w-4 h-4 no-theme-icon ${isActive ? '' : 'text-muted-foreground'}`} />
                  <span className="font-medium leading-tight">{p.nameHe}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">{p.description}</TooltipContent>
            </Tooltip>
          );
        })}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs transition-all
                ${isManualMode ? 'bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]' : 'border-border hover:bg-muted'}
              `}
              onClick={() => setPresetId('manual')}
            >
              <Settings2 className={`w-4 h-4 no-theme-icon ${isManualMode ? '' : 'text-muted-foreground'}`} />
              <span className="font-medium leading-tight">ידני</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">שליטה ידנית מלאה</TooltipContent>
        </Tooltip>
      </div>

      {/* Preset active info */}
      {presetId !== 'off' && !isManualMode && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2 flex items-start gap-2">
          <Brain className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary no-theme-icon" />
          <div>
            <span className="font-medium">{currentPreset.description}</span>
            <span className="mx-1">—</span>
            {currentPreset.deRumble && <Badge variant="outline" className="text-[10px] ml-1">חתך רעש נמוך</Badge>}
            {currentPreset.deSibilance && <Badge variant="outline" className="text-[10px] ml-1">החלקת שין</Badge>}
            {currentPreset.presenceBoost && <Badge variant="outline" className="text-[10px] ml-1">חיזוק נוכחות</Badge>}
            {currentPreset.warmth && <Badge variant="outline" className="text-[10px] ml-1">חמימות</Badge>}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );


  return (
    <TooltipProvider delayDuration={300}>
      <Wrapper className={wrapperClass} dir="rtl">
        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onDurationChange={handleDurationChange}
          onEnded={handleEnded}
          preload="auto"
          crossOrigin="anonymous"
        />

        {/* ─── Layout edit toolbar (drag/resize widgets) ───── */}
        {!compact && (
          <div className="flex items-center justify-end gap-2 mb-2 px-1" dir="rtl">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={layoutEditMode ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setLayoutEditMode((v) => !v)}
                >
                  <LayoutGrid className="w-3.5 h-3.5 no-theme-icon" />
                  {layoutEditMode ? 'סיים עריכת פריסה' : 'ערוך פריסה'}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {layoutEditMode
                  ? 'הוויג\'טים נעולים אחרי לחיצה'
                  : 'הפעל גרירה ושינוי גודל של הוויג\'טים'}
              </TooltipContent>
            </Tooltip>
            {layoutEditMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-muted-foreground"
                    onClick={handleResetStudioLayout}
                  >
                    <RotateCw className="w-3.5 h-3.5 no-theme-icon" />
                    אפס פריסה
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">החזר לפריסת ברירת המחדל</TooltipContent>
              </Tooltip>
            )}
            {!layoutEditMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={handleResetStudioLayout}
                  >
                    <RotateCw className="w-3.5 h-3.5 no-theme-icon" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">אפס פריסה לברירת מחדל</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {/* ─── Draggable Widget Grid ───────────────────────── */}
        <ResponsiveReactGridLayout
          className={`studio-grid ${layoutEditMode ? 'is-editing' : ''}`}
          layouts={studioLayouts}
          breakpoints={{ lg: 996, md: 768, sm: 480 }}
          cols={{ lg: 12, md: 10, sm: 6 }}
          rowHeight={32}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          isDraggable={layoutEditMode}
          isResizable={layoutEditMode}
          draggableHandle=".studio-widget-handle"
          onLayoutChange={handleStudioLayoutChange}
          compactType="vertical"
          useCSSTransforms
        >
          {/* ═══ WIDGET 1: Player ═══ */}
          <div key="player" className="studio-widget-body">
            <div className="studio-widget-handle flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <GripVertical className="w-3.5 h-3.5 no-theme-icon" />
              <span>נגן סינכרוני</span>
            </div>
          <div className="space-y-3 order-1">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {!compact && <Waves className="w-5 h-5 text-primary no-theme-icon" />}
                {!compact && <h3 className="font-semibold text-sm">נגן סינכרוני</h3>}
                {compact && presetId !== 'off' && (
                  <Badge className="text-xs gap-1 bg-green-600 hover:bg-green-700">
                    <ShieldCheck className="w-3 h-3 no-theme-icon" />
                    {currentPreset.nameHe}
                  </Badge>
                )}
                {wordTimings.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{wordTimings.length} מילים</Badge>
                )}
                {!compact && presetId !== 'off' && (
                  <Badge className="text-xs gap-1 bg-green-600 hover:bg-green-700">
                    <ShieldCheck className="w-3 h-3 no-theme-icon" />
                    {currentPreset.nameHe}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {wordTimings.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isSyncEnabled ? 'default' : 'ghost'}
                        size="icon"
                        className={`h-7 w-7 ${isSyncEnabled ? 'bg-primary' : ''}`}
                        onClick={toggleSync}
                      >
                        {isSyncEnabled
                          ? <Link className="w-3.5 h-3.5 no-theme-icon" />
                          : <Unlink className="w-3.5 h-3.5 no-theme-icon" />
                        }
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {isSyncEnabled ? 'סינכרון פעיל — לחץ לכיבוי' : 'סינכרון כבוי — לחץ להפעלה'}
                    </TooltipContent>
                  </Tooltip>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} title="הורד אודיו">
                  <Download className="w-3.5 h-3.5 no-theme-icon" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsExpanded(!isExpanded)}>
                  {isExpanded ? <Minimize2 className="w-3.5 h-3.5 no-theme-icon" /> : <Maximize2 className="w-3.5 h-3.5 no-theme-icon" />}
                </Button>
              </div>
            </div>

            {/* ─── Frequency Spectrum Equalizer Visualization ─────── */}
            {showEqualizer && (
              <div className="space-y-1">
                <div
                  className="relative flex items-center justify-end gap-1"
                  onMouseEnter={() => setEqStyleBarHover(true)}
                  onMouseLeave={() => setEqStyleBarHover(false)}
                >
                  {eqStyleBarHover && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute -top-1 left-0 h-5 w-5 z-10 bg-background/80 backdrop-blur border shadow-sm"
                          onClick={() => setEqStyleBarCollapsed((v) => !v)}
                        >
                          {eqStyleBarCollapsed
                            ? <Maximize2 className="w-3 h-3 no-theme-icon" />
                            : <Minimize2 className="w-3 h-3 no-theme-icon" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {eqStyleBarCollapsed ? 'הרחב סרגל סגנונות' : 'מזער סרגל סגנונות'}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {!eqStyleBarCollapsed && ([
                    { id: 'bars' as const, label: '▥ עמודות' },
                    { id: 'mirror' as const, label: '⬍ מראה' },
                    { id: 'wave' as const, label: '〰 גל' },
                    { id: 'circle' as const, label: '◎ מעגלי' },
                    { id: 'spectrum' as const, label: '📈 ספקטרום' },
                    { id: 'flame' as const, label: '🔥 להבה' },
                    { id: 'radar' as const, label: '📡 רדאר' },
                    { id: 'dots' as const, label: '✦ נקודות' },
                  ]).map((s) => (
                    <button
                      key={s.id}
                      className={`px-1.5 py-0.5 rounded text-[9px] transition-all ${eqVizStyle === s.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
                      onClick={() => setEqVizStyle(s.id)}
                    >{s.label}</button>
                  ))}
                  {eqStyleBarCollapsed && (
                    <span className="text-[10px] text-muted-foreground px-2">סרגל סגנונות מוזער</span>
                  )}
                </div>
                {!eqCanvasCollapsed ? (
                  <div
                    className="relative"
                    onMouseEnter={() => setEqCanvasHover(true)}
                    onMouseLeave={() => setEqCanvasHover(false)}
                  >
                    {eqCanvasHover && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 left-1 h-6 w-6 z-10 bg-background/80 backdrop-blur border shadow-sm"
                            onClick={() => setEqCanvasCollapsed(true)}
                          >
                            <Minimize2 className="w-3.5 h-3.5 no-theme-icon" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">מזער ויזואליזציה</TooltipContent>
                      </Tooltip>
                    )}
                    <canvas
                      ref={eqCanvasRef}
                      className="w-full rounded-lg"
                      style={{ height: ['circle', 'radar', 'dots'].includes(eqVizStyle) ? 140 : (isExpanded ? 80 : 48), background: 'rgba(15, 23, 42, 0.4)' }}
                    />
                  </div>
                ) : (
                  <div
                    className="relative flex items-center justify-between rounded-lg bg-muted/30 px-3 py-1.5 border border-dashed"
                    onMouseEnter={() => setEqCanvasHover(true)}
                    onMouseLeave={() => setEqCanvasHover(false)}
                  >
                    <span className="text-[10px] text-muted-foreground">ויזואליזציה מוזערת</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setEqCanvasCollapsed(false)}
                        >
                          <Maximize2 className="w-3.5 h-3.5 no-theme-icon" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">הרחב ויזואליזציה</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            )}

            {/* ─── Static Waveform ── */}
            {!staticWaveCollapsed ? (
              <div
                className="relative"
                onMouseEnter={() => setStaticWaveHover(true)}
                onMouseLeave={() => setStaticWaveHover(false)}
              >
                {staticWaveHover && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1 left-1 h-6 w-6 z-10 bg-background/80 backdrop-blur border shadow-sm"
                        onClick={() => setStaticWaveCollapsed(true)}
                      >
                        <Minimize2 className="w-3.5 h-3.5 no-theme-icon" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">מזער גל סטטי</TooltipContent>
                  </Tooltip>
                )}
                <canvas
                  ref={staticCanvasRef}
                  className="w-full rounded-lg cursor-pointer bg-muted/30"
                  style={{ height: isExpanded ? 120 : 80 }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = rect.right - e.clientX;
                    const time = (x / rect.width) * effectiveDuration;
                    if (e.ctrlKey || e.metaKey) {
                      addBookmark(time);
                    } else {
                      seekTo(time);
                    }
                  }}
                />
              </div>
            ) : (
              <div
                className="relative flex items-center justify-between rounded-lg bg-muted/30 px-3 py-1.5 border border-dashed"
                onMouseEnter={() => setStaticWaveHover(true)}
                onMouseLeave={() => setStaticWaveHover(false)}
              >
                <span className="text-[10px] text-muted-foreground">גל סטטי מוזער</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setStaticWaveCollapsed(false)}
                    >
                      <Maximize2 className="w-3.5 h-3.5 no-theme-icon" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">הרחב גל סטטי</TooltipContent>
                </Tooltip>
              </div>
            )}

            {/* ─── Live Waveform Canvas ── */}
            {isPlaying && (
              <canvas
                ref={canvasRef}
                className="w-full rounded-lg cursor-pointer bg-transparent"
                height={isExpanded ? 50 : 32}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = rect.right - e.clientX;
                  seekTo((x / rect.width) * effectiveDuration);
                }}
              />
            )}

            {/* ─── Speaker Legend ── */}
            {speakerSegments && speakerSegments.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-end">
                {Object.entries(speakerColorMap).map(([speaker, color]) => (
                  <div key={speaker} className="flex items-center gap-1 text-xs">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                    <span>{speaker}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ─── Bookmarks ── */}
            {bookmarks.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center" dir="rtl">
                <span className="text-[10px] text-muted-foreground">📌</span>
                {bookmarks.map((bm, i) => (
                  <div key={i} className="flex items-center gap-0.5">
                    {editingBookmarkIdx === i ? (
                      <input
                        className="h-5 w-24 text-[10px] px-1 rounded border bg-background"
                        defaultValue={bm.label}
                        autoFocus
                        onBlur={(e) => { updateBookmarkLabel(i, e.target.value); setEditingBookmarkIdx(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { updateBookmarkLabel(i, (e.target as HTMLInputElement).value); setEditingBookmarkIdx(null); } if (e.key === 'Escape') setEditingBookmarkIdx(null); }}
                      />
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] h-5 cursor-pointer hover:bg-muted gap-1"
                        style={{ borderColor: bm.color, color: bm.color }}
                        onClick={() => seekTo(bm.time)}
                        onDoubleClick={() => setEditingBookmarkIdx(i)}
                        title={`${formatTime(bm.time)} — דאבל קליק לשינוי שם`}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: bm.color }} />
                        {bm.label}
                      </Badge>
                    )}
                    <button
                      className="text-[10px] text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ opacity: 0.5 }}
                      onClick={() => removeBookmark(i)}
                      title="הסר סימנייה"
                    >×</button>
                  </div>
                ))}
                <span className="text-[9px] text-muted-foreground/60 mr-2">Ctrl+קליק על הגל להוספה</span>
              </div>
            )}

            {/* ─── Time Slider ── */}
            {!seekBarCollapsed ? (
              <div
                className="relative"
                onMouseEnter={() => setSeekBarHover(true)}
                onMouseLeave={() => setSeekBarHover(false)}
              >
                {seekBarHover && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute -top-3 left-0 h-5 w-5 z-10 bg-background/80 backdrop-blur border shadow-sm"
                        onClick={() => setSeekBarCollapsed(true)}
                      >
                        <Minimize2 className="w-3 h-3 no-theme-icon" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">מזער פס סינכרון</TooltipContent>
                  </Tooltip>
                )}
                <div className="flex items-center gap-3" dir="ltr">
                  <span className="text-xs text-muted-foreground font-mono min-w-[40px] text-center">{formatTime(effectiveDuration)}</span>
                  <Slider value={[currentTime]} max={effectiveDuration || 1} step={0.1} onValueChange={handleSliderSeek} className="flex-1" dir="rtl" />
                  <span className="text-xs text-muted-foreground font-mono min-w-[40px] text-center">{formatTime(currentTime)}</span>
                </div>
              </div>
            ) : (
              <div
                className="relative flex items-center justify-between rounded-lg bg-muted/30 px-3 py-1 border border-dashed"
                onMouseEnter={() => setSeekBarHover(true)}
                onMouseLeave={() => setSeekBarHover(false)}
              >
                <span className="text-[10px] text-muted-foreground font-mono">
                  {formatTime(currentTime)} / {formatTime(effectiveDuration)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setSeekBarCollapsed(false)}
                    >
                      <Maximize2 className="w-3.5 h-3.5 no-theme-icon" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">הרחב פס סינכרון</TooltipContent>
                </Tooltip>
              </div>
            )}

            {/* ─── Main Controls ── */}
            <div className="flex items-center justify-center gap-1">
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={restart}><RotateCcw className="w-4 h-4 no-theme-icon" /></Button>
              </TooltipTrigger><TooltipContent>התחל מההתחלה</TooltipContent></Tooltip>

              {wordTimings.length > 0 && isSyncEnabled && (
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => jumpToWord('prev')}><SkipForward className="w-4 h-4 no-theme-icon" /></Button>
                </TooltipTrigger><TooltipContent>מילה קודמת</TooltipContent></Tooltip>
              )}

              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => seek(-5)}><FastForward className="w-4 h-4 no-theme-icon" /></Button>
              </TooltipTrigger><TooltipContent>5 שניות אחורה</TooltipContent></Tooltip>

              <Button size="icon" className="h-10 w-10 rounded-full" onClick={togglePlay}>
                {isPlaying ? <Pause className="w-5 h-5 no-theme-icon" /> : <Play className="w-5 h-5 mr-0.5 no-theme-icon" />}
              </Button>

              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => seek(5)}><Rewind className="w-4 h-4 no-theme-icon" /></Button>
              </TooltipTrigger><TooltipContent>5 שניות קדימה</TooltipContent></Tooltip>

              {wordTimings.length > 0 && isSyncEnabled && (
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => jumpToWord('next')}><SkipBack className="w-4 h-4 no-theme-icon" /></Button>
                </TooltipTrigger><TooltipContent>מילה הבאה</TooltipContent></Tooltip>
              )}

              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs font-mono min-w-[46px]" onClick={() => setShowSpeedControl((v) => !v)}>
                  {speed.toFixed(2).replace(/\.00$/, '')}x
                </Button>
              </TooltipTrigger><TooltipContent>מהירות ניגון (לחץ לפתיחת סליידר)</TooltipContent></Tooltip>
            </div>

            {/* ─── Speed Control ── */}
            {showSpeedControl && (
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">מהירות ניגון מדויקת</p>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => nudgeSpeed(-0.05)}>-0.05</Button>
                    <Badge variant="secondary" className="text-xs font-mono">{speed.toFixed(2)}x</Badge>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => nudgeSpeed(0.05)}>+0.05</Button>
                  </div>
                </div>
                <Slider value={[speed]} min={0.5} max={2} step={0.01} onValueChange={([v]) => setPlaybackSpeed(v)} />
                <div className="flex flex-wrap gap-1 justify-end">
                  {QUICK_SPEED_OPTIONS.map((opt) => (
                    <Button key={opt} variant={Math.abs(speed - opt) < 0.001 ? 'default' : 'outline'} size="sm" className="h-6 px-2 text-[11px] font-mono" onClick={() => setPlaybackSpeed(opt)}>
                      {opt}x
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Focus Segment (A-B) ── */}
            {!compact && (
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3 group/panel-focus">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium">התמקדות בקטע (A-B)</Label>
                    <Badge variant="outline" className="text-[10px]">{formatTime(focusStart)} → {formatTime(focusEnd)}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 transition-opacity group-hover/panel-focus:opacity-100 focus-visible:opacity-100"
                      onClick={() => setIsFocusPanelCollapsed((v) => !v)}
                      title={isFocusPanelCollapsed ? "הרחב פונקציות" : "מזער פונקציות"}
                    >
                      {isFocusPanelCollapsed
                        ? <ChevronDown className="w-3.5 h-3.5 no-theme-icon" />
                        : <ChevronUp className="w-3.5 h-3.5 no-theme-icon" />}
                    </Button>
                    <Label className="text-[11px] text-muted-foreground">לופ</Label>
                    <Switch checked={focusLoop} onCheckedChange={setFocusLoop} />
                    <Label className="text-[11px] text-muted-foreground">מצב ממוקד</Label>
                    <Switch checked={focusEnabled} onCheckedChange={setFocusEnabled} />
                  </div>
                </div>
                {isFocusPanelCollapsed && (
                  <p className="text-[11px] text-muted-foreground">פונקציות ההתמקדות ממוזערות. רחף ולחץ על האייקון כדי להרחיב.</p>
                )}
                {!isFocusPanelCollapsed && (
                  <>
                <Slider
                  value={[focusStart, Math.max(focusStart + 0.1, focusEnd)]}
                  min={0}
                  max={Math.max(1, effectiveDuration || 1)}
                  step={0.1}
                  onValueChange={([a, b]) => {
                    const start = Math.max(0, Math.min(a, b - 0.1));
                    const end = Math.max(start + 0.1, b);
                    setFocusStart(start);
                    setFocusEnd(end);
                  }}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-6 px-2" onClick={markFocusStartFromCurrent}>קבע A מהמיקום הנוכחי</Button>
                    <Button variant="outline" size="sm" className="h-6 px-2" onClick={markFocusEndFromCurrent}>קבע B מהמיקום הנוכחי</Button>
                    <Button variant="outline" size="sm" className="h-6 px-2" onClick={exportFocusedProcessedSegment} disabled={!hasValidFocusRange}>
                      <Scissors className="w-3 h-3 ml-1 no-theme-icon" />
                      ייצוא קטע מעובד
                    </Button>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => seekTo(focusStart)}>נגן מ-A</Button>
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => { setFocusStart(0); setFocusEnd(Math.max(0.1, effectiveDuration || 1)); }}>
                      אפס טווח
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  כש"מצב ממוקד" פעיל, שינויי מהירות והפחתת רעש חלים רק בתוך הטווח שנבחר.
                </p>
                {problemSegments.length > 0 && (
                  <div className="space-y-1 rounded-md border bg-background/70 p-2">
                    <p className="text-[11px] font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-500 no-theme-icon" />
                      קטעים שדורשים תשומת לב ({problemSegments.length})
                    </p>
                    <div className="max-h-24 overflow-y-auto space-y-1">
                      {problemSegments.slice(0, 8).map((seg) => (
                        <button
                          key={seg.id}
                          type="button"
                          className="w-full text-right text-[11px] rounded border px-2 py-1 hover:bg-muted/60 transition-colors"
                          onClick={() => {
                            setFocusStart(seg.start);
                            setFocusEnd(Math.min(effectiveDuration || seg.end, seg.end + 0.6));
                            seekTo(seg.start);
                          }}
                        >
                          {seg.issueType === 'clipping' ? 'קליפינג' : seg.issueType === 'low-volume' ? 'עוצמה נמוכה' : 'רעש חד'}
                          <span className="mx-1">•</span>
                          {formatTime(seg.start)} - {formatTime(seg.end)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                  </>
                )}
              </div>
            )}

            {/* ─── Volume ── */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={toggleMute}>
                <VolumeIcon className="w-3.5 h-3.5 no-theme-icon" />
              </Button>
              <Slider value={[isMuted ? 0 : volume]} max={1} step={0.01} onValueChange={handleVolumeChange} className="flex-1 min-w-[160px]" />
              <span className="text-xs text-muted-foreground tabular-nums w-10 text-center">{Math.round((isMuted ? 0 : volume) * 100)}%</span>
            </div>

            <p className="text-[10px] text-muted-foreground text-center opacity-60">
              ⌨️ Space=נגן/עצור · Ctrl+←→=±5s · Shift+←→=מילה · M=השתק · Alt+S=מהירות
            </p>
          </div>
          </div>{/* close studio-widget-body for player */}

          {/* ═══ WIDGET 2: Studio (Mixer & Processing) ═══ */}
          <div key="studio" className="studio-widget-body">
            <div className="studio-widget-handle flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <GripVertical className="w-3.5 h-3.5 no-theme-icon" />
              <span>סטודיו (מיקסר ועיבוד)</span>
            </div>
          {!compact && (() => {
            // When the user explicitly opens the EQ panel via the power toggle,
            // force it to span the full horizontal width of the page (col-span-full)
            // so it isn't squeezed into the narrow side column.
            const fullWidth = (eqWide || isEqPanelOpen) && !eqFloating;
            const eqEl = (
            <div className={`space-y-3 ${eqFloating ? '' : 'order-2'} ${fullWidth ? 'col-span-full' : ''}`}>
              {!isEqPanelOpen ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                  <p className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
                    <AudioLines className="w-3.5 h-3.5 no-theme-icon" />
                    מיקסר ואקולייזר — כבוי
                  </p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5"
                        onClick={() => setIsEqPanelOpen(true)}
                      >
                        <Power className="w-3.5 h-3.5 no-theme-icon" />
                        הפעל
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">הפעל מיקסר/אקולייזר — ייפתח לרוחב מלא</TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <>
              {mixerPanel}

              {/* ─── EQ + Processing Mixing Console ── */}
              <div className={`space-y-2 rounded-lg border bg-muted/20 p-3 group/panel-mixer transition-all ${isMixerFullscreen ? 'fixed inset-0 z-50 flex flex-col bg-background p-6' : ''}`}>
                {isMixerFullscreen && <div className="fixed inset-0 -z-10 bg-background" />}
                {/* When fullscreen, wrap everything above the player bar in a scrollable area */}
                <div className={isMixerFullscreen ? 'flex-1 overflow-auto space-y-2 min-h-0' : 'contents'}>
                <div className="flex items-center justify-between">
                  <p className={`font-semibold flex items-center gap-1.5 ${isMixerFullscreen ? 'text-sm' : 'text-xs'}`}>
                    <AudioLines className="w-3.5 h-3.5 text-primary no-theme-icon" />
                    מיקסר מקצועי (אקולייזר + עיבוד)
                  </p>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => setIsEqPanelOpen(false)}
                          title="כבה מיקסר/אקולייזר"
                        >
                          <Power className="w-3.5 h-3.5 no-theme-icon" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">כבה מיקסר/אקולייזר</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setIsMixerFullscreen((v) => !v)}
                      title={isMixerFullscreen ? "מזער מיקסר" : "מיקסר מסך מלא"}
                    >
                      {isMixerFullscreen
                        ? <Minimize2 className="w-3.5 h-3.5 no-theme-icon" />
                        : <Maximize2 className="w-3.5 h-3.5 no-theme-icon" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 transition-opacity group-hover/panel-mixer:opacity-100 focus-visible:opacity-100"
                      onClick={() => setIsMixerConsoleCollapsed((v) => !v)}
                      title={isMixerConsoleCollapsed ? "הרחב פונקציות" : "מזער פונקציות"}
                    >
                      {isMixerConsoleCollapsed
                        ? <ChevronDown className="w-3.5 h-3.5 no-theme-icon" />
                        : <ChevronUp className="w-3.5 h-3.5 no-theme-icon" />}
                    </Button>
                    <Button
                      variant={showAdvancedDialog ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-3 text-xs gap-1.5"
                      onClick={() => setShowAdvancedDialog(true)}
                    >
                      <Settings2 className="w-3.5 h-3.5 no-theme-icon" />
                      מתקדם
                    </Button>
                    <button
                      className={`p-1 rounded text-[10px] transition-all font-mono ${eqBandCount === 31 ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                      onClick={() => setEqBandCount(eqBandCount === 31 ? 10 : 31)}
                      title={eqBandCount === 31 ? 'מעבר ל-10 רצועות' : 'מעבר ל-31 רצועות'}
                    >{eqBandCount}b</button>
                    <button
                      className={`p-1 rounded text-[10px] transition-all ${eqViewMode === 'horizontal' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                      onClick={() => setEqViewMode('horizontal')}
                      title="תצוגה אופקית"
                    >═</button>
                    <button
                      className={`p-1 rounded text-[10px] transition-all ${eqViewMode === 'vertical' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                      onClick={() => setEqViewMode('vertical')}
                      title="תצוגה אנכית (מיקסר)"
                    >║</button>
                    <button
                      className={`p-1 rounded text-[10px] transition-all ${eqViewMode === 'circular' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                      onClick={() => setEqViewMode('circular')}
                      title="תצוגת כפתורים מעגליים"
                    >◒</button>
                    <button
                      className={`p-1 rounded text-[10px] transition-all ${eqViewMode === 'parametric' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                      onClick={() => setEqViewMode('parametric')}
                      title="EQ פרמטרי גרפי עם Q"
                    >∿</button>
                  </div>
                </div>

                {/* EQ Slider Theme Selector */}
                {!isMixerConsoleCollapsed && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground font-medium">עיצוב:</span>
                    {EQ_SLIDER_THEMES.map((t) => (
                      <button
                        key={t.id}
                        className={`px-1.5 py-0.5 rounded text-[9px] transition-all ${
                          eqSliderTheme === t.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                        }`}
                        onClick={() => setEqSliderTheme(t.id)}
                        title={t.label}
                      >{t.icon} {t.label}</button>
                    ))}
                  </div>
                )}

                {isMixerConsoleCollapsed && (
                  <p className="text-[11px] text-muted-foreground">המיקסר ממוזער. רחף על הכרטיס ולחץ על האייקון כדי לפתוח מחדש.</p>
                )}

                {!isMixerConsoleCollapsed && (
                  <>

                {/* EQ Presets */}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'flat', label: 'שטוח', icon: '⚖️', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
                    { id: 'clear-speech', label: 'דיבור ברור', icon: '🎙️', values: [-3, -2, -1, 0, 2, 4, 6, 4, 2, 0] },
                    { id: 'transcription', label: 'תמלול מדויק', icon: '📝', values: [-6, -4, -2, 0, 3, 5, 8, 6, 0, -2] },
                    { id: 'deep-voice', label: 'קול עמוק', icon: '🔊', values: [4, 5, 3, 1, 0, -1, -2, -2, -3, -4] },
                    { id: 'phone-fix', label: 'תיקון טלפון', icon: '📱', values: [3, 4, 2, 1, 2, 3, 5, 3, -2, -4] },
                    { id: 'room-fix', label: 'תיקון חדר', icon: '🏠', values: [-4, -3, -2, -1, 1, 3, 5, 4, 1, 0] },
                    { id: 'bass-boost', label: 'בס מוגבר', icon: '🔈', values: [8, 6, 4, 2, 0, 0, 0, 0, -1, -2] },
                    { id: 'music', label: 'מוזיקה', icon: '🎵', values: [3, 2, 1, 0, 0, 1, 2, 3, 4, 3] },
                    { id: 'brightness', label: 'בהירות', icon: '✨', values: [-2, -1, 0, 0, 1, 2, 5, 6, 7, 5] },
                    { id: 'warmth-eq', label: 'חמימות', icon: '☀️', values: [4, 5, 3, 2, -1, -1, -2, -2, -3, -4] },
                    { id: 'noise-cut', label: 'חיתוך רעש', icon: '🔇', values: [-8, -6, -3, -1, 1, 2, 4, 2, -4, -6] },
                    { id: 'female-voice', label: 'קול נשי', icon: '👩', values: [-4, -3, -1, 0, 2, 3, 7, 6, 4, 2] },
                  ].map((preset) => {
                    const isActive = EQ_BANDS_10_INDICES.every((idx, i) => eqGains[idx] === preset.values[i]);
                    return (
                      <button
                        key={preset.id}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] transition-all
                          ${isActive ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'border-border hover:bg-muted'}
                        `}
                        onClick={() => {
                          // Interpolate 10-band preset to 31 bands
                          const v = preset.values;
                          const newGains = new Array(31).fill(0);
                          EQ_BANDS_10_INDICES.forEach((idx, i) => { newGains[idx] = v[i]; });
                          // Interpolate in-between bands
                          for (let i = 0; i < EQ_BANDS_10_INDICES.length - 1; i++) {
                            const startIdx = EQ_BANDS_10_INDICES[i];
                            const endIdx = EQ_BANDS_10_INDICES[i + 1];
                            const startVal = v[i];
                            const endVal = v[i + 1];
                            for (let j = startIdx + 1; j < endIdx; j++) {
                              const t = (j - startIdx) / (endIdx - startIdx);
                              newGains[j] = Math.round((startVal + (endVal - startVal) * t) * 2) / 2;
                            }
                          }
                          // Fill below first and above last
                          for (let j = 0; j < EQ_BANDS_10_INDICES[0]; j++) newGains[j] = v[0];
                          for (let j = EQ_BANDS_10_INDICES[9] + 1; j < 31; j++) newGains[j] = v[9];
                          setEqGains(newGains);
                        }}
                      >
                        <span>{preset.icon}</span>
                        <span className="font-medium">{preset.label}</span>
                      </button>
                    );
                  })}
                  {/* Save current as preset */}
                  <button
                    className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-primary/40 text-[11px] text-primary hover:bg-primary/10 transition-all"
                    onClick={() => setShowSaveEqPreset(v => !v)}
                    title="שמור פריסט מותאם אישית"
                  >
                    <Save className="w-3 h-3 no-theme-icon" />
                    <span className="font-medium">שמור</span>
                  </button>
                </div>

                {/* Save Custom EQ Preset Form */}
                {showSaveEqPreset && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      className="flex-1 min-w-[120px] max-w-[200px] h-7 rounded-md border bg-background px-2 text-xs"
                      placeholder="שם הפריסט..."
                      value={userEqPresetName}
                      onChange={(e) => setUserEqPresetName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveUserEqPreset(userEqPresetName); }}
                      autoFocus
                    />
                    <Button variant="default" size="sm" className="h-7 px-3 text-xs" onClick={() => saveUserEqPreset(userEqPresetName)} disabled={!userEqPresetName.trim()}>
                      💾 שמור
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowSaveEqPreset(false)}>
                      ביטול
                    </Button>
                  </div>
                )}

                {/* User Custom EQ Presets */}
                {userEqPresets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] text-muted-foreground">פריסטים שלי:</span>
                    {userEqPresets.map((up) => {
                      const isActive = up.gains.every((g, i) => eqGains[i] === g);
                      return (
                        <div key={up.id} className="flex items-center gap-0.5 group/upreset">
                          <button
                            className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] transition-all
                              ${isActive ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'border-border hover:bg-muted'}
                            `}
                            onClick={() => loadUserEqPreset(up)}
                          >
                            <span>⭐</span>
                            <span className="font-medium">{up.name}</span>
                          </button>
                          <button
                            className="opacity-0 group-hover/upreset:opacity-100 transition-opacity text-destructive hover:text-destructive/80 p-0.5"
                            onClick={() => deleteUserEqPreset(up.id)}
                            title="מחק פריסט"
                          >
                            <X className="w-3 h-3 no-theme-icon" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="space-y-3">
                  {/* EQ Section */}
                  {(() => { const wideEq = eqWide || isMixerFullscreen;
                    // Theme-based classes — CSS themes use class-based styling from index.css
                    const cssThemes = ['console', 'vu', 'studio', 'retro', 'cyber'] as const;
                    const isCssTheme = (cssThemes as readonly string[]).includes(eqSliderTheme);
                    const themeWrapper = isCssTheme ? 'eq-band-wrapper'
                      : eqSliderTheme === 'neon' ? 'bg-black/30 rounded-md px-0.5 py-1 ring-1 ring-primary/30 shadow-[0_0_8px_rgba(59,130,246,0.25)]'
                      : eqSliderTheme === 'led' ? 'bg-black/40 rounded px-0.5 py-1 border border-green-500/30'
                      : eqSliderTheme === 'glass' ? 'bg-white/5 backdrop-blur-sm rounded-lg px-0.5 py-1 border border-white/10 shadow-inner'
                      : eqSliderTheme === 'gradient' ? 'bg-gradient-to-b from-primary/10 via-transparent to-primary/10 rounded-md px-0.5 py-1'
                      : eqSliderTheme === 'minimal' ? 'px-0.5 py-1'
                      : 'px-0.5 py-1';
                    const themeGain = isCssTheme ? 'eq-gain-label'
                      : eqSliderTheme === 'neon' ? 'drop-shadow-[0_0_4px_currentColor]'
                      : eqSliderTheme === 'led' ? 'font-bold'
                      : '';
                    const themeFreq = isCssTheme ? 'eq-freq-label' : '';
                    const themeGrid = isCssTheme ? `eq-theme-${eqSliderTheme}`
                      : eqSliderTheme === 'neon' ? 'bg-black/20 rounded-lg p-2'
                      : eqSliderTheme === 'led' ? 'bg-[#0a0a0a] rounded-lg p-2 border border-green-900/40'
                      : eqSliderTheme === 'glass' ? 'bg-white/[0.03] backdrop-blur rounded-xl p-2 border border-white/10'
                      : eqSliderTheme === 'gradient' ? 'bg-gradient-to-br from-primary/5 to-secondary/5 rounded-lg p-2'
                      : eqSliderTheme === 'minimal' ? 'p-1'
                      : '';
                    return eqViewMode === 'vertical' && (
                    <div className="overflow-x-auto pb-2">
                      <div className={`grid ${wideEq ? 'gap-1' : 'gap-0.5'} ${themeGrid}`} style={{ gridTemplateColumns: `repeat(${(eqBandCount === 31 ? 31 : 10) + 1 + 5}, minmax(0, 1fr))` }}>
                      {(eqBandCount === 31 ? EQ_BANDS_31.map((b, i) => ({ ...b, index: i })) : EQ_BANDS_10_INDICES.map(i => ({ ...EQ_BANDS_31[i], index: i }))).map((band) => (
                        <Tooltip key={band.freq}>
                          <TooltipTrigger asChild>
                        <div className={`flex flex-col items-center gap-0.5 ${themeWrapper} transition-all`}>
                          <span className={`text-[8px] font-mono ${band.color} ${themeGain}`}>{eqGains[band.index] > 0 ? '+' : ''}{eqGains[band.index]}</span>
                          <div className={`${isMixerFullscreen ? 'h-64' : wideEq ? 'h-40' : 'h-24'} flex items-center relative eq-track-groove`}>
                            {eqSliderTheme === 'vu' && (
                              <div className="eq-led-meter">
                                {Array.from({ length: 12 }, (_, i) => {
                                  const val = eqGains[band.index];
                                  const threshold = -12 + i * 2;
                                  const active = val >= threshold;
                                  const color = i >= 10 ? 'red' : i >= 8 ? 'orange' : i >= 5 ? 'yellow' : 'green';
                                  return <div key={i} className={`led ${color} ${active ? 'active' : ''}`} />;
                                })}
                              </div>
                            )}
                            <Slider
                              orientation="vertical"
                              value={[eqGains[band.index]]}
                              min={-12}
                              max={12}
                              step={0.5}
                              onValueChange={([v]) => setEqBand(band.index, v)}
                              className={`h-full ${wideEq ? 'w-3' : 'w-2'}`}
                            />
                          </div>
                          <span className={`${wideEq ? 'text-[9px]' : 'text-[7px]'} font-medium leading-tight text-center ${themeFreq}`}>{band.label}</span>
                        </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs max-w-[200px] text-center">
                            <p className="font-semibold">{band.label}Hz</p>
                            <p className="text-muted-foreground">{EQ_FREQ_TOOLTIPS[band.freq] ?? ''}</p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                      <div className="w-px bg-border/40 min-h-[4rem] self-center mx-1"></div>
                      {[
                        { label: 'HP', freq: 'חתך', value: manualHighpass, min: 20, max: 400, step: 10, color: 'text-purple-400',
                          display: `${manualHighpass}`,
                          tip: 'High-Pass — חותך תדרים נמוכים (רעש, זמזום, רוח). העלה כדי לנקות רעשי רקע כבדים.',
                          set: (v: number) => { setManualHighpass(v); if (isManualMode && highpassRef.current) highpassRef.current.frequency.value = v; } },
                        { label: 'LP', freq: 'חתך', value: manualLowpass, min: 6000, max: 20000, step: 250, color: 'text-pink-400',
                          display: `${(manualLowpass/1000).toFixed(1)}k`,
                          tip: 'Low-Pass — חותך תדרים גבוהים (שריקות, סיבילנס). הורד כדי לרכך צלילים חדים.',
                          set: (v: number) => { setManualLowpass(v); if (isManualMode && lowpassRef.current) lowpassRef.current.frequency.value = v; } },
                        { label: 'Voc', freq: 'חיזוק', value: manualVoiceBoost, min: 0, max: 12, step: 0.5, color: 'text-cyan-400',
                          display: `+${manualVoiceBoost}`,
                          tip: 'Voice Boost — מחזק את טווח תדרי הדיבור (300Hz-3kHz). מועיל כשהקול מעומעם.',
                          set: (v: number) => { setManualVoiceBoost(v); if (isManualMode && voiceBoostRef.current) voiceBoostRef.current.gain.value = v; } },
                        { label: 'Comp', freq: 'יחס', value: manualCompRatio, min: 1, max: 12, step: 0.5, color: 'text-amber-400',
                          display: `${manualCompRatio}:1`,
                          tip: 'Compressor — מצמצם פערי עוצמה בין חזק לחלש. יחס גבוה = יותר אחידות.',
                          set: (v: number) => { setManualCompRatio(v); if (isManualMode && compressorRef.current) { compressorRef.current.ratio.value = v; compressorRef.current.threshold.value = -50 + (v > 1 ? -(v * 3) : 0); } } },
                        { label: 'Gate', freq: 'סף', value: manualGate, min: -80, max: 0, step: 5, color: 'text-emerald-400',
                          display: manualGate === 0 ? 'כבוי' : `${manualGate}`,
                          tip: 'Noise Gate — משתיק צלילים מתחת לסף. מועיל לרעש רקע קבוע בהשקטות.',
                          set: (v: number) => setManualGate(v) },
                      ].map((ctrl) => (
                        <Tooltip key={ctrl.label}>
                          <TooltipTrigger asChild>
                        <div className={`flex flex-col items-center gap-0.5 min-w-[24px] ${themeWrapper} transition-all`}>
                          <span className={`text-[7px] font-mono ${ctrl.color} ${themeGain}`}>{ctrl.display}</span>
                          <div className={`${isMixerFullscreen ? 'h-64' : wideEq ? 'h-40' : 'h-24'} flex items-center eq-track-groove`}>
                            <Slider
                              orientation="vertical"
                              value={[ctrl.value]}
                              min={ctrl.min}
                              max={ctrl.max}
                              step={ctrl.step}
                              onValueChange={([v]) => ctrl.set(v)}
                              className={`h-full ${wideEq ? 'w-3' : 'w-2'}`}
                            />
                          </div>
                          <span className={`${wideEq ? 'text-[9px]' : 'text-[7px]'} font-medium leading-tight text-center ${themeFreq}`}>{ctrl.label}</span>
                        </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs max-w-[220px] text-center">
                            <p className="font-semibold">{ctrl.label} — {ctrl.freq}</p>
                            <p className="text-muted-foreground">{ctrl.tip}</p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                    </div>
                  ); })()}

                  {eqViewMode === 'horizontal' && (
                    <div className="space-y-3">
                      <p className="text-[10px] font-medium text-muted-foreground">אקולייזר רוחבי — {eqBandCount} רצועות</p>
                      {(eqBandCount === 31 ? EQ_BANDS_31.map((b, i) => ({ ...b, index: i })) : EQ_BANDS_10_INDICES.map(i => ({ ...EQ_BANDS_31[i], index: i }))).map((band) => (
                        <Tooltip key={band.freq}>
                          <TooltipTrigger asChild>
                        <div className="space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-muted-foreground">{eqGains[band.index] > 0 ? '+' : ''}{eqGains[band.index]}dB</span>
                            <span className="text-[10px] font-medium">{band.label}Hz</span>
                          </div>
                          <Slider
                            value={[eqGains[band.index]]}
                            min={-12}
                            max={12}
                            step={0.5}
                            onValueChange={([v]) => setEqBand(band.index, v)}
                          />
                        </div>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="text-xs max-w-[200px]">
                            <p className="font-semibold">{band.label}Hz</p>
                            <p className="text-muted-foreground">{EQ_FREQ_TOOLTIPS[band.freq] ?? ''}</p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                      <Separator />
                      <p className="text-[10px] font-medium text-muted-foreground">עיבוד חכם חיתוך ודחיסה</p>
                      {[
                        { label: 'Highpass (חתך נמוכים)', value: manualHighpass, min: 20, max: 400, step: 10, display: `${manualHighpass}Hz`, set: (v: number) => { setManualHighpass(v); if (isManualMode && highpassRef.current) highpassRef.current.frequency.value = v; } },
                        { label: 'Lowpass (חתך גבוהים)', value: manualLowpass, min: 6000, max: 20000, step: 250, display: `${(manualLowpass/1000).toFixed(1)}k`, set: (v: number) => { setManualLowpass(v); if (isManualMode && lowpassRef.current) lowpassRef.current.frequency.value = v; } },
                        { label: 'חיזוק קול (Voice)', value: manualVoiceBoost, min: 0, max: 12, step: 0.5, display: `${manualVoiceBoost > 0 ? '+' : ''}${manualVoiceBoost}dB`, set: (v: number) => { setManualVoiceBoost(v); if (isManualMode && voiceBoostRef.current) voiceBoostRef.current.gain.value = v; } },
                        { label: 'Comp (דחיסה)', value: manualCompRatio, min: 1, max: 12, step: 0.5, display: `${manualCompRatio}:1`, set: (v: number) => { setManualCompRatio(v); if (isManualMode && compressorRef.current) { compressorRef.current.ratio.value = v; compressorRef.current.threshold.value = -50 + (v > 1 ? -(v * 3) : 0); } } },
                        { label: 'Gate (שער רעש)', value: manualGate, min: -80, max: 0, step: 5, display: manualGate === 0 ? 'כבוי' : `${manualGate}dB`, set: (v: number) => setManualGate(v) },
                      ].map((ctrl) => (
                        <div key={ctrl.label} className="space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-muted-foreground">{ctrl.display}</span>
                            <span className="text-[10px] font-medium">{ctrl.label}</span>
                          </div>
                          <Slider
                            value={[ctrl.value]}
                            min={ctrl.min}
                            max={ctrl.max}
                            step={ctrl.step}
                            onValueChange={([v]) => ctrl.set(v)}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {eqViewMode === 'circular' && (
                    <div className="flex flex-col gap-4 overflow-x-auto pb-2 items-center">
                      <div className="flex flex-wrap items-center justify-center gap-3" style={{ maxWidth: (eqWide || isMixerFullscreen) ? undefined : (eqBandCount === 31 ? 520 : 280) }}>
                        {(eqBandCount === 31 ? EQ_BANDS_31.map((b, i) => ({ ...b, index: i })) : EQ_BANDS_10_INDICES.map(i => ({ ...EQ_BANDS_31[i], index: i }))).map((band) => (
                          <Tooltip key={band.freq}>
                            <TooltipTrigger asChild>
                              <div>
                                <Knob label={band.label} value={eqGains[band.index]} min={-12} max={12} onChange={(v) => setEqBand(band.index, v)} />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-[200px] text-center">
                              <p className="font-semibold">{band.label}Hz</p>
                              <p className="text-muted-foreground">{EQ_FREQ_TOOLTIPS[band.freq] ?? ''}</p>
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                      <Separator className="w-full" />
                      <div className={`flex flex-wrap items-center justify-center gap-4 ${(eqWide || isMixerFullscreen) ? '' : 'max-w-[280px]'}`}>
                        {[
                          { label: 'HP', value: manualHighpass, min: 20, max: 400, set: (v) => { setManualHighpass(v); if (isManualMode && highpassRef.current) highpassRef.current.frequency.value = v; } },
                          { label: 'LP', value: manualLowpass / 100, min: 60, max: 200, set: (v) => { setManualLowpass(v * 100); if (isManualMode && lowpassRef.current) lowpassRef.current.frequency.value = v * 100; } },
                          { label: 'Voc', value: manualVoiceBoost, min: 0, max: 12, set: (v) => { setManualVoiceBoost(v); if (isManualMode && voiceBoostRef.current) voiceBoostRef.current.gain.value = v; } },
                          { label: 'Comp', value: manualCompRatio, min: 1, max: 12, set: (v) => { setManualCompRatio(v); if (isManualMode && compressorRef.current) { compressorRef.current.ratio.value = v; compressorRef.current.threshold.value = -50 + (v > 1 ? -(v * 3) : 0); } } },
                          { label: 'Gate', value: manualGate, min: -80, max: 0, set: (v) => setManualGate(v) },
                        ].map((c) => (
                          <Knob key={c.label} label={c.label} value={c.value} min={c.min} max={c.max} onChange={(v) => c.set(v)} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ─── Parametric EQ View ─── */}
                  {eqViewMode === 'parametric' && (() => {
                    const W = 800;
                    const H = isMixerFullscreen ? 420 : 280;
                    const PAD_T = 30;
                    const PAD_B = 28;
                    const PAD_L = 36;
                    const PAD_R = 12;
                    const plotW = W - PAD_L - PAD_R;
                    const plotH = H - PAD_T - PAD_B;
                    const minF = 20;
                    const maxF = 20000;
                    const minDb = -15;
                    const maxDb = 15;
                    const fToX = (f: number) => PAD_L + (Math.log10(f / minF) / Math.log10(maxF / minF)) * plotW;
                    const dbToY = (db: number) => PAD_T + ((maxDb - db) / (maxDb - minDb)) * plotH;

                    // Compute composite frequency response curve
                    const curvePoints: string[] = [];
                    const numSteps = 200;
                    for (let s = 0; s <= numSteps; s++) {
                      const freq = minF * Math.pow(maxF / minF, s / numSteps);
                      let totalDb = 0;
                      const activeBands = eqBandCount === 31
                        ? EQ_BANDS_31.map((b, i) => ({ ...b, index: i }))
                        : EQ_BANDS_10_INDICES.map(i => ({ ...EQ_BANDS_31[i], index: i }));
                      for (const band of activeBands) {
                        const g = eqGains[band.index];
                        if (Math.abs(g) < 0.01) continue;
                        const Q = eqQValues[band.index] || 4.3;
                        const f0 = band.freq;
                        // Peaking EQ approximate magnitude response
                        const w = freq / f0;
                        const w2 = w * w;
                        const bw = w / Q;
                        const denom = (1 - w2) * (1 - w2) + bw * bw;
                        const mag = Math.sqrt((1 + (g / 20) * bw) * (1 + (g / 20) * bw) * (1 - w2) * (1 - w2) + bw * bw * Math.pow(1 + (g / 20), 2)) / Math.sqrt(denom || 0.0001);
                        // Simplified: use a bell-shaped approximation
                        const logRatio = Math.log2(freq / f0);
                        const bandwidth = 1 / Q;
                        const bellShape = Math.exp(-0.5 * Math.pow(logRatio / (bandwidth * 0.6), 2));
                        totalDb += g * bellShape;
                      }
                      totalDb = Math.max(minDb, Math.min(maxDb, totalDb));
                      const x = fToX(freq);
                      const y = dbToY(totalDb);
                      curvePoints.push(`${s === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
                    }
                    const curvePath = curvePoints.join(' ');
                    // Fill path (curve to bottom)
                    const fillPath = curvePath + ` L${fToX(maxF).toFixed(1)},${dbToY(0).toFixed(1)} L${fToX(minF).toFixed(1)},${dbToY(0).toFixed(1)} Z`;

                    // Grid lines
                    const freqGridLines = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
                    const dbGridLines = [-12, -9, -6, -3, 0, 3, 6, 9, 12];
                    const sel = selectedParamBand;

                    return (
                      <div className="space-y-3">
                        {/* SVG Curve Display */}
                        <div className="bg-[#0d1117] rounded-lg border border-border/50 overflow-hidden">
                          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minHeight: isMixerFullscreen ? 350 : 220 }}>
                            {/* Background grid */}
                            {freqGridLines.map(f => (
                              <g key={f}>
                                <line x1={fToX(f)} y1={PAD_T} x2={fToX(f)} y2={H - PAD_B} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                                <text x={fToX(f)} y={H - PAD_B + 14} fill="rgba(255,255,255,0.35)" fontSize="9" textAnchor="middle" fontFamily="monospace">
                                  {f >= 1000 ? `${f / 1000}k` : f}
                                </text>
                              </g>
                            ))}
                            {dbGridLines.map(db => (
                              <g key={db}>
                                <line x1={PAD_L} y1={dbToY(db)} x2={W - PAD_R} y2={dbToY(db)}
                                  stroke={db === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'}
                                  strokeWidth={db === 0 ? 1 : 0.5} />
                                <text x={PAD_L - 4} y={dbToY(db) + 3} fill="rgba(255,255,255,0.3)" fontSize="8" textAnchor="end" fontFamily="monospace">
                                  {db > 0 ? '+' : ''}{db}
                                </text>
                              </g>
                            ))}
                            {/* Axis labels */}
                            <text x={W / 2} y={H - 2} fill="rgba(255,255,255,0.25)" fontSize="9" textAnchor="middle">Hz</text>
                            <text x={6} y={H / 2} fill="rgba(255,255,255,0.25)" fontSize="9" textAnchor="middle" transform={`rotate(-90,6,${H / 2})`}>dB</text>

                            {/* Fill under curve */}
                            <path d={fillPath} fill="url(#eqGradFill)" opacity="0.35" />
                            {/* Main curve */}
                            <path d={curvePath} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                            {/* Per-band individual curves (dim) */}
                            {(eqBandCount === 31 ? EQ_BANDS_31.map((b, i) => ({ ...b, index: i })) : EQ_BANDS_10_INDICES.map(i => ({ ...EQ_BANDS_31[i], index: i }))).map((band) => {
                              const g = eqGains[band.index];
                              if (Math.abs(g) < 0.01 && sel !== band.index) return null;
                              const Q = eqQValues[band.index] || 4.3;
                              const isSelected = sel === band.index;
                              const pts: string[] = [];
                              for (let s = 0; s <= 100; s++) {
                                const freq = minF * Math.pow(maxF / minF, s / 100);
                                const logRatio = Math.log2(freq / band.freq);
                                const bw = 1 / Q;
                                const bell = g * Math.exp(-0.5 * Math.pow(logRatio / (bw * 0.6), 2));
                                const db = Math.max(minDb, Math.min(maxDb, bell));
                                pts.push(`${s === 0 ? 'M' : 'L'}${fToX(freq).toFixed(1)},${dbToY(db).toFixed(1)}`);
                              }
                              return (
                                <path key={band.index} d={pts.join(' ')} fill="none"
                                  stroke={isSelected ? '#fbbf24' : 'rgba(255,255,255,0.12)'}
                                  strokeWidth={isSelected ? 1.5 : 0.7}
                                  strokeDasharray={isSelected ? undefined : '3 3'} />
                              );
                            })}

                            {/* Band dots (draggable handles) */}
                            {(eqBandCount === 31 ? EQ_BANDS_31.map((b, i) => ({ ...b, index: i })) : EQ_BANDS_10_INDICES.map(i => ({ ...EQ_BANDS_31[i], index: i }))).map((band) => {
                              const g = eqGains[band.index];
                              const cx = fToX(band.freq);
                              const cy = dbToY(g);
                              const isSelected = sel === band.index;
                              return (
                                <g key={band.index} style={{ cursor: 'pointer' }} onClick={() => setSelectedParamBand(isSelected ? null : band.index)}>
                                  {isSelected && <circle cx={cx} cy={cy} r="10" fill="rgba(251,191,36,0.15)" />}
                                  <circle cx={cx} cy={cy} r={isSelected ? 5 : 3.5}
                                    fill={Math.abs(g) > 0.01 ? (isSelected ? '#fbbf24' : '#60a5fa') : 'rgba(255,255,255,0.2)'}
                                    stroke={isSelected ? '#fbbf24' : 'none'} strokeWidth="1.5"
                                  />
                                  {isSelected && (
                                    <text x={cx} y={cy - 12} fill="#fbbf24" fontSize="9" textAnchor="middle" fontFamily="monospace" fontWeight="bold">
                                      {band.label}Hz {g > 0 ? '+' : ''}{g}dB Q{(eqQValues[band.index] || 4.3).toFixed(1)}
                                    </text>
                                  )}
                                </g>
                              );
                            })}

                            {/* Gradient definition */}
                            <defs>
                              <linearGradient id="eqGradFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.5" />
                                <stop offset="50%" stopColor="#60a5fa" stopOpacity="0" />
                                <stop offset="50%" stopColor="#60a5fa" stopOpacity="0" />
                                <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.3" />
                              </linearGradient>
                            </defs>
                          </svg>
                        </div>

                        {/* Selected band controls */}
                        {sel !== null && (() => {
                          const band = EQ_BANDS_31[sel];
                          const g = eqGains[sel];
                          const q = eqQValues[sel] || 4.3;
                          return (
                            <div className="bg-muted/30 rounded-lg border p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className={`w-3 h-3 rounded-full bg-yellow-400`} />
                                  <span className="font-semibold text-sm">{band.label}Hz</span>
                                  <span className="text-xs text-muted-foreground">— {EQ_FREQ_TOOLTIPS[band.freq] ?? ''}</span>
                                </div>
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setSelectedParamBand(null)}>✕</Button>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                {/* Gain control */}
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium">Gain (הגבר)</span>
                                    <span className="text-xs font-mono text-muted-foreground">{g > 0 ? '+' : ''}{g} dB</span>
                                  </div>
                                  <Slider value={[g]} min={-12} max={12} step={0.5} onValueChange={([v]) => setEqBand(sel, v)} />
                                  <div className="flex justify-between text-[8px] text-muted-foreground">
                                    <span>-12dB</span><span>0</span><span>+12dB</span>
                                  </div>
                                </div>
                                {/* Q (bandwidth) control */}
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-xs font-medium cursor-help border-b border-dotted border-muted-foreground/50">Q (רוחב בנד)</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="text-xs max-w-[240px]">
                                        <p className="font-semibold">Q — רוחב הפס (Bandwidth)</p>
                                        <p className="text-muted-foreground">Q נמוך = פס רחב, משפיע על טווח תדרים גדול. Q גבוה = פס צר, ממוקד בתדר ספציפי. מתאים לחיתוך רעש נקודתי.</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    <span className="text-xs font-mono text-muted-foreground">{q.toFixed(1)}</span>
                                  </div>
                                  <Slider value={[q]} min={0.1} max={18} step={0.1} onValueChange={([v]) => setEqQ(sel, v)} />
                                  <div className="flex justify-between text-[8px] text-muted-foreground">
                                    <span>רחב (0.1)</span><span>4.3</span><span>צר (18)</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Band quick-select strip */}
                        <div className="flex flex-wrap gap-1 justify-center">
                          {(eqBandCount === 31 ? EQ_BANDS_31.map((b, i) => ({ ...b, index: i })) : EQ_BANDS_10_INDICES.map(i => ({ ...EQ_BANDS_31[i], index: i }))).map((band) => {
                            const g = eqGains[band.index];
                            const isSelected = sel === band.index;
                            const hasGain = Math.abs(g) > 0.01;
                            return (
                              <Tooltip key={band.index}>
                                <TooltipTrigger asChild>
                                  <button
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-all border ${
                                      isSelected ? 'bg-yellow-400/20 text-yellow-400 border-yellow-400/50 shadow-sm'
                                      : hasGain ? 'bg-primary/10 text-primary border-primary/30'
                                      : 'border-border/50 text-muted-foreground hover:bg-muted'
                                    }`}
                                    onClick={() => setSelectedParamBand(isSelected ? null : band.index)}
                                  >
                                    {band.label}
                                    {hasGain && <span className="mr-0.5 text-[7px]">{g > 0 ? '+' : ''}{g}</span>}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs max-w-[200px] text-center">
                                  <p className="font-semibold">{band.label}Hz — Q: {(eqQValues[band.index] || 4.3).toFixed(1)}</p>
                                  <p className="text-muted-foreground">{EQ_FREQ_TOOLTIPS[band.freq] ?? ''}</p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                <div className="flex justify-center gap-2">
                  <Button variant="ghost" size="sm" className="h-6 px-3 text-[10px]" onClick={() => {
                    setEqGains(new Array(31).fill(0));
                    setEqQValues(EQ_BANDS_31.map(b => b.q));
                    setSelectedParamBand(null);
                  }}>
                    אפס אקולייזר
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-3 text-[10px]" onClick={() => {
                    setManualHighpass(80); setManualLowpass(16000); setManualVoiceBoost(0); setManualCompRatio(1); setManualGate(0);
                  }}>
                    אפס עיבוד
                  </Button>
                </div>

                {/* ─── Vocal Doubler Panel ───────────── */}
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-violet-500 no-theme-icon" />
                      <span className="text-xs font-semibold">הכפלת קול (Vocal Doubler)</span>
                      {doublerEnabled && <Badge variant="secondary" className="text-[9px] h-4 px-1">פעיל</Badge>}
                    </div>
                    <Switch checked={doublerEnabled} onCheckedChange={setDoublerEnabled} />
                  </div>
                  {doublerEnabled && (
                    <div className="space-y-2.5">
                      {/* Mode selector */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">מצב:</span>
                        {([
                          { id: 'chorus' as const, label: '🎤 כורוס', tip: 'הכפלה עדינה — מרחיב את הקול' },
                          { id: 'harmony' as const, label: '🎵 הרמוניה', tip: 'מרחק גדול יותר — צליל שני ברור' },
                          { id: 'octave' as const, label: '🔊 אוקטבה', tip: 'הכפלה עמוקה — אפקט דרמטי' },
                        ]).map((m) => (
                          <Tooltip key={m.id}>
                            <TooltipTrigger asChild>
                              <button
                                className={`px-2 py-0.5 rounded text-[10px] transition-all border ${
                                  doublerMode === m.id ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'border-border hover:bg-muted'
                                }`}
                                onClick={() => setDoublerMode(m.id)}
                              >{m.label}</button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">{m.tip}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                      {/* Mix */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">מיקס (יבש ↔ רטוב)</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{Math.round(doublerMix * 100)}%</span>
                        </div>
                        <Slider value={[doublerMix]} min={0} max={1} step={0.01} onValueChange={([v]) => setDoublerMix(v)} />
                      </div>
                      {/* Voice 1 & 2 detune */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">קול 1 — דיטון</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{doublerDetune1 > 0 ? '+' : ''}{doublerDetune1}</span>
                          </div>
                          <Slider value={[doublerDetune1]} min={-30} max={30} step={1} onValueChange={([v]) => setDoublerDetune1(v)} />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">קול 2 — דיטון</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{doublerDetune2 > 0 ? '+' : ''}{doublerDetune2}</span>
                          </div>
                          <Slider value={[doublerDetune2]} min={-30} max={30} step={1} onValueChange={([v]) => setDoublerDetune2(v)} />
                        </div>
                      </div>
                      {/* Delay & modulation */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">השהיה 1</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{doublerDelay1Ms}ms</span>
                          </div>
                          <Slider value={[doublerDelay1Ms]} min={5} max={60} step={1} onValueChange={([v]) => setDoublerDelay1Ms(v)} />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">השהיה 2</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{doublerDelay2Ms}ms</span>
                          </div>
                          <Slider value={[doublerDelay2Ms]} min={5} max={60} step={1} onValueChange={([v]) => setDoublerDelay2Ms(v)} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">עומק מודולציה</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{(doublerDepth * 1000).toFixed(1)}ms</span>
                          </div>
                          <Slider value={[doublerDepth]} min={0} max={0.015} step={0.0005} onValueChange={([v]) => setDoublerDepth(v)} />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">קצב LFO</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{doublerRate.toFixed(1)}Hz</span>
                          </div>
                          <Slider value={[doublerRate]} min={0.1} max={3} step={0.1} onValueChange={([v]) => setDoublerRate(v)} />
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground opacity-70">
                        💡 "כורוס" — הכפלה עדינה שמרחיבה את הקול. "הרמוניה" — קול שני ברור יותר, מתאים לשיר. "אוקטבה" — אפקט עמוק/גבוה דרמטי.
                      </p>
                    </div>
                  )}
                </div>

                {/* ─── Vocal Overlay (Personal Sync) Panel ───────────── */}
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-rose-500 no-theme-icon" />
                      <span className="text-xs font-semibold">סינק אישי (הוספת קול)</span>
                      {overlayBuffer && overlayEnabled && <Badge variant="secondary" className="text-[9px] h-4 px-1">פעיל</Badge>}
                      {isRecording && <Badge variant="destructive" className="text-[9px] h-4 px-1 animate-pulse">מקליט</Badge>}
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowOverlayPanel(v => !v)}>
                      {showOverlayPanel ? <ChevronUp className="w-3.5 h-3.5 no-theme-icon" /> : <ChevronDown className="w-3.5 h-3.5 no-theme-icon" />}
                    </Button>
                  </div>
                  {showOverlayPanel && (
                    <div className="space-y-3">
                      {/* Import / Record buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          ref={overlayFileInputRef}
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOverlayFileImport(f); e.target.value = ''; }}
                        />
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => overlayFileInputRef.current?.click()}>
                          <Upload className="w-3 h-3 no-theme-icon" />
                          ייבוא קובץ
                        </Button>
                        {!isRecording ? (
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-rose-600 border-rose-300 hover:bg-rose-50" onClick={startOverlayRecording}>
                            <Circle className="w-3 h-3 fill-rose-500 text-rose-500 no-theme-icon" />
                            הקלט
                          </Button>
                        ) : (
                          <Button variant="destructive" size="sm" className="h-7 text-xs gap-1 animate-pulse" onClick={stopOverlayRecording}>
                            <Square className="w-3 h-3 no-theme-icon" />
                            עצור ({recordingDuration.toFixed(1)}s)
                          </Button>
                        )}
                        {overlayBuffer && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive" onClick={() => {
                            stopOverlaySync();
                            setOverlayBuffer(null); setOverlayFileName(''); setOverlayEnabled(false);
                          }}>
                            <Trash2 className="w-3 h-3 no-theme-icon" />
                            מחק
                          </Button>
                        )}
                      </div>

                      {/* Overlay info & controls */}
                      {overlayBuffer && (
                        <div className="space-y-2.5 rounded-md border bg-background/50 p-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <AudioLines className="w-3 h-3 text-rose-400 no-theme-icon" />
                              <span className="text-[10px] font-medium truncate max-w-[180px]">{overlayFileName}</span>
                              <span className="text-[10px] text-muted-foreground">({overlayBuffer.duration.toFixed(1)}s)</span>
                            </div>
                            <Switch checked={overlayEnabled} onCheckedChange={setOverlayEnabled} />
                          </div>

                          {overlayEnabled && (
                            <>
                              {/* Volume */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-muted-foreground">עוצמת קול</span>
                                  <span className="text-[10px] font-mono text-muted-foreground">{Math.round(overlayVolume * 100)}%</span>
                                </div>
                                <Slider value={[overlayVolume]} min={0} max={1.5} step={0.01} onValueChange={([v]) => setOverlayVolume(v)} />
                              </div>

                              {/* Offset — where in the main track does overlay start */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-muted-foreground">נקודת התחלה בשיר</span>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] font-mono text-muted-foreground">{overlayOffset.toFixed(1)}s</span>
                                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={() => setOverlayOffset(audioRef.current?.currentTime ?? 0)}>
                                      📍 מהמיקום הנוכחי
                                    </Button>
                                  </div>
                                </div>
                                <Slider value={[overlayOffset]} min={0} max={Math.max(1, (audioRef.current?.duration || 60))} step={0.1} onValueChange={([v]) => setOverlayOffset(v)} />
                              </div>

                              {/* Trim start/end */}
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground">חיתוך התחלה</span>
                                    <span className="text-[10px] font-mono text-muted-foreground">{overlayTrimStart.toFixed(1)}s</span>
                                  </div>
                                  <Slider value={[overlayTrimStart]} min={0} max={overlayBuffer.duration} step={0.1} onValueChange={([v]) => setOverlayTrimStart(v)} />
                                </div>
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground">חיתוך סוף</span>
                                    <span className="text-[10px] font-mono text-muted-foreground">{overlayTrimEnd.toFixed(1)}s</span>
                                  </div>
                                  <Slider value={[overlayTrimEnd]} min={0} max={overlayBuffer.duration} step={0.1} onValueChange={([v]) => setOverlayTrimEnd(v)} />
                                </div>
                              </div>

                              {/* Playback controls */}
                              <div className="flex items-center gap-2">
                                {!overlayIsPlaying ? (
                                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={playOverlaySync}>
                                    <Play className="w-3 h-3 no-theme-icon" />
                                    נגן סינק
                                  </Button>
                                ) : (
                                  <Button variant="default" size="sm" className="h-7 text-xs gap-1" onClick={stopOverlaySync}>
                                    <Pause className="w-3 h-3 no-theme-icon" />
                                    עצור
                                  </Button>
                                )}
                                <span className="text-[10px] text-muted-foreground">
                                  משמיע מ-{overlayTrimStart.toFixed(1)}s עד {overlayTrimEnd.toFixed(1)}s, בנקודה {overlayOffset.toFixed(1)}s בשיר
                                </span>
                              </div>

                              <p className="text-[10px] text-muted-foreground opacity-70">
                                💡 הקול שלך ינוגן אוטומטית בסינק עם השיר כשתלחץ Play. אפשר לחתוך, להזיז את נקודת ההתחלה ולשלוט בעוצמה.
                              </p>
                            </>
                          )}
                        </div>
                      )}

                      {!overlayBuffer && (
                        <p className="text-[10px] text-muted-foreground">
                          ייבא קובץ אודיו או הקלט את הקול שלך. ההקלטה תסתנכרן אוטומטית עם השיר.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2 flex items-start gap-1.5">
                  <Brain className="w-3 h-3 mt-0.5 shrink-0 text-primary no-theme-icon" />
                  <span>
                    <strong>טיפ לתמלול מדויק:</strong> השתמש ב"תמלול מדויק" או "דיבור ברור" — חיזוק תדרי דיבור (1-5kHz) מעלה משמעותית את דיוק זיהוי המילים. לקול טלפוני השתמש ב"תיקון טלפון". שלב עם הפחתת רעש ברמה 40-60% לתוצאה מיטבית.
                  </span>
                </div>
                </div>
                  </>
                )}
                </div>{/* close scrollable wrapper */}

                {/* ─── Fullscreen Player Bar ── */}
                {isMixerFullscreen && (
                  <div className="shrink-0 border-t bg-background pt-3 mt-2 space-y-2">
                    {/* Seek Bar */}
                    <div className="flex items-center gap-3" dir="ltr">
                      <span className="text-xs text-muted-foreground font-mono min-w-[40px] text-center">{formatTime(effectiveDuration)}</span>
                      <Slider value={[currentTime]} max={effectiveDuration || 1} step={0.1} onValueChange={handleSliderSeek} className="flex-1" dir="rtl" />
                      <span className="text-xs text-muted-foreground font-mono min-w-[40px] text-center">{formatTime(currentTime)}</span>
                    </div>
                    {/* Controls Row */}
                    <div className="flex items-center justify-center gap-2">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={restart}><RotateCcw className="w-4 h-4 no-theme-icon" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => seek(-5)}><FastForward className="w-4 h-4 no-theme-icon" /></Button>
                      <Button size="icon" className="h-10 w-10 rounded-full" onClick={togglePlay}>
                        {isPlaying ? <Pause className="w-5 h-5 no-theme-icon" /> : <Play className="w-5 h-5 mr-0.5 no-theme-icon" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => seek(5)}><Rewind className="w-4 h-4 no-theme-icon" /></Button>
                      <div className="flex items-center gap-2 mr-4">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleMute}>
                          {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5 no-theme-icon" /> : volume < 0.5 ? <Volume1 className="w-3.5 h-3.5 no-theme-icon" /> : <Volume2 className="w-3.5 h-3.5 no-theme-icon" />}
                        </Button>
                        <Slider value={[isMuted ? 0 : volume]} max={1} step={0.01} onValueChange={handleVolumeChange} className="w-24" />
                        <span className="text-[10px] text-muted-foreground tabular-nums w-8">{Math.round((isMuted ? 0 : volume) * 100)}%</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] font-mono">{speed.toFixed(2)}x</Badge>
                    </div>
                  </div>
                )}
              </div>


              {/* Advanced Processing Dialog */}
              <Dialog open={showAdvancedDialog} onOpenChange={setShowAdvancedDialog}>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <Brain className="w-5 h-5 text-primary no-theme-icon" />
                      עיבוד מתקדם — AI והפחתת רעש
                    </DialogTitle>
                  </DialogHeader>

                  <div className="space-y-4">
                    {/* AI Denoise */}
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-violet-500 no-theme-icon" />
                          AI Denoise (דיכוי רעש חכם)
                        </span>
                        <Switch checked={aiDenoiseEnabled} onCheckedChange={(v) => {
                          setAiDenoiseEnabled(v);
                          if (v && aiDenoiseRef.current) aiDenoiseRef.current.enable();
                          else if (aiDenoiseRef.current) aiDenoiseRef.current.disable();
                        }} />
                      </div>
                      {aiDenoiseEnabled && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">עוצמת דיכוי</span>
                            <span className="text-xs font-mono">{aiDenoiseStrength}%</span>
                          </div>
                          <Slider value={[aiDenoiseStrength]} min={10} max={100} step={5} onValueChange={([v]) => {
                            setAiDenoiseStrength(v);
                            if (aiDenoiseRef.current) aiDenoiseRef.current.setStrength(v / 100);
                          }} />
                          <p className="text-[11px] text-muted-foreground">לומד את פרופיל הרעש אוטומטית ומפחית אותו בזמן אמת</p>
                        </div>
                      )}
                    </div>

                    {/* Spectral Gate */}
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          <Search className="w-4 h-4 text-cyan-500 no-theme-icon" />
                          שער ספקטרלי (Spectral Gate)
                        </span>
                        <Switch checked={spectralGateEnabled} onCheckedChange={(v) => {
                          setSpectralGateEnabled(v);
                          if (v && spectralGateRef.current) spectralGateRef.current.enable();
                          else if (spectralGateRef.current) spectralGateRef.current.disable();
                        }} />
                      </div>
                      {spectralGateEnabled && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" className="h-8 text-xs" disabled={isLearningNoise}
                              onClick={async () => {
                                if (!spectralGateRef.current) return;
                                setIsLearningNoise(true);
                                await spectralGateRef.current.startLearning(1500);
                                setHasNoiseProfile(true);
                                setIsLearningNoise(false);
                              }}>
                              {isLearningNoise ? '🔄 לומד...' : '🎯 למד רעש (1.5 שניות)'}
                            </Button>
                            {hasNoiseProfile && <Badge variant="secondary" className="text-[10px]">✓ פרופיל נלמד</Badge>}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">עוצמת הפחתה</span>
                            <span className="text-xs font-mono">{spectralGateReduction}dB</span>
                          </div>
                          <Slider value={[spectralGateReduction]} min={-30} max={0} step={1} onValueChange={([v]) => {
                            setSpectralGateReduction(v);
                            if (spectralGateRef.current) spectralGateRef.current.setReduction(v);
                          }} />
                          <p className="text-[11px] text-muted-foreground">השהה קטע שקט והקלק "למד רעש" — המערכת תלמד את טביעת האצבע של הרעש ותנכה אותו</p>
                        </div>
                      )}
                    </div>

                    {/* De-Hum */}
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          <Zap className="w-4 h-4 text-amber-500 no-theme-icon" />
                          הסרת זמזום חשמל (De-Hum)
                        </span>
                        <Switch checked={deHumEnabled} onCheckedChange={(v) => {
                          setDeHumEnabled(v);
                          if (v && deHumRef.current) {
                            deHumRef.current.enable();
                            const freq = deHumRef.current.autoDetect();
                            setDeHumDetectedFreq(freq);
                          } else if (deHumRef.current) {
                            deHumRef.current.disable();
                          }
                        }} />
                      </div>
                      {deHumEnabled && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" className="h-8 text-xs"
                              onClick={() => {
                                if (!deHumRef.current) return;
                                const freq = deHumRef.current.autoDetect();
                                setDeHumDetectedFreq(freq);
                              }}>
                              🔍 זיהוי אוטומטי
                            </Button>
                            {deHumDetectedFreq && <Badge variant="secondary" className="text-[10px]">זוהה: {deHumDetectedFreq}Hz</Badge>}
                            {!deHumDetectedFreq && <Badge variant="outline" className="text-[10px]">לא זוהה זמזום</Badge>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">תדר ידני:</span>
                            <Select value={String(deHumDetectedFreq || '50')} onValueChange={(v) => {
                              const freq = Number(v) as 50 | 60;
                              setDeHumDetectedFreq(freq);
                              if (deHumRef.current) deHumRef.current.setFrequency(freq);
                            }}>
                              <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="50">50Hz</SelectItem>
                                <SelectItem value="60">60Hz</SelectItem>
                              </SelectContent>
                            </Select>
                            <span className="text-xs text-muted-foreground">הרמוניות:</span>
                            <Slider value={[deHumHarmonics]} min={1} max={6} step={1} className="w-24" onValueChange={([v]) => {
                              setDeHumHarmonics(v);
                              if (deHumRef.current) deHumRef.current.setHarmonics(v);
                            }} />
                            <span className="text-xs font-mono">{deHumHarmonics}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* VAD */}
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          <Activity className="w-4 h-4 text-green-500 no-theme-icon" />
                          זיהוי דיבור (VAD)
                        </span>
                        <div className="flex items-center gap-2">
                          {vadEnabled && (
                            <Badge variant={vadIsSpeech ? 'default' : 'outline'} className="text-[10px]">
                              {vadIsSpeech ? '🗣️ דיבור' : '🔇 שקט'}
                            </Badge>
                          )}
                          <Switch checked={vadEnabled} onCheckedChange={(v) => {
                            setVadEnabled(v);
                            if (v && vadRef.current) vadRef.current.enable();
                            else if (vadRef.current) vadRef.current.disable();
                          }} />
                        </div>
                      </div>
                      {vadEnabled && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground">השתקה אוטומטית של שקט</Label>
                            <Switch checked={vadAutoMute} onCheckedChange={(v) => {
                              setVadAutoMute(v);
                              if (vadRef.current) vadRef.current.setAutoMute(v);
                            }} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">סף רגישות</span>
                            <span className="text-xs font-mono">{(vadThreshold * 1000).toFixed(0)}</span>
                          </div>
                          <Slider value={[vadThreshold]} min={0.003} max={0.05} step={0.001} onValueChange={([v]) => {
                            setVadThreshold(v);
                            if (vadRef.current) vadRef.current.setThreshold(v);
                          }} />
                        </div>
                      )}
                    </div>

                    {/* LUFS Meter */}
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          <BarChart3 className="w-4 h-4 text-blue-500 no-theme-icon" />
                          מד עוצמה LUFS
                        </span>
                        <Switch checked={lufsEnabled} onCheckedChange={(v) => {
                          setLufsEnabled(v);
                          if (v && lufsRef.current) lufsRef.current.start();
                          else if (lufsRef.current) lufsRef.current.stop();
                        }} />
                      </div>
                      {lufsEnabled && (
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-lg border bg-muted/30 p-2">
                              <div className="text-[10px] text-muted-foreground">רגעי</div>
                              <div className="text-sm font-mono font-bold">{isFinite(lufsMomentary) ? lufsMomentary.toFixed(1) : '—'}</div>
                            </div>
                            <div className="rounded-lg border bg-muted/30 p-2">
                              <div className="text-[10px] text-muted-foreground">קצר</div>
                              <div className="text-sm font-mono font-bold">{isFinite(lufsShortTerm) ? lufsShortTerm.toFixed(1) : '—'}</div>
                            </div>
                            <div className="rounded-lg border bg-muted/30 p-2">
                              <div className="text-[10px] text-muted-foreground">משולב</div>
                              <div className="text-sm font-mono font-bold">{isFinite(lufsIntegrated) ? lufsIntegrated.toFixed(1) : '—'}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground">נורמליזציה אוטומטית</Label>
                            <Switch checked={lufsNormalize} onCheckedChange={(v) => {
                              setLufsNormalize(v);
                              if (v && lufsRef.current) lufsRef.current.enableNormalization();
                              else if (lufsRef.current) lufsRef.current.disableNormalization();
                            }} />
                          </div>
                          {lufsNormalize && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">יעד:</span>
                              <Select value={String(lufsTarget)} onValueChange={(v) => {
                                const t = Number(v);
                                setLufsTarget(t);
                                if (lufsRef.current) lufsRef.current.setTarget(t);
                              }}>
                                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="-14">-14 LUFS (שידור)</SelectItem>
                                  <SelectItem value="-16">-16 LUFS (פודקאסט)</SelectItem>
                                  <SelectItem value="-18">-18 LUFS (מוזיקה)</SelectItem>
                                  <SelectItem value="-23">-23 LUFS (סטנדרט EU)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Notch filter */}
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">סינון זמזום חשמל (Notch)</span>
                        <Switch checked={humNotchEnabled} onCheckedChange={setHumNotchEnabled} />
                      </div>
                      {humNotchEnabled && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">תדר:</span>
                          <Select value={humNotchFreq} onValueChange={(v) => setHumNotchFreq(v as '50' | '60' | '100' | '120')}>
                            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="בחר תדר" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="50">50Hz</SelectItem>
                              <SelectItem value="60">60Hz</SelectItem>
                              <SelectItem value="100">100Hz</SelectItem>
                              <SelectItem value="120">120Hz</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Active advanced features status badges */}
              {(aiDenoiseEnabled || spectralGateEnabled || deHumEnabled || vadEnabled || lufsEnabled) && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {aiDenoiseEnabled && <Badge variant="secondary" className="text-[10px] gap-1"><Sparkles className="w-3 h-3 no-theme-icon" />AI Denoise</Badge>}
                  {spectralGateEnabled && <Badge variant="secondary" className="text-[10px] gap-1"><Search className="w-3 h-3 no-theme-icon" />Spectral Gate</Badge>}
                  {deHumEnabled && <Badge variant="secondary" className="text-[10px] gap-1"><Zap className="w-3 h-3 no-theme-icon" />De-Hum</Badge>}
                  {vadEnabled && <Badge variant={vadIsSpeech ? 'default' : 'secondary'} className="text-[10px] gap-1"><Activity className="w-3 h-3 no-theme-icon" />{vadIsSpeech ? 'דיבור' : 'שקט'}</Badge>}
                  {lufsEnabled && <Badge variant="secondary" className="text-[10px] gap-1"><BarChart3 className="w-3 h-3 no-theme-icon" />LUFS</Badge>}
                  {doublerEnabled && <Badge variant="secondary" className="text-[10px] gap-1"><Mic className="w-3 h-3 no-theme-icon" />Doubler</Badge>}
                  {overlayEnabled && overlayBuffer && <Badge variant="secondary" className="text-[10px] gap-1"><Layers className="w-3 h-3 no-theme-icon" />Overlay</Badge>}
                </div>
              )}
                </>
              )}
            </div>
            );
            return eqFloating && eqPortalTarget ? createPortal(eqEl, eqPortalTarget) : eqEl;
          })()}
          </div>{/* close studio-widget-body for studio */}
        </ResponsiveReactGridLayout>

        {/* ─── Keyboard shortcuts panel ──────────────────────── */}
        <div className="text-center">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground opacity-70 hover:opacity-100"
            onClick={() => setShowKeyboardHelp(v => !v)}>
            ⌨️ {showKeyboardHelp ? 'הסתר קיצורי מקלדת' : 'קיצורי מקלדת (?)'}
          </Button>
        </div>
        {showKeyboardHelp && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs" dir="rtl">
            <p className="font-medium text-sm mb-2">⌨️ קיצורי מקלדת לנגן</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex justify-between"><span>נגן / עצור</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">Space</kbd></div>
              <div className="flex justify-between"><span>±5 שניות</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">← →</kbd></div>
              <div className="flex justify-between"><span>±15 שניות</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">Ctrl+← →</kbd></div>
              <div className="flex justify-between"><span>מילה קודמת / הבאה</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">Shift+← →</kbd></div>
              <div className="flex justify-between"><span>דיוק ±0.5 שניות</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">, .</kbd></div>
              <div className="flex justify-between"><span>עוצמה ↑↓</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">↑ ↓</kbd></div>
              <div className="flex justify-between"><span>השתקה</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">M</kbd></div>
              <div className="flex justify-between"><span>האט / האץ</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">[ ]</kbd></div>
              <div className="flex justify-between"><span>מהירות רגילה</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">\</kbd></div>
              <div className="flex justify-between"><span>התחלה / סוף</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">Home End</kbd></div>
              <div className="flex justify-between"><span>נגן מההתחלה</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">Ctrl+R</kbd></div>
              <div className="flex justify-between"><span>סמן נקודה A / B</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">A B</kbd></div>
              <div className="flex justify-between"><span>לופ A-B</span><kbd className="bg-background border rounded px-1.5 py-0.5 text-[10px] font-mono">L</kbd></div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">* חצים מותאמים ל-RTL: ← = קדימה, → = אחורה</p>
          </div>
        )}
      </Wrapper>
    </TooltipProvider>
  );
}));
