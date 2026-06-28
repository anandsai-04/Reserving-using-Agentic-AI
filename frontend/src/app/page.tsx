'use client';

import React, { useState, useEffect } from 'react';
import {
  ChatMessage,
  SummaryData,
  TriangleData,
  RankedModel,
  ExecuteResult,
  ExecutionConfig,
} from './types';
import StepProgress from './components/StepProgress';
import SidebarChat from './components/SidebarChat';
import SettingsModal from './components/SettingsModal';
import UploadZone from './components/UploadZone';
import SummaryView from './components/SummaryView';
import TriangleView from './components/TriangleView';
import ModelSelector from './components/ModelSelector';
import ParamsView from './components/ParamsView';
import ResultsView from './components/ResultsView';
import ConfigureAssumptions from './components/ConfigureAssumptions';
import { CURRENCIES, CurrencyCode } from './utils';

const STEPS = ['Ingestion Pipeline', 'Data Summary', 'Loss Triangle', 'Configure Assumptions', 'IBNR Results'];

export default function Page() {
  // UI Steps & State
  const [step, setStep] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [triangle, setTriangle] = useState<TriangleData | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [customLDFs, setCustomLDFs] = useState<number[]>([]);
  const [ldfBase, setLdfBase] = useState('volumeWeighted');
  const [tailFactor, setTailFactor] = useState(1.0);
  const [customIncurredLDFs, setCustomIncurredLDFs] = useState<number[]>([]);
  const [incurredLdfBase, setIncurredLdfBase] = useState('volumeWeighted');
  const [incurredTailFactor, setIncurredTailFactor] = useState(1.0);
  const [dataSource, setDataSource] = useState<'paid' | 'incurred'>('paid');
  const [ranked, setRanked] = useState<RankedModel[]>([]);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [configs, setConfigs] = useState<ExecutionConfig>({
    CL: { enabled: true, runPaid: true, runIncurred: true },
    BF: { enabled: true, runPaid: true, runIncurred: false, aprioriLossRatio: null },
    BK: { enabled: true, runPaid: true, runIncurred: false, aprioriLossRatio: null, iterations: 2 },
    CC: { enabled: true, runPaid: true, runIncurred: false, decay: 0.9 },
    ELR: { enabled: true, runPaid: true, runIncurred: false, matureYears: [] },
    CO: { enabled: true, runPaid: true, runIncurred: true }
  });
  const [suggestedElrPaid, setSuggestedElrPaid] = useState<number | null>(65.0);
  const [suggestedElrIncurred, setSuggestedElrIncurred] = useState<number | null>(65.0);
  const [suggestedMatureYears, setSuggestedMatureYears] = useState<number[]>([]);
  const [matureCdfThreshold, setMatureCdfThreshold] = useState<number>(1.05);

  // Settings
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [apiKey, setApiKey] = useState('');

  // Sidebar Chat / Logs
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-msg',
      role: 'system',
      text: 'Multi-Agent architecture active. Please start the Python server, then configure your parameters and upload a CSV file.',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model'; text: string }[]>([]);

  // Load localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBaseUrl(localStorage.getItem('ai_base_url') || '');
      setModelName(localStorage.getItem('ai_model_name') || '');
      setApiKey(localStorage.getItem('ai_api_key') || '');
    }
  }, []);

  // Synchronize suggestions and prefill configs when triangle changes
  useEffect(() => {
    if (triangle) {
      const elrPaid = triangle.suggested_elr_paid !== undefined ? triangle.suggested_elr_paid : 65.0;
      const elrInc = triangle.suggested_elr_incurred !== undefined ? triangle.suggested_elr_incurred : 65.0;
      
      setSuggestedElrPaid(elrPaid);
      setSuggestedElrIncurred(elrInc);
      setSuggestedMatureYears(triangle.suggested_mature_years || []);

      setConfigs((prev) => {
        const nextConfigs = { ...prev };
        
        const codes = Object.keys(nextConfigs);
        for (const code of codes) {
          const methodConfig = { ...(nextConfigs[code] || { enabled: true, runPaid: true, runIncurred: false }) };
          
          if (triangle.method_availability && triangle.method_availability[code]) {
            methodConfig.enabled = triangle.method_availability[code].available;
          } else if (['BF', 'BK', 'CC', 'ELR'].includes(code)) {
            methodConfig.enabled = triangle.hasPremium;
          }
 
          if (code === 'BF' || code === 'BK') {
            const appropriateElr = methodConfig.runPaid ? elrPaid : elrInc;
            methodConfig.aprioriLossRatio = methodConfig.aprioriLossRatio !== null && methodConfig.aprioriLossRatio !== undefined
              ? methodConfig.aprioriLossRatio 
              : appropriateElr;
          }
 
          if (code === 'ELR') {
            methodConfig.matureYears = methodConfig.matureYears && methodConfig.matureYears.length > 0
              ? methodConfig.matureYears
              : (triangle.suggested_mature_years || []);
          }
 
          nextConfigs[code] = methodConfig;
        }
 
        return nextConfigs;
      });
    }
  }, [triangle]);

  // Recalculate suggestions when mature CDF threshold changes
  useEffect(() => {
    if (sessionId && matureCdfThreshold) {
      fetch(getApiUrl('recalculate_suggestions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          mature_cdf_threshold: matureCdfThreshold,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setSuggestedElrPaid(data.suggested_elr_paid);
            setSuggestedElrIncurred(data.suggested_elr_incurred);
            setSuggestedMatureYears(data.suggested_mature_years);
            setConfigs((prev) => {
              const elrCfg = prev.ELR;
              if (elrCfg) {
                return {
                  ...prev,
                  ELR: {
                    ...elrCfg,
                    matureYears: data.suggested_mature_years,
                  },
                };
              }
              return prev;
            });
          }
        })
        .catch((err) => console.error('Failed to recalculate suggestions:', err));
    }
  }, [matureCdfThreshold, sessionId]);

  const saveSettings = (newBase: string, newModel: string, newKey: string) => {
    setBaseUrl(newBase);
    setModelName(newModel);
    setApiKey(newKey);
    localStorage.setItem('ai_base_url', newBase);
    localStorage.setItem('ai_model_name', newModel);
    localStorage.setItem('ai_api_key', newKey);
    setIsSettingsOpen(false);
    addLogMessage('system', 'AI Settings saved and verified.');
  };

  // Log helpers
  const addLogMessage = (
    role: ChatMessage['role'],
    text: string,
    state: ChatMessage['state'] = ''
  ): string => {
    const id = `msg-${Math.random().toString(36).substring(7)}`;
    setMessages((prev) => [...prev, { id, role, text, state }]);
    return id;
  };

  const updateLogMessage = (id: string, text: string) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, text, state: '' } : msg))
    );
  };

  // Dynamic API Base URL detection
  const getApiUrl = (endpoint: string) => {
    if (typeof window !== 'undefined') {
      const isLocal =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
      const base = isLocal
        ? 'http://localhost:8000/api'
        : 'https://reserving-using-agentic-ai.onrender.com/api';
      return `${base}/${endpoint}`;
    }
    return `/api/${endpoint}`;
  };

  // Process SSE Stream
  const processPipelineStream = async (res: Response, uploadMsgId: string) => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'agent') {
            addLogMessage('action', `<strong>[${msg.agent}]</strong> ${msg.text}`);
            if (msg.agent === 'System Error' || (msg.text && msg.text.includes('Agent Error'))) {
              updateLogMessage(uploadMsgId, 'Pipeline aborted due to backend error. Please check Render settings.');
              return;
            }
          } else if (msg.type === 'input_required') {
            setSessionId(msg.session_id);
            addLogMessage('action', `Requires Input: Data Conditions`);
            return; // Stream pauses here waiting for resume
          } else if (msg.type === 'complete') {
            setSessionId(msg.session_id);
            setSummary(msg.summary);
            setTriangle(msg.triangle);
            setRecommendation(msg.recommendation);
            setCustomLDFs([]); // Clear previous selections
            setCustomIncurredLDFs([]); // Clear custom incurred selections
            setStep(1);

            updateLogMessage(
              uploadMsgId,
              'Pipeline execution completed. See summary in right panel.'
            );
          } else if (msg.type === 'error') {
            updateLogMessage(uploadMsgId, `Failed: ${msg.message}`);
          }
        } catch (err) {
          console.error('Stream parse error:', err);
        }
      }
    }
  };

  // Step 0 -> Step 1 (Upload and run pipeline)
  const handleRunPipeline = async (
    file: File,
    rateChanges: { effective_date: string; rate_change: number }[],
    context: { tail: string; volatility: string; environment: string; distortions: string }
  ) => {
    const uploadMsgId = addLogMessage(
      'agent',
      `🚀 Launching Sequential Multi-Agent Pipeline for <strong>${file.name}</strong>...`,
      'analyzing'
    );

    const text = await file.text();
    setCsvText(text);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('n_years', '5'); // Hardcoded default

    if (rateChanges.length > 0) {
      formData.append('rate_changes_json', JSON.stringify(rateChanges));
      // Set valuation year as max rate change year
      const years = rateChanges.map((r) => new Date(r.effective_date).getFullYear());
      const maxYear = Math.max(...years);
      formData.append('valuation_year', maxYear.toString());
    }

    formData.append('business_context', JSON.stringify(context));

    if (apiKey) {
      formData.append('api_key', apiKey);
      formData.append('base_url', baseUrl);
      formData.append('model_name', modelName);
    }

    try {
      const res = await fetch(getApiUrl('upload'), {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Network response was not ok');
      await processPipelineStream(res, uploadMsgId);
    } catch (e: any) {
      addLogMessage('error', `Pipeline Error: ${e.message}`);
      updateLogMessage(uploadMsgId, `Failed to process: ${e.message}`);
    }
  };

  // Submit checkboxes to resume stream
  const handleSubmitConditions = async (conditions: {
    credible: boolean;
    freq: boolean;
    distort: boolean;
  }) => {
    const resumeMsgId = addLogMessage('agent', '⚙️ Resuming sequential pipeline...', 'analyzing');
    try {
      const res = await fetch(getApiUrl('resume_pipeline'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          csv_text: csvText,
          reserving_roles: summary?.inspection?.reserving_roles || {},
          conditions: conditions,
          api_key: apiKey,
          base_url: baseUrl,
          model_name: modelName,
        }),
      });

      if (!res.ok) throw new Error('Network response was not ok');
      updateLogMessage(resumeMsgId, 'Conditions submitted. Pipeline resumed.');
      await processPipelineStream(res, resumeMsgId);
    } catch (e: any) {
      addLogMessage('error', `Pipeline Resume Error: ${e.message}`);
      updateLogMessage(resumeMsgId, `Failed to resume: ${e.message}`);
    }
  };

  // View switch helpers
  const handleTriangleProceed = () => {
    if (!triangle) return;
    setStep(3);

    // Initial ranked methods list mapping
    let rankedMethods: RankedModel[] = [
      {
        code: 'BF',
        label: 'Bornhuetter-Ferguson',
        desc: 'Uses a priori expected loss ratios.',
        score: 10,
        recommended: true,
        params: [{ key: 'aprioriLossRatio', label: 'A Priori Loss Ratio (%)', default: 65 }],
      },
      {
        code: 'CL',
        label: 'Chain Ladder (Basic)',
        desc: 'Standard development method.',
        score: 9,
        recommended: true,
        params: [],
      },
      {
        code: 'ELR',
        label: 'Expected Loss Ratio',
        desc: 'Projects mature historical loss ratios onto immature years.',
        score: 8.5,
        recommended: false,
        params: [
          { key: 'nMatureYears', label: 'Mature Years (n)', default: 5 },
          { key: 'lrCap', label: 'Loss Ratio Cap', default: 5.0 },
        ],
      },
      {
        code: 'CC',
        label: 'Cape Cod',
        desc: 'Uses an overall loss ratio for stability.',
        score: 8,
        recommended: false,
        params: [{ key: 'decay', label: 'Decay Factor', default: 1.0 }],
      },
      {
        code: 'BK',
        label: 'Benktander',
        desc: 'Iterative blend of BF and CL.',
        score: 7,
        recommended: false,
        params: [
          { key: 'aprioriLossRatio', label: 'A Priori Loss Ratio (%)', default: 65 },
          { key: 'iterations', label: 'Iterations (c)', default: 1 },
        ],
      },
      {
        code: 'MCL',
        label: 'Mack Chain Ladder',
        desc: 'Calculates standard errors and variance.',
        score: 6,
        recommended: false,
        params: [],
      },
      {
        code: 'CLK',
        label: 'Clark Stochastic',
        desc: 'Stochastic curve fitting approximation.',
        score: 5,
        recommended: false,
        params: [{ key: 'curveType', label: 'Growth Curve', default: 'loglogistic' }],
      },
      {
        code: 'CO',
        label: 'Case Outstanding',
        desc: 'Uses only reported case reserves.',
        score: 4,
        recommended: false,
        params: [],
      },
    ];

    if (!triangle.hasPremium) {
      rankedMethods = rankedMethods.filter((m) => !['BF', 'CC', 'BK', 'ELR'].includes(m.code));
    }
    setRanked(rankedMethods);
  };

  // Run all models concurrently
  const handleExecuteAllModels = async () => {
    setStep(4);
    setExecuteResult(null);
    const execMsgId = addLogMessage(
      'agent',
      `⚙️ <strong>Execution Agent</strong> running all actuarial models concurrently on backend…`,
      'analyzing'
    );

    const ldfsToUse = customLDFs.length > 0 ? customLDFs : triangle?.ldfs.slice(0, -1).map((s: any) => s[ldfBase] ?? 1.0) || [];
    const incurredLdfsToUse = customIncurredLDFs.length > 0 ? customIncurredLDFs : triangle?.incurred_ldfs?.slice(0, -1).map((s: any) => s[incurredLdfBase] ?? 1.0) || [];
    
    const payload = {
      session_id: sessionId,
      configs: configs,
      paid_ldfs: [...ldfsToUse, tailFactor],
      incurred_ldfs: [...incurredLdfsToUse, incurredTailFactor],
      paid_tail_factor: tailFactor,
      incurred_tail_factor: incurredTailFactor,
      mature_cdf_threshold: matureCdfThreshold,
      csv_text: csvText,
      reserving_roles: summary?.inspection?.reserving_roles || {},
      api_key: apiKey,
      base_url: baseUrl,
      model_name: modelName,
      csv_text: csvText,
    };

    try {
      const res = await fetch(getApiUrl('execute_all'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setExecuteResult(data);
      updateLogMessage(execMsgId, 'Multi-model execution complete. Comparative dashboard loaded.');
    } catch (e: any) {
      addLogMessage('error', `Execution failed: ${e.message}`);
      updateLogMessage(execMsgId, `Execution failed: ${e.message}`);
    }
  };

  // Sidebar Chatbot handler
  const handleSendMessage = async () => {
    if (!chatInput.trim() || !sessionId) return;
    const userText = chatInput.trim();
    setChatInput('');

    addLogMessage('user', userText);
    const typingId = addLogMessage('agent', '…', 'analyzing');

    try {
      const res = await fetch(getApiUrl('chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          csv_text: csvText,
          reserving_roles: summary?.inspection?.reserving_roles || {},
          message: userText,
          history: messages.filter((m) => m.role !== 'system' && m.role !== 'action'),
          api_key: apiKey,
          base_url: baseUrl,
          model_name: modelName,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setChatHistory((prev) => [
        ...prev,
        { role: 'user', text: userText },
        { role: 'model', text: data.reply },
      ]);
      updateLogMessage(typingId, data.reply);
    } catch (e: any) {
      updateLogMessage(typingId, `Error: ${e.message}`);
    }
  };

  const handleUpdateMappings = async (
    newRoles: Record<string, string | null>,
    selectedEntities?: string[] | null
  ) => {
    const updateMsgId = addLogMessage(
      'agent',
      '⚙️ <strong>System Agent</strong> rebuilding loss triangle with custom configurations...',
      'analyzing'
    );
    try {
      const res = await fetch(getApiUrl('update_mappings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          csv_text: csvText,
          reserving_roles: newRoles,
          selected_entities: selectedEntities || null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setSummary(data.summary);
      setTriangle(data.triangle);
      setCustomLDFs([]); // Clear custom LDF selections
      setCustomIncurredLDFs([]); // Clear custom incurred LDF selections
      updateLogMessage(updateMsgId, 'Triangle configurations successfully updated. Triangle rebuilt.');
    } catch (e: any) {
      addLogMessage('error', `Configuration Update Failed: ${e.message}`);
      updateLogMessage(updateMsgId, `Failed to update configurations: ${e.message}`);
    }
  };

  const handleUpdateEntities = async (selectedEntities: string[] | null) => {
    const updateMsgId = addLogMessage(
      'agent',
      '⚙️ <strong>System Agent</strong> rebuilding loss triangle with custom entity scope...',
      'analyzing'
    );
    try {
      const res = await fetch(getApiUrl('update_mappings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          csv_text: csvText,
          reserving_roles: summary?.inspection?.reserving_roles || {},
          selected_entities: selectedEntities,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setSummary(data.summary);
      setTriangle(data.triangle);
      setCustomLDFs([]); // Clear custom LDF selections
      setCustomIncurredLDFs([]); // Clear custom incurred LDF selections
      updateLogMessage(updateMsgId, 'Triangle successfully rebuilt with selected entity scope.');
    } catch (e: any) {
      addLogMessage('error', `Scope Update Failed: ${e.message}`);
      updateLogMessage(updateMsgId, `Failed to update scope: ${e.message}`);
    }
  };

  // Right panel render router
  const renderRightPanelContent = () => {
    switch (step) {
      case 0:
        return <UploadZone onRunPipeline={handleRunPipeline} />;
      case 1:
        return summary ? (
          <SummaryView 
            summary={summary} 
            currency={currency}
            onProceed={() => setStep(2)} 
            onUpdateMappings={handleUpdateMappings}
          />
        ) : null;
      case 2:
        return triangle && summary ? (
          <TriangleView
            triangle={triangle}
            summary={summary}
            currency={currency}
            ldfBase={ldfBase}
            onChangeLdfBase={(base) => {
              setLdfBase(base);
              setCustomLDFs(triangle.ldfs.slice(0, -1).map((s: any) => s[base] ?? 1.0));
            }}
            customLDFs={
              customLDFs.length > 0
                ? customLDFs
                : triangle.ldfs.slice(0, -1).map((s: any) => s[ldfBase] ?? 1.0)
            }
            onChangeCustomLDFs={setCustomLDFs}
            tailFactor={tailFactor}
            onChangeTailFactor={setTailFactor}
            incurredLdfBase={incurredLdfBase}
            onChangeIncurredLdfBase={(base) => {
              setIncurredLdfBase(base);
              if (triangle.incurred_ldfs) {
                setCustomIncurredLDFs(triangle.incurred_ldfs.slice(0, -1).map((s: any) => s[base] ?? 1.0));
              }
            }}
            customIncurredLDFs={
              customIncurredLDFs.length > 0
                ? customIncurredLDFs
                : triangle.incurred_ldfs?.slice(0, -1).map((s: any) => s[incurredLdfBase] ?? 1.0) || []
            }
            onChangeCustomIncurredLDFs={setCustomIncurredLDFs}
            incurredTailFactor={incurredTailFactor}
            onChangeIncurredTailFactor={setIncurredTailFactor}
            onProceed={handleTriangleProceed}
            onUpdateEntities={handleUpdateEntities}
          />
        ) : null;
      case 3:
        return triangle ? (
          <ConfigureAssumptions
            configs={configs}
            onChangeConfigs={setConfigs}
            triangle={triangle}
            suggestedElrPaid={suggestedElrPaid}
            suggestedElrIncurred={suggestedElrIncurred}
            suggestedMatureYears={suggestedMatureYears}
            matureCdfThreshold={matureCdfThreshold}
            onChangeMatureCdfThreshold={setMatureCdfThreshold}
            paidLdfBase={ldfBase}
            incurredLdfBase={incurredLdfBase}
            paidTailFactor={tailFactor}
            incurredTailFactor={incurredTailFactor}
            onBack={() => setStep(2)}
            onRunComparison={handleExecuteAllModels}
          />
        ) : null;
      case 4:
        return executeResult ? (
          <ResultsView
            sessionId={sessionId!}
            data={executeResult}
            currency={currency}
            onBack={() => {
              setStep(3);
            }}
          />
        ) : (
          <div className="flex flex-col flex-1 items-center justify-center text-text-sub h-64 font-mono">
            ⏳ Executing parallel actuarial engines & Reserve recommendation Agent...
          </div>
        );
      default:
        return null;
    }
  };

  const isStepClickable = (idx: number) => {
    if (idx === 0) return true; // Upload is always clickable
    if (idx === 1) return !!summary;
    if (idx === 2) return !!triangle;
    if (idx === 3) return !!triangle;
    if (idx === 4) return !!executeResult;
    return false;
  };

  const handleStepClick = (idx: number) => {
    setStep(idx);
  };

  return (
    <div className="grid grid-rows-[48px_1fr] grid-cols-[360px_1fr] h-screen w-screen overflow-hidden bg-bg text-text-main">
      {/* Top Header */}
      <header className="col-span-2 flex items-center justify-between px-5 bg-bg-1 border-b border-border h-12">
        <div className="font-bold text-sm text-text-main whitespace-nowrap">
          Actuarial <span className="text-accent">Reserve</span>
        </div>

        {/* Steps Bar */}
        <StepProgress
          currentStep={step}
          steps={STEPS}
          onStepClick={handleStepClick}
          isStepClickable={isStepClickable}
        />

        <div className="flex items-center gap-2.5">
          <select 
            value={currency} 
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            className="px-2 py-1.5 bg-bg-2 border border-border rounded text-xs text-text-sub font-medium hover:border-border-2 outline-none cursor-pointer"
          >
            {Object.entries(CURRENCIES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-2 border border-border rounded text-xs text-text-sub font-medium hover:border-border-2 hover:text-text-main transition-colors cursor-pointer"
          >
            <div
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                apiKey ? 'bg-accent-green' : 'bg-text-muted'
              }`}
              title={apiKey ? 'AI API connected' : 'AI not connected'}
            />
            AI Settings
          </button>
        </div>
      </header>

      {/* Main Grid Panels */}
      <SidebarChat
        messages={messages}
        chatInput={chatInput}
        setChatInput={setChatInput}
        onSendMessage={handleSendMessage}
        onSubmitConditions={handleSubmitConditions}
        isSessionActive={!!sessionId}
      />

      <main className="flex-1 overflow-y-auto bg-bg p-6 md:px-8">
        {renderRightPanelContent()}
      </main>

      {/* AI Key Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        baseUrl={baseUrl}
        modelName={modelName}
        apiKey={apiKey}
        onSave={saveSettings}
      />
    </div>
  );
}
