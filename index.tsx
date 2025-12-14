import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Layout, Plus, Image as ImageIcon, MessageSquare, 
  Settings, User as UserIcon, LogOut, ChevronRight, 
  Play, MousePointer, Pen, Square, ArrowRight, Type, 
  Save, Trash2, X, Download, Shield, CreditCard,
  AlertTriangle, CheckCircle, Loader2, Clipboard,
  FileText, Briefcase, Menu, Zap, Eye, Target, BarChart3, ChevronDown, AlertCircle, ZoomIn, TrendingUp, Network,
  Map, Wand2
} from 'lucide-react';
import { 
    ReactFlow, 
    Controls, 
    Background, 
    useNodesState, 
    useEdgesState, 
    addEdge, 
    Handle, 
    Position,
    MarkerType,
    Node,
    Edge,
    Connection
} from '@xyflow/react';

import { User, Project, Flow, Screen, Annotation, ToolType, PLANS, AnalysisOptions } from './types';
import { geminiService, runGeminiUXAudit } from './services/geminiService';

// --- MOCK DATA & UTILS ---
const generateId = () => Math.random().toString(36).substr(2, 9);

const MOCK_USER: User = {
  id: 'u1',
  name: 'Alex Designer',
  email: 'alex@uxstudio.com',
  role: 'user',
  tokens: 1250,
  plan: 'pro'
};

// --- HELPER: METRICS PARSER ---
const getReportMetrics = (markdown: string) => {
    const scores = {
        ux: 0,
        wcag: 0,
        efficiency: 0,
        conversion: 0,
        ia: 0,
        hierarchy: 0,
        issues: { high: 0, medium: 0, low: 0 },
        hasSection: {
            ux: false,
            wcag: false,
            efficiency: false,
            conversion: false,
            ia: false,
            hierarchy: false,
            risks: false
        }
    };

    if (!markdown) return scores;

    // Helper to extract score safely
    const extractScore = (regex: RegExp) => {
        const match = markdown.match(regex);
        return match ? parseInt(match[1]) : 0;
    };

    scores.ux = extractScore(/UX[^0-9\n]*Score[^0-9\n]*(\d+)/i) || extractScore(/Heuristics?[^0-9\n]*Score[^0-9\n]*(\d+)/i);
    scores.wcag = extractScore(/Accessibility[^0-9\n]*Score[^0-9\n]*(\d+)/i) || extractScore(/WCAG[^0-9\n]*Score[^0-9\n]*(\d+)/i);
    scores.efficiency = extractScore(/Efficiency[^0-9\n]*Score[^0-9\n]*(\d+)/i) || extractScore(/Flow[^0-9\n]*Score[^0-9\n]*(\d+)/i);
    scores.conversion = extractScore(/Conversion[^0-9\n]*Score[^0-9\n]*(\d+)/i);
    scores.ia = extractScore(/Architecture[^0-9\n]*Score[^0-9\n]*(\d+)/i) || extractScore(/IA[^0-9\n]*Score[^0-9\n]*(\d+)/i);
    scores.hierarchy = extractScore(/Hierarchy[^0-9\n]*Score[^0-9\n]*(\d+)/i) || extractScore(/Visual[^0-9\n]*Score[^0-9\n]*(\d+)/i);

    // Detect Sections
    scores.hasSection.ux = /# Heuristics/i.test(markdown) || scores.ux > 0;
    scores.hasSection.wcag = /# WCAG/i.test(markdown) || scores.wcag > 0;
    scores.hasSection.efficiency = /# Flow/i.test(markdown) || scores.efficiency > 0;
    scores.hasSection.conversion = /# Conversion/i.test(markdown) || scores.conversion > 0;
    scores.hasSection.ia = /# Information Architecture/i.test(markdown) || scores.ia > 0;
    scores.hasSection.hierarchy = /# Visual Hierarchy/i.test(markdown) || scores.hierarchy > 0;
    scores.hasSection.risks = /# Risks/i.test(markdown);

    // Extract Issue Counts
    scores.issues.high = (markdown.match(/Severity[:\s-]*\**High/gi) || []).length;
    scores.issues.medium = (markdown.match(/Severity[:\s-]*\**Medium/gi) || []).length;
    scores.issues.low = (markdown.match(/Severity[:\s-]*\**Low/gi) || []).length;

    return scores;
};

// --- HELPER: EXTRACT RISKS JSON ---
interface UXRisk {
    title: string;
    whyItMatters: string;
    potentialImpact: string;
    screenIndex?: number;
    boundingBox?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
}

const getRisksFromReport = (markdown: string): UXRisk[] => {
    if (!markdown) return [];
    try {
        const jsonMatch = markdown.match(/```json\s*\{[\s\S]*?"uxRisks"[\s\S]*?\}\s*```/);
        if (jsonMatch && jsonMatch[0]) {
            const jsonStr = jsonMatch[0].replace(/```json/g, '').replace(/```/g, '');
            const data = JSON.parse(jsonStr);
            return data.uxRisks || [];
        }
        return [];
    } catch (e) {
        return [];
    }
};

// --- HELPER: EXTRACT SCREEN NAMES JSON ---
const getScreenNamesFromReport = (markdown: string): {index: number, name: string}[] => {
    if (!markdown) return [];
    try {
        // Regex to find the JSON block containing "screenNames"
        // We use non-greedy matching to extract just the block
        const match = markdown.match(/```json\s*\{[\s\S]*?"screenNames"[\s\S]*?\}\s*```/);
        if (match && match[0]) {
            const jsonStr = match[0].replace(/```json/g, '').replace(/```/g, '');
            const data = JSON.parse(jsonStr);
            return data.screenNames || [];
        }
        return [];
    } catch (e) {
        console.error("Failed to parse screen names", e);
        return [];
    }
};

// --- COMPONENTS ---

