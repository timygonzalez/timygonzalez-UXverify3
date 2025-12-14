import { GoogleGenAI } from "@google/genai";
import { Flow, Screen, ChatMessage, AnalysisOptions } from "../types";

// Helper to composite annotations onto the image for the AI to "see" them
async function compositeImage(screen: Screen): Promise<{ data: string, mimeType: string }> {
  // 1. Safe extraction of base64 and mime type if no annotations
  // This regex handles standard data URIs
  const match = screen.originalImageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  const originalMimeType = match ? match[1] : 'image/png';
  const originalData = match ? match[2] : screen.originalImageUrl;

  // If no annotations, return original data with correct mime type to avoid re-encoding overhead
  if (!screen.annotations || screen.annotations.length === 0) {
    return { data: originalData, mimeType: originalMimeType };
  }

  // 2. If annotations exist, we MUST composite.
  return new Promise((resolve) => {
    // Safety timeout: if image loading takes too long, resolve with original
    const timeout = setTimeout(() => {
        console.warn("Image composition timed out, using original");
        resolve({ data: originalData, mimeType: originalMimeType });
    }, 5000);

    const img = new Image();
    
    // Only set crossOrigin if it's NOT a data URI to avoid tainting canvas security
    if (!screen.originalImageUrl.startsWith('data:')) {
        img.crossOrigin = "anonymous";
    }
    
    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ data: originalData, mimeType: originalMimeType });
          return;
        }

        // Draw original
        ctx.drawImage(img, 0, 0);

        // Draw annotations
        screen.annotations.forEach(ann => {
          ctx.strokeStyle = ann.color;
          ctx.fillStyle = ann.color;
          ctx.lineWidth = ann.thickness || 3;
          ctx.beginPath();

          if (ann.type === 'rect') {
            ctx.strokeRect(ann.x, ann.y, ann.width || 0, ann.height || 0);
          } else if (ann.type === 'freehand' && ann.points) {
            ctx.moveTo(ann.points[0], ann.points[1]);
            for (let i = 2; i < ann.points.length; i += 2) {
              ctx.lineTo(ann.points[i], ann.points[i + 1]);
            }
            ctx.stroke();
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
          } else if (ann.type === 'text' && ann.text) {
            ctx.font = 'bold 24px Arial';
            ctx.fillStyle = 'red';
            ctx.fillText(ann.text, ann.x, ann.y + 24);
          }
        });

        // Always export composited image as PNG because Canvas defaults to PNG/JPEG
        // PNG supports transparency which is safer for screenshots
        const dataUrl = canvas.toDataURL('image/png');
        resolve({ 
            data: dataUrl.split('base64,')[1], 
            mimeType: 'image/png' 
        });
      } catch (e) {
        console.error("Canvas composition error", e);
        resolve({ data: originalData, mimeType: originalMimeType });
      }
    };

    img.onerror = (e) => {
      clearTimeout(timeout);
      console.error("Image load error", e);
      resolve({ data: originalData, mimeType: originalMimeType });
    };

    img.src = screen.originalImageUrl;
  });
}

