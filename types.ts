export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  tokens: number;
  plan: 'free' | 'pro' | 'business';
}

export interface Annotation {
  id: string;
  type: 'rect' | 'arrow' | 'freehand' | 'text';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[]; // For freehand/arrow: [x1, y1, x2, y2, ...]
  color: string;
  text?: string;
  thickness?: number;
}

export interface Screen {
  id: string;
  flowId: string;
  originalImageUrl: string; // Base64 data:image/...
  name: string;
  description: string;
  order: number;
  annotations: Annotation[]; 
}

export interface AnalysisOptions {
  heuristics: boolean;
  wcag: boolean;
  efficiency: boolean;
  risks: boolean;
  conversion: boolean;
  ia: boolean;
  hierarchy: boolean;
}

// React Flow Types Shim
export interface FlowGraphData {
    nodes: any[];
    edges: any[];
}

export interface Flow {
  id: string;
  projectId: string;
  name: string;
  description: string;
  screens: Screen[];
  analysisReport?: string; // Markdown report
  chatHistory: ChatMessage[];
  lastUpdated: number;
  isAnalyzing?: boolean;
  graphData?: FlowGraphData; // Persisted React Flow data
}

export interface Project {
  id: string;
  userId: string;
  title: string;
  type: 'Onboarding' | 'Task Manager' | 'E-commerce' | 'Other';
  flows: Flow[];
  createdAt: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export enum ToolType {
  SELECT = 'SELECT',
  PEN = 'PEN',
  RECT = 'RECT',
  ARROW = 'ARROW',
  TEXT = 'TEXT'
}

export const PLANS = {
  free: { name: 'Free Tier', tokens: 50, price: 0 },
  pro: { name: 'Professional', tokens: 500, price: 29 },
  business: { name: 'Business', tokens: 2000, price: 99 },
};