// 1. SCORE GAUGE CARD
const DashboardCard = ({ 
    score, 
    title, 
    icon: Icon, 
    colorClass,
    bgClass 
}: { 
    score: number, 
    title: string, 
    icon: any, 
    colorClass: string,
    bgClass: string
}) => {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  
  // Determine textual status
  let status = "Needs Work";
  if (score >= 80) status = "Excellent";
  else if (score >= 60) status = "Good";
  else if (score >= 40) status = "Fair";
  else if (score > 0) status = "Critical";
  else status = "Analyzed"; // If score is 0 but card is present

  return (
    <div className="bg-white rounded-xl border p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow h-full">
      <div className="flex items-center justify-between mb-3">
          <div className={`p-2 rounded-lg ${bgClass}`}>
             <Icon className={`w-5 h-5 ${colorClass}`} />
          </div>
          {score > 0 && (
             <div className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${score >= 70 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {status}
             </div>
          )}
      </div>
      
      <div className="flex items-center space-x-4">
          <div className="relative w-16 h-16 flex-none">
            <svg className="w-full h-full transform -rotate-90">
            <circle cx="32" cy="32" r={radius} stroke="currentColor" strokeWidth="4" fill="transparent" className="text-gray-100" />
            <circle cx="32" cy="32" r={radius} stroke="currentColor" strokeWidth="4" fill="transparent" 
                strokeDasharray={circumference} 
                strokeDashoffset={offset} 
                className={`transition-all duration-1000 ease-out ${colorClass}`} 
                strokeLinecap="round"
            />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-gray-900">{score || '-'}</span>
            </div>
          </div>
          <div>
              <h4 className="font-bold text-gray-900 leading-tight">{title}</h4>
              <p className="text-xs text-gray-500 mt-1">Audit Complete</p>
          </div>
      </div>
    </div>
  );
};

// 2. VISUAL DASHBOARD
const VisualDashboard = ({ report }: { report: string }) => {
    const metrics = useMemo(() => getReportMetrics(report), [report]);

    const getColor = (score: number, type: 'default' | 'text' = 'text') => {
        if (score >= 80) return type === 'text' ? 'text-green-500' : 'bg-green-50';
        if (score >= 50) return type === 'text' ? 'text-yellow-500' : 'bg-yellow-50';
        return type === 'text' ? 'text-red-500' : 'bg-red-50';
    };

    return (
        <div className="space-y-6 mb-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {metrics.hasSection.ux && (
                    <DashboardCard 
                        score={metrics.ux} 
                        title="UX Heuristics" 
                        icon={Target} 
                        colorClass={getColor(metrics.ux, 'text')}
                        bgClass={getColor(metrics.ux, 'default')}
                    />
                )}
                {metrics.hasSection.wcag && (
                    <DashboardCard 
                        score={metrics.wcag} 
                        title="Accessibility" 
                        icon={Eye} 
                        colorClass={getColor(metrics.wcag, 'text')}
                        bgClass={getColor(metrics.wcag, 'default')}
                    />
                )}
                {metrics.hasSection.efficiency && (
                    <DashboardCard 
                        score={metrics.efficiency} 
                        title="Flow Efficiency" 
                        icon={Zap} 
                        colorClass={getColor(metrics.efficiency, 'text')}
                        bgClass={getColor(metrics.efficiency, 'default')}
                    />
                )}
                {metrics.hasSection.conversion && (
                    <DashboardCard 
                        score={metrics.conversion} 
                        title="Conversion" 
                        icon={TrendingUp} 
                        colorClass={getColor(metrics.conversion, 'text')}
                        bgClass={getColor(metrics.conversion, 'default')}
                    />
                )}
                {metrics.hasSection.ia && (
                    <DashboardCard 
                        score={metrics.ia} 
                        title="Information Arch." 
                        icon={Network} 
                        colorClass={getColor(metrics.ia, 'text')}
                        bgClass={getColor(metrics.ia, 'default')}
                    />
                )}
                {metrics.hasSection.hierarchy && (
                    <DashboardCard 
                        score={metrics.hierarchy} 
                        title="Visual Hierarchy" 
                        icon={Layout} 
                        colorClass={getColor(metrics.hierarchy, 'text')}
                        bgClass={getColor(metrics.hierarchy, 'default')}
                    />
                )}
            </div>

            {/* Issues Breakdown */}
            <div className="bg-white border rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-700 mb-4 flex items-center">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    Detected Issues by Severity
                </h4>
                <div className="grid grid-cols-3 gap-4">
                    <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-center">
                        <span className="block text-2xl font-bold text-red-600">{metrics.issues.high}</span>
                        <span className="text-xs font-medium text-red-600 uppercase tracking-wide">High</span>
                    </div>
                    <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 text-center">
                        <span className="block text-2xl font-bold text-orange-600">{metrics.issues.medium}</span>
                        <span className="text-xs font-medium text-orange-600 uppercase tracking-wide">Medium</span>
                    </div>
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-center">
                        <span className="block text-2xl font-bold text-blue-600">{metrics.issues.low}</span>
                        <span className="text-xs font-medium text-blue-600 uppercase tracking-wide">Low</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// 3. ANNOTATION CANVAS
const AnnotationCanvas = ({ 
  screen, 
  selectedTool, 
  onUpdate 
}: { 
  screen: Screen; 
  selectedTool: ToolType; 
  onUpdate: (anns: Annotation[]) => void; 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentAnnotation, setCurrentAnnotation] = useState<Partial<Annotation> | null>(null);
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });

  // Load image to get dimensions
  useEffect(() => {
    const img = new Image();
    img.src = screen.originalImageUrl;
    img.onload = () => {
      setImageSize({ w: img.width, h: img.height });
    };
  }, [screen.originalImageUrl]);

  // Redraw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw existing annotations
    screen.annotations.forEach(ann => drawAnnotation(ctx, ann));

    // Draw current draft
    if (currentAnnotation) {
      drawAnnotation(ctx, currentAnnotation as Annotation);
    }
  }, [screen.annotations, currentAnnotation, imageSize]);

  const drawAnnotation = (ctx: CanvasRenderingContext2D, ann: Annotation) => {
    ctx.strokeStyle = ann.color;
    ctx.fillStyle = ann.color;
    ctx.lineWidth = ann.thickness || 3;
    ctx.beginPath();

    if (ann.type === 'rect') {
      ctx.strokeRect(ann.x, ann.y, ann.width || 0, ann.height || 0);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
      ctx.fillRect(ann.x, ann.y, ann.width || 0, ann.height || 0);
    } else if (ann.type === 'arrow' && ann.points) {
      const [x1, y1, x2, y2] = ann.points;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      
      // Arrowhead
      const headlen = 15;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    } else if (ann.type === 'freehand' && ann.points) {
      if (ann.points.length < 2) return;
      ctx.moveTo(ann.points[0], ann.points[1]);
      for (let i = 2; i < ann.points.length; i += 2) {
        ctx.lineTo(ann.points[i], ann.points[i + 1]);
      }
      ctx.stroke();
    } else if (ann.type === 'text' && ann.text) {
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = 'red';
      ctx.fillText(ann.text, ann.x, ann.y + 20);
    }
  };

  const getCoords = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (selectedTool === ToolType.SELECT) return;
    const { x, y } = getCoords(e);
    setIsDrawing(true);

    if (selectedTool === ToolType.TEXT) {
      const text = prompt("Enter annotation note:");
      if (text) {
        const newAnn: Annotation = {
          id: generateId(),
          type: 'text',
          x, y, color: '#ef4444', text, thickness: 2
        };
        onUpdate([...screen.annotations, newAnn]);
      }
      setIsDrawing(false);
      return;
    }

    setCurrentAnnotation({
      id: generateId(),
      type: selectedTool.toLowerCase() as any,
      x, y,
      width: 0, height: 0,
      points: [x, y],
      color: '#ef4444',
      thickness: 3
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !currentAnnotation) return;
    const { x, y } = getCoords(e);

    if (currentAnnotation.type === 'rect') {
      setCurrentAnnotation(prev => ({
        ...prev,
        width: x - (prev!.x || 0),
        height: y - (prev!.y || 0)
      }));
    } else if (currentAnnotation.type === 'arrow') {
      setCurrentAnnotation(prev => ({
        ...prev,
        points: [prev!.points![0], prev!.points![1], x, y]
      }));
    } else if (currentAnnotation.type === 'freehand') {
      setCurrentAnnotation(prev => ({
        ...prev,
        points: [...(prev!.points || []), x, y]
      }));
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && currentAnnotation) {
      onUpdate([...screen.annotations, currentAnnotation as Annotation]);
    }
    setIsDrawing(false);
    setCurrentAnnotation(null);
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-auto flex justify-center items-start bg-gray-100 p-8 shadow-inner">
      <div className="relative shadow-2xl">
        <img 
          src={screen.originalImageUrl} 
          className="max-w-none block select-none"
          style={{ width: imageSize.w || 'auto', height: imageSize.h || 'auto', maxHeight: 'none' }}
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          width={imageSize.w}
          height={imageSize.h}
          className="absolute top-0 left-0 cursor-crosshair"
          style={{ width: '100%', height: '100%' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
    </div>
  );
};

// 4. LIGHTBOX FOR RISKS
const RiskLightbox = ({ screen, risks, onClose }: { screen: Screen, risks: UXRisk[], onClose: () => void }) => {
    return (
        <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col animate-in fade-in duration-200">
            <div className="h-14 flex items-center justify-between px-6 text-white flex-none">
                <div className="font-bold">{screen.name}</div>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
                    <X className="w-6 h-6" />
                </button>
            </div>
            <div className="flex-1 p-6 flex items-center justify-center overflow-auto">
                <div className="relative inline-block max-w-full max-h-full shadow-2xl">
                    <img src={screen.originalImageUrl} className="max-w-full max-h-[85vh] block rounded" />
                    {/* Render Risk Boxes */}
                    {risks.map((risk, i) => {
                        if (!risk.boundingBox) return null;
                        const [ymin, xmin, ymax, xmax] = risk.boundingBox;
                        // Coordinates are 0-1000. Convert to %.
                        const style = {
                            top: `${ymin / 10}%`,
                            left: `${xmin / 10}%`,
                            height: `${(ymax - ymin) / 10}%`,
                            width: `${(xmax - xmin) / 10}%`
                        };
                        return (
                            <div key={i} className="absolute border-4 border-red-500 bg-red-500/10 group cursor-help z-10" style={style}>
                                <div className="absolute -top-10 left-0 bg-red-600 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                                    <div className="font-bold">Risk #{i + 1}: {risk.title}</div>
                                </div>
                                <div className="absolute -top-3 -right-3 w-6 h-6 bg-red-600 rounded-full text-white flex items-center justify-center text-xs font-bold border-2 border-white shadow-sm">
                                    {i + 1}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="h-20 bg-white border-t p-4 flex-none overflow-x-auto">
                <div className="flex space-x-6">
                    {risks.map((risk, i) => (
                        <div key={i} className="flex items-start space-x-2 min-w-[200px]">
                            <div className="w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i + 1}</div>
                            <div>
                                <div className="text-xs font-bold text-gray-900">{risk.title}</div>
                                <div className="text-[10px] text-gray-500 line-clamp-2">{risk.whyItMatters}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// 5. MARKDOWN VIEWER
const MarkdownView = ({ content }: { content: string }) => {
  // Simple parser to handle bolding and badges within text
  const parseLine = (text: string) => {
    // 1. Handle Bold (**text**)
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const content = part.slice(2, -2);
        // Check for specific keywords to badge
        if (content.toLowerCase().includes('high')) return <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 mx-1 border border-red-200 shadow-sm uppercase tracking-wide">{content}</span>;
        if (content.toLowerCase().includes('medium')) return <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-800 mx-1 border border-orange-200 shadow-sm uppercase tracking-wide">{content}</span>;
        if (content.toLowerCase().includes('low')) return <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800 mx-1 border border-green-200 shadow-sm uppercase tracking-wide">{content}</span>;
        if (content.toLowerCase().includes('pass')) return <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800 mx-1 border border-green-200 uppercase tracking-wide">{content}</span>;
        if (content.toLowerCase().includes('fail')) return <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 mx-1 border border-red-200 uppercase tracking-wide">{content}</span>;

        return <strong key={i} className="font-bold text-gray-900">{content}</strong>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  const lines = content.split('\n');
  let inJsonBlock = false;
  
  return (
    <div className="space-y-3 font-sans text-slate-600 leading-relaxed bg-white rounded-lg p-1">
      {lines.map((line, i) => {
        // Handle JSON block filtering
        if (line.trim().startsWith('```json')) {
            inJsonBlock = true;
            return null;
        }
        if (inJsonBlock && line.trim() === '```') {
            inJsonBlock = false;
            return null;
        }
        if (inJsonBlock) return null;

        // H1 - Main Titles
        if (line.startsWith('# ')) {
            return (
                <div key={i} className="mt-8 mb-6 pb-4 border-b-2 border-slate-100">
                    <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">{line.slice(2)}</h1>
                </div>
            );
        }
        
        // H2 - Major Sections (like "UX Heuristics", "Accessibility")
        if (line.startsWith('## ')) {
            const title = line.slice(3);
            let icon = <Target className="w-5 h-5 mr-3 text-brand-600" />;
            let bgClass = "bg-brand-50 border-brand-100";
            
            if (title.includes('Accessibility') || title.includes('WCAG')) {
                icon = <Eye className="w-5 h-5 mr-3 text-green-600" />;
                bgClass = "bg-green-50 border-green-100";
            }
            if (title.includes('Efficiency') || title.includes('Flow')) {
                icon = <Zap className="w-5 h-5 mr-3 text-purple-600" />;
                bgClass = "bg-purple-50 border-purple-100";
            }
            if (title.includes('Conversion') || title.includes('Friction')) {
                icon = <TrendingUp className="w-5 h-5 mr-3 text-pink-600" />;
                bgClass = "bg-pink-50 border-pink-100";
            }
            if (title.includes('Information') || title.includes('Architecture') || title.includes('IA')) {
                icon = <Network className="w-5 h-5 mr-3 text-indigo-600" />;
                bgClass = "bg-indigo-50 border-indigo-100";
            }
             if (title.includes('Visual') || title.includes('Hierarchy')) {
                icon = <Layout className="w-5 h-5 mr-3 text-teal-600" />;
                bgClass = "bg-teal-50 border-teal-100";
            }
            if (title.includes('Fix') || title.includes('Recommendation') || title.includes('Summary')) {
                icon = <CheckCircle className="w-5 h-5 mr-3 text-blue-600" />;
                bgClass = "bg-blue-50 border-blue-100";
            }
            if (title.includes('Issue') || title.includes('Severity')) {
                icon = <AlertTriangle className="w-5 h-5 mr-3 text-orange-600" />;
                bgClass = "bg-orange-50 border-orange-100";
            }
            
            return (
                <div key={i} className={`mt-10 mb-4 flex items-center p-4 rounded-xl border ${bgClass} shadow-sm`}>
                    <div className="bg-white p-2 rounded-lg shadow-sm">{icon}</div>
                    <h2 className="text-xl font-bold text-slate-800 ml-1">{title}</h2>
                </div>
            );
        }

        // H3 - Subsections (Specific Issues)
        if (line.startsWith('### ')) {
            return (
                <h3 key={i} className="text-lg font-bold text-slate-800 mt-6 mb-2 flex items-center group">
                    <div className="w-1 h-5 bg-brand-500 rounded-full mr-3 opacity-50 group-hover:opacity-100 transition-opacity"></div>
                    {line.slice(4)}
                </h3>
            );
        }

        // List Items
        if (line.startsWith('- ') || line.startsWith('* ')) {
            return (
                <div key={i} className="flex items-start mb-2 ml-1 group">
                    <div className="mt-2 mr-3 min-w-[6px] h-1.5 rounded-full bg-slate-300 group-hover:bg-brand-400 transition-colors"></div>
                    <p className="text-sm md:text-base">{parseLine(line.slice(2))}</p>
                </div>
            );
        }
        
        // Severity / Key-Value lines specially styled (if they appear as paragraphs)
        if (line.includes('Severity:') || line.includes('Score:')) {
             return (
                 <div key={i} className="inline-block my-2 py-1 px-3 bg-gray-50 rounded border border-gray-100 text-sm">
                    {parseLine(line)}
                 </div>
             )
        }

        // Table Row Fallback
        if (line.startsWith('|')) {
            return <pre key={i} className="bg-gray-50 p-3 rounded-lg text-xs overflow-x-auto border border-gray-200 text-gray-700 font-mono my-2">{line}</pre>; 
        }

        // Skip normal block closing triple-ticks if not handled by inJsonBlock (e.g. malformed)
        if (line.trim() === '```') return null;

        // Empty lines
        if (line.trim() === '') return <div key={i} className="h-2"></div>;

        // Normal Paragraphs
        return <p key={i} className="text-sm md:text-base mb-2 text-slate-600">{parseLine(line)}</p>;
      })}
    </div>
  );
};

// --- REACT FLOW MODULES ---

// 6. CUSTOM NODE: ImageFlowNode
const ImageFlowNode = ({ data }: { data: any }) => {
    return (
        <div className="shadow-lg rounded-lg bg-white border border-gray-200 overflow-hidden w-48 group hover:ring-2 ring-brand-500 transition-all">
            <Handle type="target" position={Position.Left} className="!bg-brand-500 !w-3 !h-3" />
            <div className="h-28 bg-gray-100 relative">
                <img src={data.imageUrl} className="w-full h-full object-cover" alt={data.label} />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            </div>
            <div className="p-2 border-t border-gray-100 bg-white">
                <div className="text-xs font-bold text-gray-900 truncate">{data.label}</div>
                <div className="text-[10px] text-gray-500 truncate">{data.description || 'No description'}</div>
            </div>
            <Handle type="source" position={Position.Right} className="!bg-brand-500 !w-3 !h-3" />
        </div>
    );
};

const nodeTypes = {
    imageNode: ImageFlowNode
};

// 7. FLOW EDITOR MODULE
const FlowEditorModule = ({ 
    activeFlow, 
    updateFlow, 
    setActiveScreenIndex 
}: { 
    activeFlow: Flow, 
    updateFlow: (f: Flow) => void,
    setActiveScreenIndex: (i: number) => void
}) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    // Initialize Graph from Flow Data or Screens
    useEffect(() => {
        if (activeFlow.graphData) {
            setNodes(activeFlow.graphData.nodes || []);
            setEdges(activeFlow.graphData.edges || []);
        } else {
            // Initial Sync: Create nodes from screens if no graph data exists
            const initialNodes = activeFlow.screens.map((screen, index) => ({
                id: screen.id,
                type: 'imageNode',
                position: { x: index * 250, y: 100 }, // Simple horizontal layout
                data: { 
                    label: screen.name, 
                    imageUrl: screen.originalImageUrl,
                    description: screen.description 
                },
            }));
            setNodes(initialNodes);
        }
    }, [activeFlow.id]); // Only reset on flow switch

    // Sync Node Labels with Screen Names (if changed by AI)
    useEffect(() => {
        setNodes((nds) => nds.map((node) => {
            // Find corresponding screen. We assume node.id === screen.id based on initial creation logic
            const screen = activeFlow.screens.find(s => s.id === node.id);
            if (screen && screen.name !== node.data.label) {
                return { 
                    ...node, 
                    data: { ...node.data, label: screen.name } 
                };
            }
            return node;
        }));
    }, [activeFlow.screens, setNodes]);

    // Persist Graph Changes
    const saveTimeout = useRef<any>(null);
    const persistGraph = useCallback((newNodes: Node[], newEdges: Edge[]) => {
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(() => {
            updateFlow({
                ...activeFlow,
                graphData: { nodes: newNodes, edges: newEdges }
            });
        }, 1000); // Debounce saves
    }, [activeFlow, updateFlow]);

    useEffect(() => {
        if (nodes.length > 0 || edges.length > 0) {
            persistGraph(nodes, edges);
        }
    }, [nodes, edges, persistGraph]);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
        [setEdges],
    );

    // Auto-Infer Logic (Simple Heuristic)
    const handleAutoInfer = () => {
        if (activeFlow.screens.length < 2) return;
        
        const newEdges: Edge[] = [];
        // Connect sequentially 
        for (let i = 0; i < activeFlow.screens.length - 1; i++) {
            const source = activeFlow.screens[i].id;
            const target = activeFlow.screens[i+1].id;
            
            // Avoid duplicate edges
            const exists = edges.some(e => e.source === source && e.target === target);
            if (!exists) {
                newEdges.push({
                    id: `e-${source}-${target}`,
                    source,
                    target,
                    type: 'default',
                    label: 'Next',
                    animated: true,
                    style: { strokeDasharray: '5,5' }, // Dashed for "Suggested"
                    markerEnd: { type: MarkerType.ArrowClosed }
                });
            }
        }
        setEdges(prev => [...prev, ...newEdges]);
    };

    const handleCenterNode = (screenId: string) => {
        // Find node position (would require ReactFlow instance ref ideally, simple scroll for now is hard without instance)
        // For this MVP, we just highlight the node in the strip
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Top Thumbnail Strip for Navigation */}
            <div className="h-20 bg-white border-b flex items-center px-4 space-x-2 overflow-x-auto flex-none z-10 shadow-sm">
                 <span className="text-xs font-bold text-gray-500 uppercase mr-2">Screens:</span>
                 {activeFlow.screens.map((screen, idx) => (
                     <button 
                        key={screen.id}
                        onClick={() => setActiveScreenIndex(idx)} // Just sets index for property panel
                        className="h-14 w-20 relative border rounded overflow-hidden hover:ring-2 ring-brand-500 transition-all flex-shrink-0"
                     >
                         <img src={screen.originalImageUrl} className="w-full h-full object-cover" />
                         <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-[10px] text-white truncate px-1">
                             {screen.name}
                         </div>
                     </button>
                 ))}
                 <div className="w-px h-8 bg-gray-300 mx-2"></div>
                 <button 
                    onClick={handleAutoInfer}
                    className="flex flex-col items-center justify-center px-3 py-1 text-brand-600 hover:bg-brand-50 rounded border border-brand-200"
                 >
                     <Wand2 className="w-4 h-4 mb-1" />
                     <span className="text-[10px] font-bold">Auto-Connect</span>
                 </button>
            </div>

            {/* React Flow Canvas */}
            <div className="flex-1 w-full h-full">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    nodeTypes={nodeTypes}
                    fitView
                    className="bg-gray-100"
                >
                    <Background />
                    <Controls />
                </ReactFlow>
            </div>
        </div>
    );
};

// 8. MAIN APP STRUCTURE
const App = () => {
  const [user, setUser] = useState<User>(MOCK_USER);
  
  // Initialize projects from localStorage if available
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
        const saved = localStorage.getItem('ux_projects');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error("Failed to load projects", e);
        return [];
    }
  });

  // Persist projects to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('ux_projects', JSON.stringify(projects));
  }, [projects]);

  const [currentView, setCurrentView] = useState<'projects' | 'reports' | 'account' | 'admin'>('projects');
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeFlow, setActiveFlow] = useState<Flow | null>(null);
  
  // EDITOR MODE: 'annotate' (Screen Editor) vs 'flow' (Node Editor)
  const [editorMode, setEditorMode] = useState<'annotate' | 'flow'>('annotate');

  // Separate state to view a report modal without activating the full editor flow
  const [viewingReportFlow, setViewingReportFlow] = useState<Flow | null>(null);
  
  // State for the enlarged risk view
  const [enlargedScreen, setEnlargedScreen] = useState<Screen | null>(null);

  const [activeScreenIndex, setActiveScreenIndex] = useState(0);
  const [selectedTool, setSelectedTool] = useState<ToolType>(ToolType.SELECT);
  
  // Create Project Modal State
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [newProjectType, setNewProjectType] = useState<Project['type']>('Other');
  
  // Report Modal State
  const [showReportModal, setShowReportModal] = useState(false);
  
  // Loading State
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  // Table Expansion State
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());

  // Analysis Options State
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>({
    heuristics: true,
    wcag: true,
    efficiency: true,
    risks: true,
    conversion: true,
    ia: true,
    hierarchy: true
  });

  // --- ACTIONS ---
  
  const toggleProjectExpand = (projectId: string) => {
    setExpandedProjectIds(prev => {
        const next = new Set(prev);
        if (next.has(projectId)) next.delete(projectId);
        else next.add(projectId);
        return next;
    });
  };

  const handleCreateProject = () => {
    if (!newProjectTitle.trim()) return;

    const newProject: Project = {
      id: generateId(),
      userId: user.id,
      title: newProjectTitle,
      type: newProjectType,
      flows: [],
      createdAt: Date.now()
    };
    
    // Use functional update to ensure we have the latest state and trigger re-renders
    setProjects(prev => [...prev, newProject]);
    setShowCreateProject(false);
    setNewProjectTitle('');
    setNewProjectType('Other');
  };

  const handleCreateFlow = () => {
    if (!activeProject) return;
    const newFlow: Flow = {
      id: generateId(),
      projectId: activeProject.id,
      name: 'New User Flow',
      description: 'Describe this flow...',
      screens: [],
      chatHistory: [],
      lastUpdated: Date.now()
    };
    
    // Optimistic update for activeProject
    const updatedProject = { ...activeProject, flows: [...activeProject.flows, newFlow] };
    setActiveProject(updatedProject);
    setActiveFlow(newFlow);
    setEditorMode('annotate'); // Default to annotation
    
    // Functional update for projects list to ensure safety
    setProjects(prev => prev.map(p => p.id === activeProject.id ? updatedProject : p));
  };

  const updateFlow = (flow: Flow) => {
    // 1. Update the immediate active flow state (for UI responsiveness)
    setActiveFlow(flow);

    // 2. Update the Global Project List using functional update (prevents stale state issues)
    setProjects(prevProjects => {
        return prevProjects.map(p => {
            if (p.id === flow.projectId) {
                return {
                    ...p,
                    flows: p.flows.map(f => f.id === flow.id ? flow : f)
                };
            }
            return p;
        });
    });

    // 3. Update Active Project if it matches the flow's project
    // We use a functional update here too to ensure we don't overwrite other concurrent changes
    if (activeProject && activeProject.id === flow.projectId) {
        setActiveProject(prev => {
            if (!prev) return null;
            return {
                ...prev,
                flows: prev.flows.map(f => f.id === flow.id ? flow : f)
            };
        });
    }
  };

  const handleUploadScreens = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !activeFlow) return;
    const files = Array.from(e.target.files);

    const fileReaders = files.map(file => {
      return new Promise<Screen>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          resolve({
            id: generateId(),
            flowId: activeFlow.id,
            originalImageUrl: ev.target?.result as string,
            name: file.name,
            description: '',
            order: activeFlow.screens.length, 
            annotations: []
          });
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(fileReaders).then(newScreens => {
      // Fix ordering
      const startOrder = activeFlow.screens.length;
      const orderedNewScreens = newScreens.map((s, i) => ({ ...s, order: startOrder + i }));
      
      const updatedFlow = { ...activeFlow, screens: [...activeFlow.screens, ...orderedNewScreens] };
      updateFlow(updatedFlow);
    });
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!activeFlow) return;
    const items = e.clipboardData.items;
    const imageBlobs: File[] = [];

    // 1. Collect all images first
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) imageBlobs.push(blob);
      }
    }

    if (imageBlobs.length === 0) return;
    
    e.preventDefault(); // Prevent text paste if images are found

    // 2. Convert all to Screens in parallel
    const screenPromises = imageBlobs.map((blob, index) => {
      return new Promise<Screen>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          resolve({
            id: generateId(),
            flowId: activeFlow.id,
            originalImageUrl: ev.target?.result as string,
            name: `Pasted Image ${Date.now()}-${index}`,
            description: '',
            order: 0, // Will assign proper order after
            annotations: []
          });
        };
        reader.readAsDataURL(blob);
      });
    });

    // 3. Wait for all to load and do a SINGLE state update to avoid race conditions
    const newScreens = await Promise.all(screenPromises);
    
    const startOrder = activeFlow.screens.length;
    const orderedNewScreens = newScreens.map((s, i) => ({ ...s, order: startOrder + i }));

    const updatedFlow = { 
        ...activeFlow, 
        screens: [...activeFlow.screens, ...orderedNewScreens] 
    };
    updateFlow(updatedFlow);
  };

  const updateActiveScreen = (updates: Partial<Screen>) => {
    if (!activeFlow) return;
    const screens = [...activeFlow.screens];
    screens[activeScreenIndex] = { ...screens[activeScreenIndex], ...updates };
    updateFlow({ ...activeFlow, screens });
  };

  const handleAnalyze = async () => {
    if (!activeFlow || user.tokens < 10) {
        window.alert("Not enough tokens (requires 10).");
        return;
    }
    if (activeFlow.screens.length === 0) {
        window.alert("Please add at least one screenshot.");
        return;
    }
    // Ensure at least one option is selected
    if (!Object.values(analysisOptions).some(Boolean)) {
        window.alert("Please select at least one analysis type.");
        return;
    }

    try {
        setIsProcessing(true);
        // Map data using existing state properties
        const images = activeFlow.screens.map(s => s.originalImageUrl);
        const descriptions = activeFlow.screens.map(s => s.description || "");
        
        const report = await runGeminiUXAudit({ 
            flowName: activeFlow.name, 
            images, 
            descriptions,
            options: analysisOptions
        });

        // Parse screen names from report
        const parsedNames = getScreenNamesFromReport(report);
        let updatedScreens = [...activeFlow.screens];
        let updatedGraphData = activeFlow.graphData;

        // Apply new names to screens
        if (parsedNames.length > 0) {
            updatedScreens = updatedScreens.map((s, idx) => {
                const found = parsedNames.find(p => p.index === idx);
                return found ? { ...s, name: found.name } : s;
            });

            // Apply new names to graph nodes if they exist
            if (updatedGraphData && updatedGraphData.nodes) {
                const newNodes = updatedGraphData.nodes.map((node: any) => {
                    const screen = updatedScreens.find(s => s.id === node.id);
                    if (screen) {
                        return { ...node, data: { ...node.data, label: screen.name } };
                    }
                    return node;
                });
                updatedGraphData = { ...updatedGraphData, nodes: newNodes };
            }
        }

        // Update flow with report, new timestamp, and potentially new names
        updateFlow({ 
            ...activeFlow, 
            screens: updatedScreens,
            graphData: updatedGraphData,
            analysisReport: report, 
            lastUpdated: Date.now() 
        });
        
        setUser({ ...user, tokens: user.tokens - 10 });
        setShowReportModal(true); // Open modal on success
        
    } catch (err) {
        console.error("Audit error:", err);
        window.alert("There was an error running the audit.");
    } finally {
        setIsProcessing(false);
    }
  };

  const handleSaveAndClose = () => {
      setShowReportModal(false);
      setTimeout(() => {
          if (viewingReportFlow) {
            setViewingReportFlow(null);
          } else {
            setActiveFlow(null);
            setCurrentView('reports');
          }
      }, 100);
  };

  const handleViewAnalysis = (flow: Flow) => {
    setViewingReportFlow(flow);
    setShowReportModal(true);
  };

  // Derived state to determine which flow to show in modal
  const flowToDisplay = activeFlow || viewingReportFlow;

  const handleExport = () => {
    const target = flowToDisplay;
    if (!target) return;

    // Create a print window
    const printContent = document.getElementById('report-print-content');
    if (!printContent) {
        // Fallback to Markdown download if DOM element not found (shouldn't happen)
        const blob = new Blob([target.analysisReport || 'No report'], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${target.name}-Report.md`;
        a.click();
        return;
    }
    
    const projectTitle = projects.find(p => p.id === target.projectId)?.title || 'Project';

    const win = window.open('', '', 'width=900,height=800');
    if (!win) return;

    win.document.write(`
      <html>
        <head>
          <title>UX Audit Report - ${target.name}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            @media print {
              body { -webkit-print-color-adjust: exact; }
              .no-print { display: none; }
            }
            body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
            /* Force wrapping for thumbnails in print */
            .overflow-x-auto { overflow: visible !important; }
            .flex.space-x-3 { flex-wrap: wrap; gap: 1rem; space-x: 0; }
          </style>
        </head>
        <body class="bg-white p-10 text-slate-900">
          <div class="mb-8 border-b pb-6">
             <div class="flex items-center justify-between">
                 <div>
                    <h1 class="text-3xl font-bold text-slate-900 mb-2">UX Audit Report</h1>
                    <p class="text-lg text-slate-600">${projectTitle} <span class="mx-2 text-slate-300">|</span> ${target.name}</p>
                 </div>
                 <div class="text-right">
                    <div class="text-sm text-slate-400">Generated on</div>
                    <div class="font-medium text-slate-700">${new Date().toLocaleDateString()}</div>
                 </div>
             </div>
          </div>
          
          <div class="report-content">
            ${printContent.innerHTML}
          </div>

          <div class="mt-12 pt-6 border-t text-center text-slate-400 text-sm">
            Generated by UX Audit AI
          </div>

          <script>
            // Wait for images and Tailwind to load
            setTimeout(() => {
                window.print();
                // window.close(); // Optional: keep open if user cancels print to check why
            }, 1500);
          </script>
        </body>
      </html>
    `);
    win.document.close();
  };

  const activeScreen = activeFlow ? activeFlow.screens[activeScreenIndex] : null;

  return (
    <div className="flex h-screen bg-gray-50 text-slate-900 font-sans flex-col">
      {/* GLOBAL HEADER */}
      <header className="bg-slate-900 text-white shadow-md z-30 flex-none">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                  <img 
                      src="https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=100&auto=format&fit=crop" 
                      alt="UX Audit AI Logo" 
                      className="w-8 h-8 rounded-lg object-cover" 
                  />
                  <span className="font-bold text-xl tracking-tight">UX Audit AI</span>
              </div>
              
              <nav className="flex items-center space-x-1">
                  <button 
                      onClick={() => { setActiveFlow(null); setCurrentView('projects'); }}
                      className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2 ${currentView === 'projects' && !activeFlow ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                  >
                      <Briefcase className="w-4 h-4" />
                      <span>Projects</span>
                  </button>
                  <button 
                      onClick={() => { setActiveFlow(null); setCurrentView('reports'); }}
                      className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2 ${currentView === 'reports' ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                  >
                      <FileText className="w-4 h-4" />
                      <span>UX Audit Reports</span>
                  </button>
                  <button 
                      onClick={() => { setActiveFlow(null); setCurrentView('account'); }}
                      className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2 ${currentView === 'account' ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                  >
                      <UserIcon className="w-4 h-4" />
                      <span>Manage Account</span>
                  </button>
                  {user.role === 'admin' && (
                      <button 
                          onClick={() => { setActiveFlow(null); setCurrentView('admin'); }}
                          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2 ${currentView === 'admin' ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                      >
                          <Shield className="w-4 h-4" />
                          <span>Admin</span>
                      </button>
                  )}
              </nav>

              <div className="flex items-center space-x-4">
                   <div className="text-right hidden md:block">
                       <div className="text-sm font-medium text-white">{user.name}</div>
                       <div className="text-xs text-slate-400">{user.email}</div>
                   </div>
                   <div className="w-8 h-8 rounded-full bg-brand-700 flex items-center justify-center text-sm font-bold border-2 border-slate-700">
                       {user.name.charAt(0)}
                   </div>
              </div>
          </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-hidden relative flex flex-col">
        
        {/* === FLOW EDITOR MODE === */}
        {activeFlow ? (
            <div className="flex flex-1 bg-gray-50 flex-col overflow-hidden">
                {/* Editor Header */}
                <header className="h-16 bg-white border-b flex items-center justify-between px-4 z-20 flex-none">
                <div className="flex items-center space-x-4">
                    <button onClick={() => setActiveFlow(null)} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 flex items-center space-x-2">
                    <ArrowRight className="w-5 h-5 rotate-180" />
                    <span className="text-sm font-medium">Back to Projects</span>
                    </button>
                    <div className="h-6 w-px bg-gray-300 mx-2"></div>
                    <div>
                    <input 
                        value={activeFlow.name} 
                        onChange={(e) => updateFlow({ ...activeFlow, name: e.target.value })}
                        className="font-bold text-lg text-gray-900 border-none focus:ring-0 p-0"
                    />
                    <p className="text-xs text-gray-500">
                        {activeFlow.screens.length} Screens • {activeProject?.title}
                    </p>
                    </div>
                </div>
                
                {/* Mode Toggle Switch */}
                <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                    <button
                        onClick={() => setEditorMode('annotate')}
                        className={`px-3 py-1.5 rounded text-xs font-bold flex items-center transition-all ${editorMode === 'annotate' ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        <Pen className="w-3 h-3 mr-1.5" /> Annotate Screens
                    </button>
                    <button
                        onClick={() => setEditorMode('flow')}
                        className={`px-3 py-1.5 rounded text-xs font-bold flex items-center transition-all ${editorMode === 'flow' ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                        <Map className="w-3 h-3 mr-1.5" /> Map Flow
                    </button>
                </div>

                <div className="flex items-center space-x-6">
                    {/* ANALYSIS OPTIONS CHECKBOXES */}
                    <div className="flex items-center space-x-3 border-r border-gray-200 pr-4">
                        <label className="flex items-center space-x-1 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={analysisOptions.heuristics} 
                                onChange={(e) => setAnalysisOptions(p => ({ ...p, heuristics: e.target.checked }))}
                                className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500 border-gray-300" 
                            />
                            <span className="text-xs font-medium text-gray-700">Heuristics</span>
                        </label>
                        <label className="flex items-center space-x-1 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={analysisOptions.wcag} 
                                onChange={(e) => setAnalysisOptions(p => ({ ...p, wcag: e.target.checked }))}
                                className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500 border-gray-300" 
                            />
                            <span className="text-xs font-medium text-gray-700">WCAG</span>
                        </label>
                        <label className="flex items-center space-x-1 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={analysisOptions.efficiency} 
                                onChange={(e) => setAnalysisOptions(p => ({ ...p, efficiency: e.target.checked }))}
                                className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500 border-gray-300" 
                            />
                            <span className="text-xs font-medium text-gray-700">Flow</span>
                        </label>
                        <label className="flex items-center space-x-1 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={analysisOptions.risks} 
                                onChange={(e) => setAnalysisOptions(p => ({ ...p, risks: e.target.checked }))}
                                className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500 border-gray-300" 
                            />
                            <span className="text-xs font-medium text-gray-700">Risks</span>
                        </label>
                        <label className="flex items-center space-x-1 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={analysisOptions.conversion} 
                                onChange={(e) => setAnalysisOptions(p => ({ ...p, conversion: e.target.checked }))}
                                className="w-3.5 h-3.5 text-pink-600 rounded focus:ring-pink-500 border-gray-300" 
                            />
                            <span className="text-xs font-bold text-pink-700">Conversion</span>
                        </label>
                        <label className="flex items-center space-x-1 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={analysisOptions.ia} 
                                onChange={(e) => setAnalysisOptions(p => ({ ...p, ia: e.target.checked }))}
                                className="w-3.5 h-3.5 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300" 
                            />
                            <span className="text-xs font-bold text-indigo-700">IA</span>
                        </label>
                         <label className="flex items-center space-x-1 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={analysisOptions.hierarchy} 
                                onChange={(e) => setAnalysisOptions(p => ({ ...p, hierarchy: e.target.checked }))}
                                className="w-3.5 h-3.5 text-teal-600 rounded focus:ring-teal-500 border-gray-300" 
                            />
                            <span className="text-xs font-bold text-teal-700">Hierarchy</span>
                        </label>
                    </div>

                    <div className="px-3 py-1 bg-brand-50 text-brand-600 rounded-full text-sm font-medium flex items-center">
                        <Shield className="w-3 h-3 mr-2" />
                        {user.tokens} Tokens
                    </div>
                    <button 
                        onClick={handleAnalyze}
                        disabled={isProcessing}
                        className="flex items-center space-x-2 bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                        <span>{isProcessing ? 'Running Analysis...' : 'Run UX Audit'}</span>
                    </button>
                </div>
                </header>

                <div className="flex flex-1 overflow-hidden">
                
                {editorMode === 'flow' ? (
                     // === NEW FLOW EDITOR VIEW ===
                     <div className="flex-1 bg-white relative">
                        <FlowEditorModule 
                            activeFlow={activeFlow} 
                            updateFlow={updateFlow} 
                            setActiveScreenIndex={setActiveScreenIndex}
                        />
                     </div>
                ) : (
                    // === EXISTING ANNOTATION VIEW ===
                    <>
                        {/* Left: Thumbnails & Upload */}
                        <div className="w-64 bg-white border-r flex flex-col z-10">
                            <div className="p-4 border-b space-y-3">
                            <label className="flex items-center justify-center w-full h-10 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-colors">
                                <span className="text-sm font-medium text-gray-600">+ Add Screenshots</span>
                                <input type="file" multiple accept="image/*" onChange={handleUploadScreens} className="hidden" />
                            </label>

                            <div 
                                className="flex flex-col items-center justify-center w-full h-16 border-2 border-blue-100 bg-blue-50 rounded-lg cursor-text hover:bg-blue-100 focus:ring-2 focus:ring-brand-500 focus:outline-none transition-colors text-brand-700 text-xs text-center select-none"
                                tabIndex={0}
                                onPaste={handlePaste}
                            >
                                <div className="flex flex-col items-center space-y-1">
                                    <Clipboard className="w-4 h-4" />
                                    <span className="font-semibold">Click here & Paste (Ctrl+V)</span>
                                    <span className="text-[10px] opacity-70">Supports multiple images</span>
                                </div>
                            </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {activeFlow.screens.map((screen, idx) => (
                                <div 
                                key={screen.id} 
                                onClick={() => setActiveScreenIndex(idx)}
                                className={`p-2 rounded border cursor-pointer group relative ${idx === activeScreenIndex ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-gray-200 hover:border-gray-300'}`}
                                >
                                <div className="aspect-video bg-gray-100 mb-2 overflow-hidden rounded relative">
                                    <img src={screen.originalImageUrl} className="w-full h-full object-cover" />
                                    {screen.annotations.length > 0 && (
                                    <div className="absolute top-1 right-1 bg-red-500 text-white text-[10px] px-1 rounded">
                                        {screen.annotations.length}
                                    </div>
                                    )}
                                </div>
                                <div className="text-xs font-medium truncate text-gray-700">
                                    {idx + 1}. {screen.name}
                                </div>
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const newScreens = activeFlow.screens.filter(s => s.id !== screen.id);
                                        updateFlow({ ...activeFlow, screens: newScreens });
                                        if (activeScreenIndex >= newScreens.length) setActiveScreenIndex(Math.max(0, newScreens.length - 1));
                                    }}
                                    className="absolute top-2 right-2 p-1 bg-white rounded shadow opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                                </div>
                            ))}
                            </div>
                        </div>

                        {/* Center: Canvas / Editor */}
                        <div className="flex-1 flex flex-col relative bg-gray-100">
                            {activeScreen ? (
                            <>
                                {/* Toolbar */}
                                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg border p-1 flex items-center space-x-1 z-10">
                                {[
                                    { type: ToolType.SELECT, icon: MousePointer },
                                    { type: ToolType.RECT, icon: Square },
                                    { type: ToolType.ARROW, icon: ArrowRight },
                                    { type: ToolType.PEN, icon: Pen },
                                    { type: ToolType.TEXT, icon: Type },
                                ].map(tool => (
                                    <button
                                    key={tool.type}
                                    onClick={() => setSelectedTool(tool.type)}
                                    className={`p-2 rounded-full transition-colors ${selectedTool === tool.type ? 'bg-brand-100 text-brand-600' : 'text-gray-500 hover:bg-gray-100'}`}
                                    >
                                    <tool.icon className="w-5 h-5" />
                                    </button>
                                ))}
                                </div>

                                {/* Canvas Area */}
                                <div className="flex-1 overflow-hidden relative">
                                <AnnotationCanvas 
                                    screen={activeScreen} 
                                    selectedTool={selectedTool}
                                    onUpdate={(anns) => updateActiveScreen({ annotations: anns })}
                                />
                                </div>
                                
                                {/* Screen Metadata Footer */}
                                <div className="h-16 bg-white border-t px-6 flex items-center space-x-4">
                                <span className="text-sm font-semibold text-gray-500">Description:</span>
                                <input 
                                    className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-1 text-sm focus:ring-brand-500 focus:border-brand-500"
                                    placeholder="Describe what is happening in this screen for the AI..."
                                    value={activeScreen.description}
                                    onChange={(e) => updateActiveScreen({ description: e.target.value })}
                                />
                                </div>
                            </>
                            ) : (
                            <div className="flex-1 flex items-center justify-center text-gray-400 flex-col">
                                <ImageIcon className="w-16 h-16 mb-4 opacity-20" />
                                <p>Select or upload a screen to start annotating</p>
                            </div>
                            )}
                        </div>
                    </>
                )}

                {/* Right: Analysis & Chat (Shared across both modes) */}
                <div className="w-96 bg-white border-l flex flex-col overflow-hidden">
                    <div className="flex items-center border-b">
                    <button className="flex-1 py-3 text-sm font-medium text-brand-600 border-b-2 border-brand-600">
                        Analysis Report
                    </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto bg-gray-50">
                    {activeFlow.analysisReport ? (
                        <div className="p-4">
                            <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-gray-900">AI Findings</h3>
                            <button onClick={handleExport} className="p-1 hover:bg-gray-200 rounded">
                                <Download className="w-4 h-4 text-gray-600" />
                            </button>
                            </div>
                            
                            {/* MINI DASHBOARD FOR SIDEBAR */}
                            <div className="mb-6 grid grid-cols-3 gap-2">
                                {(() => {
                                    const m = getReportMetrics(activeFlow.analysisReport);
                                    return (
                                        <>
                                            <div className="bg-white border rounded p-2 text-center">
                                                <div className="text-xs text-gray-500">UX</div>
                                                <div className={`font-bold ${m.ux >= 80 ? 'text-green-600' : 'text-yellow-600'}`}>{m.ux}</div>
                                            </div>
                                            <div className="bg-white border rounded p-2 text-center">
                                                <div className="text-xs text-gray-500">WCAG</div>
                                                <div className={`font-bold ${m.wcag >= 80 ? 'text-green-600' : 'text-yellow-600'}`}>{m.wcag}</div>
                                            </div>
                                            <div className="bg-white border rounded p-2 text-center">
                                                <div className="text-xs text-gray-500">Flow</div>
                                                <div className={`font-bold ${m.efficiency >= 80 ? 'text-green-600' : 'text-yellow-600'}`}>{m.efficiency}</div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>

                            <h2 className="text-sm font-bold mb-2 text-brand-700 border-b pb-1">Detailed Report</h2>
                            <div className="text-xs">
                                <MarkdownView content={activeFlow.analysisReport} />
                            </div>
                        </div>
                    ) : (
                        <div className="p-8 text-center text-gray-500">
                            <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <MessageSquare className="w-8 h-8" />
                            </div>
                            <h3 className="text-gray-900 font-medium mb-2">No Analysis Yet</h3>
                            <p className="text-sm">
                            Annotate your screens with redlines to highlight issues, then click "Run UX Audit" to get a professional heuristics report.
                            </p>
                        </div>
                    )}
                    </div>
                </div>
                </div>
            </div>
        ) : (
            // === DASHBOARD VIEWS ===
            <div className="flex-1 overflow-auto">
                {/* VIEW: PROJECTS */}
                {currentView === 'projects' && (
                <div className="p-8 max-w-7xl mx-auto">
                    <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
                        <p className="text-gray-500 mt-1">Manage your UX audits and reports.</p>
                    </div>
                    <button 
                        onClick={() => setShowCreateProject(true)}
                        className="bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 flex items-center space-x-2 shadow-sm transition-all"
                    >
                        <Plus className="w-5 h-5" />
                        <span>New Project</span>
                    </button>
                    </div>

                    {projects.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-300">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                            <Layout className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">No projects yet</h3>
                        <p className="text-gray-500 mb-6">Create your first project to start auditing.</p>
                        <button onClick={() => setShowCreateProject(true)} className="text-brand-600 font-medium hover:underline">Create Project</button>
                    </div>
                    ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {projects.map(project => (
                        <div key={project.id} className="bg-white rounded-xl border hover:shadow-lg transition-shadow p-5 flex flex-col group">
                            <div className="flex justify-between items-start mb-4">
                                <div className="w-10 h-10 rounded bg-blue-50 text-blue-600 flex items-center justify-center">
                                <Layout className="w-5 h-5" />
                                </div>
                                <span className="text-xs font-medium text-gray-400 px-2 py-1 bg-gray-50 rounded uppercase">{project.type}</span>
                            </div>
                            <h3 className="font-bold text-lg text-gray-900 mb-1">{project.title}</h3>
                            <p className="text-sm text-gray-500 mb-6">{project.flows.length} Flows • Created {new Date(project.createdAt).toLocaleDateString()}</p>
                            
                            <div className="mt-auto space-y-2">
                                {project.flows.map(flow => (
                                <div 
                                    key={flow.id}
                                    onClick={() => { setActiveProject(project); setActiveFlow(flow); }}
                                    className="flex items-center justify-between p-2 hover:bg-gray-50 rounded cursor-pointer border border-transparent hover:border-gray-200 transition-colors"
                                >
                                    <div className="flex items-center space-x-2 truncate">
                                    <div className={`w-1.5 h-1.5 rounded-full ${flow.analysisReport ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                    <span className="text-sm font-medium text-gray-700 truncate">{flow.name}</span>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-gray-400" />
                                </div>
                                ))}
                                
                                <button 
                                onClick={() => {
                                    setActiveProject(project);
                                    const newFlow: Flow = {
                                        id: generateId(),
                                        projectId: project.id,
                                        name: 'New Flow',
                                        description: '',
                                        screens: [],
                                        chatHistory: [],
                                        lastUpdated: Date.now()
                                    };
                                    const updatedProject = { ...project, flows: [...project.flows, newFlow] };
                                    setProjects(prev => prev.map(p => p.id === project.id ? updatedProject : p));
                                    setActiveFlow(newFlow);
                                }}
                                className="w-full py-2 border border-dashed border-gray-300 rounded text-sm text-gray-500 hover:border-brand-500 hover:text-brand-600 transition-colors"
                                >
                                + Create Flow
                                </button>
                            </div>
                        </div>
                        ))}
                    </div>
                    )}
                </div>
                )}

                {/* VIEW: AUDIT REPORTS (Hierarchical Table) */}
                {currentView === 'reports' && (
                    <div className="p-8 max-w-7xl mx-auto">
                        <div className="mb-8">
                            <h1 className="text-2xl font-bold text-gray-900">UX Audit Reports</h1>
                            <p className="text-gray-500 mt-1">Organized by Project. Expand a project to view its analysis reports.</p>
                        </div>
                        
                        {projects.length === 0 ? (
                            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-300">
                                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                                    <FileText className="w-8 h-8" />
                                </div>
                                <h3 className="text-lg font-medium text-gray-900">No projects yet</h3>
                                <p className="text-gray-500 mb-6">Create a project to start auditing.</p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                                <table className="w-full text-left">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="px-6 py-4 text-sm font-semibold text-gray-500 w-12"></th>
                                            <th className="px-6 py-4 text-sm font-semibold text-gray-500">Project Name</th>
                                            <th className="px-6 py-4 text-sm font-semibold text-gray-500">Reports Count</th>
                                            <th className="px-6 py-4 text-sm font-semibold text-gray-500">Last Updated</th>
                                            <th className="px-6 py-4 text-sm font-semibold text-gray-500 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {projects.map(project => {
                                             const reports = project.flows.filter(f => f.analysisReport);
                                             const reportCount = reports.length;
                                             // Find the latest update date across all reports in this project
                                             const lastUpdatedTimestamp = reports.length > 0 ? Math.max(...reports.map(f => f.lastUpdated)) : project.createdAt;
                                             const isExpanded = expandedProjectIds.has(project.id);
                                             const hasReports = reportCount > 0;

                                             return (
                                                 <React.Fragment key={project.id}>
                                                     {/* Project Row */}
                                                     <tr 
                                                         className={`hover:bg-gray-50 transition-colors cursor-pointer ${isExpanded ? 'bg-gray-50' : ''}`}
                                                         onClick={() => hasReports && toggleProjectExpand(project.id)}
                                                     >
                                                         <td className="px-6 py-4 text-gray-400">
                                                             {hasReports ? (
                                                                <ChevronRight className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                             ) : (
                                                                <div className="w-5 h-5" />
                                                             )}
                                                         </td>
                                                         <td className="px-6 py-4 font-bold text-gray-900">
                                                             <div className="flex items-center space-x-2">
                                                                <span>{project.title}</span>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // Logic to create flow and jump to editor
                                                                        const newFlow: Flow = {
                                                                            id: generateId(),
                                                                            projectId: project.id,
                                                                            name: 'New Flow',
                                                                            description: '',
                                                                            screens: [],
                                                                            chatHistory: [],
                                                                            lastUpdated: Date.now()
                                                                        };
                                                                        const updatedProject = { ...project, flows: [...project.flows, newFlow] };
                                                                        setProjects(prev => prev.map(p => p.id === project.id ? updatedProject : p));
                                                                        setActiveProject(updatedProject);
                                                                        setActiveFlow(newFlow);
                                                                    }}
                                                                    className="text-xs font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2 py-0.5 rounded flex items-center transition-colors"
                                                                >
                                                                    <Plus className="w-3 h-3 mr-1" /> Flow
                                                                </button>
                                                            </div>
                                                         </td>
                                                         <td className="px-6 py-4">
                                                             <span className={`px-2 py-1 rounded-full text-xs font-bold ${hasReports ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'}`}>
                                                                 {reportCount} Reports
                                                             </span>
                                                         </td>
                                                         <td className="px-6 py-4 text-sm text-gray-500">
                                                             {new Date(lastUpdatedTimestamp).toLocaleDateString()}
                                                         </td>
                                                          <td className="px-6 py-4 text-right">
                                                            {/* Action placeholder */}
                                                         </td>
                                                     </tr>

                                                     {/* Nested Reports Rows */}
                                                     {isExpanded && reports.map(flow => (
                                                         <tr key={flow.id} className="bg-gray-50/50 border-b border-gray-100 animate-in fade-in slide-in-from-top-1 duration-200">
                                                             <td className="px-6 py-3"></td> {/* Indent */}
                                                             <td className="px-6 py-3 pl-12" colSpan={2}>
                                                                 <div 
                                                                    className="flex items-center space-x-3 cursor-pointer group"
                                                                    onClick={(e) => { e.stopPropagation(); setActiveProject(project); setActiveFlow(flow); }}
                                                                 >
                                                                     <div className="w-6 h-6 rounded bg-green-100 text-green-600 flex items-center justify-center flex-none group-hover:bg-green-200 transition-colors">
                                                                         <FileText className="w-3 h-3" />
                                                                     </div>
                                                                     <div>
                                                                         <div className="font-medium text-gray-900 text-sm group-hover:text-brand-600 group-hover:underline transition-colors">{flow.name}</div>
                                                                         <div className="text-xs text-gray-500">{flow.screens.length} Screens</div>
                                                                     </div>
                                                                 </div>
                                                             </td>
                                                             <td className="px-6 py-3 text-xs text-gray-500">
                                                                 {new Date(flow.lastUpdated).toLocaleDateString()} {new Date(flow.lastUpdated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                             </td>
                                                             <td className="px-6 py-3 text-right">
                                                                <div className="flex justify-end space-x-2">
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); handleViewAnalysis(flow); }}
                                                                        className="text-brand-600 hover:text-brand-800 font-medium text-xs px-3 py-1 rounded border border-brand-200 bg-white hover:bg-brand-50"
                                                                    >
                                                                        View Analysis
                                                                    </button>
                                                                </div>
                                                             </td>
                                                         </tr>
                                                     ))}
                                                 </React.Fragment>
                                             );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* VIEW: MANAGE ACCOUNT */}
                {currentView === 'account' && (
                    <div className="p-8 max-w-4xl mx-auto">
                        <h1 className="text-2xl font-bold text-gray-900 mb-6">Manage Account</h1>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="bg-white rounded-xl shadow-sm border p-6">
                                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                                    <CreditCard className="w-5 h-5 mr-2 text-gray-500" />
                                    Subscription Plan
                                </h3>
                                <div className="mb-6">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-gray-600">Current Plan</span>
                                        <span className="px-3 py-1 bg-brand-100 text-brand-700 rounded-full text-sm font-bold uppercase">
                                            {user.plan}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-500">
                                        Billed monthly. Next billing date: Oct 24, 2024.
                                    </p>
                                </div>
                                <button className="w-full py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors">
                                    Manage Billing
                                </button>
                            </div>

                            <div className="bg-white rounded-xl shadow-sm border p-6">
                                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                                    <Shield className="w-5 h-5 mr-2 text-gray-500" />
                                    Token Usage
                                </h3>
                                <div className="mb-6">
                                    <div className="flex justify-between text-sm mb-2">
                                        <span className="font-medium text-gray-700">Monthly Balance</span>
                                        <span className="font-bold text-brand-600">{user.tokens} Tokens Left</span>
                                    </div>
                                    <div className="w-full bg-gray-200 h-2.5 rounded-full overflow-hidden">
                                        <div className="bg-brand-500 h-full" style={{ width: '45%' }}></div>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                        Each analysis consumes approx. 10 tokens per flow.
                                    </p>
                                </div>
                                <button className="w-full py-2 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors">
                                    Buy More Tokens
                                </button>
                            </div>
                        </div>

                        <div className="mt-8 bg-white rounded-xl shadow-sm border p-6">
                            <h3 className="text-lg font-bold text-gray-900 mb-4">Profile Settings</h3>
                            <div className="space-y-4 max-w-lg">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                                    <input type="text" value={user.name} disabled className="w-full bg-gray-50 border rounded-lg px-3 py-2 text-gray-600" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                                    <input type="email" value={user.email} disabled className="w-full bg-gray-50 border rounded-lg px-3 py-2 text-gray-600" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* VIEW: ADMIN */}
                {currentView === 'admin' && (
                <div className="p-8 max-w-6xl mx-auto">
                    <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Dashboard</h1>
                    <div className="grid grid-cols-4 gap-4 mb-8">
                        <div className="bg-white p-4 rounded-lg shadow-sm border">
                        <h3 className="text-gray-500 text-xs uppercase font-bold tracking-wider">Total Revenue</h3>
                        <p className="text-2xl font-bold text-gray-900 mt-1">$12,450</p>
                        </div>
                        <div className="bg-white p-4 rounded-lg shadow-sm border">
                        <h3 className="text-gray-500 text-xs uppercase font-bold tracking-wider">Active Users</h3>
                        <p className="text-2xl font-bold text-gray-900 mt-1">1,240</p>
                        </div>
                        <div className="bg-white p-4 rounded-lg shadow-sm border">
                        <h3 className="text-gray-500 text-xs uppercase font-bold tracking-wider">Reports Generated</h3>
                        <p className="text-2xl font-bold text-gray-900 mt-1">8,542</p>
                        </div>
                        <div className="bg-white p-4 rounded-lg shadow-sm border">
                        <h3 className="text-gray-500 text-xs uppercase font-bold tracking-wider">System Status</h3>
                        <div className="flex items-center text-green-600 mt-1 font-medium">
                            <CheckCircle className="w-5 h-5 mr-1" /> Operational
                        </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 font-medium text-gray-500">User</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Plan</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Tokens Used</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Last Login</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {[1, 2, 3, 4, 5].map(i => (
                                <tr key={i} className="hover:bg-gray-50">
                                <td className="px-6 py-3 font-medium text-gray-900">User {i}</td>
                                <td className="px-6 py-3">
                                    <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">PRO</span>
                                </td>
                                <td className="px-6 py-3 text-gray-500">4,200</td>
                                <td className="px-6 py-3 text-gray-500">2 hours ago</td>
                                <td className="px-6 py-3 text-green-600">Active</td>
                                </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                </div>
                )}
            </div>
        )}
      </main>

      {/* CREATE PROJECT MODAL */}
      {showCreateProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
           <div className="bg-white rounded-xl shadow-2xl w-96 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Create New Project</h3>
              <div className="space-y-4">
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Title</label>
                    <input 
                      autoFocus
                      className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-500 outline-none" 
                      placeholder="e.g. Mobile App Onboarding"
                      value={newProjectTitle}
                      onChange={(e) => setNewProjectTitle(e.target.value)}
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Type</label>
                    <select 
                        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-500 outline-none bg-white"
                        value={newProjectType}
                        onChange={(e) => setNewProjectType(e.target.value as any)}
                    >
                        <option value="Onboarding">Onboarding</option>
                        <option value="Task Manager">Task Manager</option>
                        <option value="E-commerce">E-commerce</option>
                        <option value="Other">Other</option>
                    </select>
                 </div>
                 <div className="flex justify-end space-x-2 pt-2">
                    <button onClick={() => setShowCreateProject(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button onClick={handleCreateProject} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">Create Project</button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* RISK LIGHTBOX */}
      {enlargedScreen && (
          <RiskLightbox 
            screen={enlargedScreen} 
            risks={(getRisksFromReport(flowToDisplay?.analysisReport || "")).filter(r => 
                // Show risk if screenIndex matches logic. 
                // Assuming parser returns 0-based index corresponding to activeFlow.screens array
                r.screenIndex !== undefined && activeFlow?.screens[r.screenIndex]?.id === enlargedScreen.id
            )}
            onClose={() => setEnlargedScreen(null)} 
          />
      )}

      {/* REPORT RESULT MODAL */}
      {showReportModal && flowToDisplay?.analysisReport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-5 border-b flex justify-between items-center bg-gray-50 flex-none">
                     <div className="flex items-center space-x-3">
                        <div className="bg-green-100 p-2 rounded-lg text-green-700">
                            <Shield className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900">Analysis Results</h2>
                            <p className="text-sm text-gray-500">{flowToDisplay.name}</p>
                        </div>
                     </div>
                     <button onClick={() => setShowReportModal(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                        <X className="w-6 h-6 text-gray-500" />
                     </button>
                </div>
                <div id="report-print-content" className="flex-1 overflow-y-auto p-8 bg-white">
                    {/* NEW: THUMBNAILS STRIP */}
                    <div className="mb-6 overflow-x-auto pb-2">
                        <div className="flex space-x-3 min-w-min">
                            {flowToDisplay.screens.map((screen, idx) => (
                            <div 
                                key={screen.id} 
                                className="flex-none w-48 relative group cursor-zoom-in"
                                onClick={() => setEnlargedScreen(screen)}
                            >
                                <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden border border-gray-200 shadow-sm relative group-hover:ring-2 ring-brand-500 transition-all">
                                <img 
                                    src={screen.originalImageUrl} 
                                    alt={screen.name} 
                                    className="w-full h-full object-cover" 
                                />
                                {screen.annotations && screen.annotations.length > 0 && (
                                    <div className="absolute top-1 right-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm">
                                        {screen.annotations.length}
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center transition-colors">
                                    <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 drop-shadow-md" />
                                </div>
                                </div>
                                <p className="mt-1 text-xs text-gray-500 truncate font-medium flex items-center">
                                    <span className="bg-gray-100 text-gray-600 px-1.5 rounded mr-1.5">{idx + 1}</span> 
                                    {screen.name}
                                </p>
                            </div>
                            ))}
                        </div>
                    </div>

                    <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-xl text-blue-800 flex items-start">
                         <MessageSquare className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0" />
                         <div>
                            <h4 className="font-bold mb-1">AI Findings Ready</h4>
                            <p className="text-sm opacity-90">
                                Below is the combined analysis covering Nielsen's Heuristics, WCAG 2.1 AA Accessibility compliance, and flow efficiency scores.
                            </p>
                         </div>
                    </div>
                    
                    {/* VISUAL DASHBOARD */}
                    <VisualDashboard report={flowToDisplay.analysisReport} />

                    {/* TOP 3 RISKS CARDS */}
                    {(() => {
                        const risks = getRisksFromReport(flowToDisplay.analysisReport);
                        if (risks && risks.length > 0) {
                            return (
                                <div className="mb-8">
                                    <div className="flex items-center mb-4">
                                        <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
                                        <h2 className="text-lg font-bold text-gray-900">Strategic UX Risks (Top 3)</h2>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {risks.map((risk, idx) => (
                                            <div key={idx} className="border border-red-100 bg-red-50/50 rounded-xl p-5 flex flex-col">
                                                <div className="text-xs font-bold text-red-600 uppercase mb-2 tracking-wide">Risk #{idx + 1}</div>
                                                <h3 className="font-bold text-gray-900 mb-3 text-lg leading-tight">{risk.title}</h3>
                                                
                                                <div className="mb-3">
                                                    <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Why it matters</div>
                                                    <p className="text-sm text-gray-700 leading-relaxed">{risk.whyItMatters}</p>
                                                </div>
                                                
                                                <div className="mt-auto pt-3 border-t border-red-100">
                                                    <div className="text-xs font-semibold text-red-700 uppercase mb-1">Potential Impact</div>
                                                    <p className="text-sm text-red-800 font-medium">{risk.potentialImpact}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        }
                        return null;
                    })()}

                    <h2 className="text-2xl font-bold mb-4 text-brand-900 border-b pb-2">Detailed Audit Report</h2>
                    <MarkdownView content={flowToDisplay.analysisReport} />
                </div>
                <div className="p-5 border-t bg-gray-50 flex justify-end space-x-3 flex-none">
                    <button onClick={handleExport} className="px-5 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center shadow-sm">
                        <Download className="w-4 h-4 mr-2" /> Export Report
                    </button>
                    <button onClick={handleSaveAndClose} className="px-5 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors shadow-sm flex items-center">
                        <Save className="w-4 h-4 mr-2" />
                        Save & Close
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

// Render
const root = createRoot(document.getElementById('root')!);
root.render(<App />);