export async function runGeminiUXAudit({ flowName, images, descriptions, options }: { flowName: string, images: string[], descriptions: string[], options?: AnalysisOptions }) {
  const apiKey = typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;
  if (!apiKey) throw new Error("API Key is missing. Please ensure process.env.API_KEY is configured.");
  
  const ai = new GoogleGenAI({ apiKey });

  const showHeuristics = options?.heuristics ?? true;
  const showWcag = options?.wcag ?? true;
  const showEfficiency = options?.efficiency ?? true;
  const showRisks = options?.risks ?? true;
  const showConversion = options?.conversion ?? true;
  const showIA = options?.ia ?? true;
  const showHierarchy = options?.hierarchy ?? true;

  let modulesInstruction = "";
  
  if (showHeuristics) {
    modulesInstruction += `\n# Heuristics\nAnalyze against Nielsen’s 10 heuristics, cognitive load, clarity, hierarchy, and alignment.\n`;
  }
  if (showWcag) {
    modulesInstruction += `\n# WCAG\nAnalyze Accessibility (WCAG 2.1 AA): Check contrast, touch targets, labels, error prevention, and screen reader semantic structure.\n`;
  }
  if (showEfficiency) {
    modulesInstruction += `\n# Flow\nAnalyze Flow Efficiency: Identify friction points, redundancies, and task difficulty.\n`;
  }
  if (showConversion) {
    modulesInstruction += `\n# Conversion\nAnalyze for Conversion & Behavioral Friction based on visual hierarchy and flow continuity. Identify visual factors causing hesitation, confusion, or drop-off. Focus on CTA visibility, value proposition clarity, and visual reassurance. For each finding, list: Funnel step, Observed friction, Behavioral impact, and Business risk level (Low/Medium/High).\n`;
  }
  if (showIA) {
    modulesInstruction += `\n# Information Architecture\nAnalyze for Information Architecture & Navigation Flow based on visual-only evidence. Evaluate screen-to-screen continuity, navigation clarity, labeling, user orientation, and flow progression. Identify structural confusion, inconsistent labeling, or missing orientation cues. Do NOT assume hidden navigation. OUTPUT FORMAT: Screens or flow segment affected, IA or flow issue, Visual evidence, Severity (Low / Medium / High).\n`;
  }
  if (showHierarchy) {
      modulesInstruction += `\n# Visual Hierarchy\nAnalyze for Visual Hierarchy & Clarity based on visual perception. Evaluate typography, spacing, alignment, visual grouping, emphasis, and scan paths. Identify competing visual priorities, poor hierarchy, overloaded screens, or distracting elements. DO NOT express aesthetic preferences. OUTPUT FORMAT: Screen(s) affected, Visual hierarchy issue, User comprehension impact, Severity (Low / Medium / High).\n`;
  }

  let scoresList = [];
  if (showHeuristics) scoresList.push("UX Score (0-100)");
  if (showWcag) scoresList.push("Accessibility Score (0-100)");
  if (showEfficiency) scoresList.push("Flow Efficiency Score (0-100)");
  if (showConversion) scoresList.push("Conversion Score (0-100)");
  if (showIA) scoresList.push("Information Architecture Score (0-100)");
  if (showHierarchy) scoresList.push("Visual Hierarchy Score (0-100)");

  let risksInstruction = "";
  if (showRisks) {
      risksInstruction = `
\n# Risks
Analyze the interface and identify the top 3 UX risks that could negatively impact user success.
For each risk, provide: Title, Why it matters, Potential Impact.
Identify the specific screen index (0-based) and a bounding box [ymin, xmin, ymax, xmax] (0-1000 scale) for the element.

IMPORTANT: You MUST output the risks section inside a JSON code block matching this structure:
\`\`\`json
{
  "uxRisks": [
    {
      "title": "",
      "whyItMatters": "",
      "potentialImpact": "",
      "screenIndex": 0,
      "boundingBox": [0, 0, 1000, 1000]
    }
  ]
}
\`\`\`
`;
  }

  // New instruction to infer screen names
  const screenNamesInstruction = `
IMPORTANT: You MUST also identify a concise, descriptive name for each screen based on its content (e.g. "Login", "Dashboard", "Checkout").
Output these names in a separate JSON code block matching this structure:
\`\`\`json
{
  "screenNames": [
    { "index": 0, "name": "Concise Name" }
  ]
}
\`\`\`
`;

  const prompt = `You are an expert UX designer and WCAG 2.1 AA accessibility auditor. Analyze this UX flow and return a structured combined audit report.

PART 1 — FLOW CONTEXT
Flow Name: ${flowName}

PART 2 — SCREEN DESCRIPTIONS
${descriptions.map((d, i) => "Screen " + (i+1) + ": " + d).join("\n")}

PART 3 — REQUIRED AUDIT SECTIONS
You must generate a report containing ONLY the following sections in this order. Use H1 Headers (# ) for each section title exactly as requested.

${modulesInstruction}
${risksInstruction}
${screenNamesInstruction}

After the main sections, include:
- # Issue Severity: Categorize issues as High, Medium, or Low.
- # Recommended Fixes: Actionable improvements.
- # Scores: Provide the following scores: ${scoresList.join(", ")}.

Analyze the screens below and generate the report now.
`;

  // Construct contents with image parts
  const parts: any[] = [{ text: prompt }];
  
  images.forEach(img => {
    // Extract base64 data if present, otherwise assume raw base64
    const base64Data = img.includes('base64,') ? img.split('base64,')[1] : img;
    parts.push({ 
        inlineData: { 
            data: base64Data, 
            mimeType: "image/png" 
        } 
    });
  });

  const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash', 
      contents: { parts }
  });

  return response.text || "";
}

export const geminiService = {
  analyzeFlow: async (flow: Flow, options?: AnalysisOptions): Promise<string> => {
    const images = [];
    const descriptions = [];
    for (const s of flow.screens) {
        const { data, mimeType } = await compositeImage(s);
        images.push(`data:${mimeType};base64,${data}`);
        descriptions.push(s.description || "");
    }
    return runGeminiUXAudit({ flowName: flow.name, images, descriptions, options });
  },

  chatWithFlow: async (flow: Flow, message: string, history: ChatMessage[]) => {
     try {
       const apiKey = typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;
       if (!apiKey) {
          throw new Error("API Key is missing.");
       }
       const ai = new GoogleGenAI({ apiKey: apiKey });
       
       const contextPrompt = `
         Context: You are discussing a UX flow titled "${flow.name}".
         Current Report Summary: ${flow.analysisReport ? flow.analysisReport.substring(0, 2000) + "..." : "No report yet."}
         
         User Question: ${message}
       `;

       const response = await ai.models.generateContent({
         model: 'gemini-2.5-flash',
         contents: contextPrompt
       });

       return response.text;
     } catch (error) {
       console.error("Chat Error:", error);
       throw error;
     }
  }
};