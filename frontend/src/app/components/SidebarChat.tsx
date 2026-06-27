'use client';
import React, { useRef, useEffect, useState } from 'react';
import { ChatMessage } from '../types';

interface SidebarChatProps {
  messages: ChatMessage[];
  chatInput: string;
  setChatInput: (val: string) => void;
  onSendMessage: () => void;
  onSubmitConditions: (conditions: { credible: boolean; freq: boolean; distort: boolean }) => void;
  isSessionActive: boolean;
}

export default function SidebarChat({
  messages,
  chatInput,
  setChatInput,
  onSendMessage,
  onSubmitConditions,
  isSessionActive,
}: SidebarChatProps) {
  const logRef = useRef<HTMLDivElement>(null);
  
  // Local state for interactive checkboxes
  const [condCredible, setCondCredible] = useState(false);
  const [condFreq, setCondFreq] = useState(false);
  const [condDistort, setCondDistort] = useState(false);
  const [submittedConditions, setSubmittedConditions] = useState(false);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'system':
        return '⬡';
      case 'agent':
        return '◆';
      case 'action':
        return '→';
      case 'error':
        return '✕';
      case 'warn':
        return '⚠';
      default:
        return '●';
    }
  };

  const parseMarkdownToHTML = (md: string): string => {
    if (!md) return '';
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/`([^`]+)`/g, '<code class="bg-bg-2 px-1 rounded font-mono text-xs text-accent">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    const lines = html.split('\n');
    let inTable = false;
    let tableRows: string[] = [];
    let resultLines: string[] = [];

    for (let line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        if (trimmed.replace(/[\s|:-]/g, '').length === 0) {
          continue;
        }
        const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
        const cellTag = tableRows.length === 0 ? 'th' : 'td';
        const cellMarkup = cells.map(c => `<${cellTag} class="border border-border/80 px-2.5 py-1.5 text-left">${c}</${cellTag}>`).join('');
        tableRows.push(`<tr class="${tableRows.length === 0 ? 'bg-bg-2 font-bold' : tableRows.length % 2 === 0 ? 'bg-bg-2/50' : 'bg-transparent'}">${cellMarkup}</tr>`);
      } else {
        if (inTable) {
          resultLines.push(`<div class="table-scroll border border-border rounded my-2"><table class="w-full text-[11px] border-collapse">${tableRows.join('')}</table></div>`);
          inTable = false;
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          resultLines.push(`<li class="ml-4 list-disc my-1">${trimmed.substring(2)}</li>`);
        } else if (/^\d+\.\s/.test(trimmed)) {
          const dotIndex = trimmed.indexOf('.');
          resultLines.push(`<li class="ml-4 list-decimal my-1">${trimmed.substring(dotIndex + 1).trim()}</li>`);
        } else if (trimmed) {
          resultLines.push(`<p class="my-1">${trimmed}</p>`);
        } else {
          resultLines.push('<br/>');
        }
      }
    }
    if (inTable) {
      resultLines.push(`<div class="table-scroll border border-border rounded my-2"><table class="w-full text-[11px] border-collapse">${tableRows.join('')}</table></div>`);
    }
    return resultLines.join('\n');
  };

  return (
    <aside className="w-[360px] bg-bg-1 border-r border-border flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border text-[11px] font-semibold tracking-widest text-text-muted uppercase flex items-center gap-1.5">
        ◆ Agent Activity &amp; Chat
      </div>
 
      {/* Message Log */}
      <div ref={logRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {messages.map((msg) => {
          const isChatBubble = msg.role === 'user' || msg.role === 'model';
          
          if (isChatBubble) {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} animate-slide-in w-full`}
              >
                <div
                  className={`px-3 py-2 text-[12.5px] leading-relaxed max-w-[95%] overflow-x-auto ${
                    isUser
                      ? 'bg-accent-dim border border-accent/25 text-text-main rounded-t-lg rounded-bl-lg'
                      : 'bg-bg-3 border border-border text-text-main rounded-t-lg rounded-br-lg w-full'
                  }`}
                  dangerouslySetInnerHTML={{
                    __html: msg.role === 'model' ? parseMarkdownToHTML(msg.text) : msg.text
                  }}
                />
              </div>
            );
          }

          if (msg.role === 'action' && msg.text.includes('Requires Input: Data Conditions')) {
            // Interactive check-boxes inside log
            return (
              <div
                key={msg.id}
                className="flex flex-col gap-3 p-3 border border-accent/40 bg-accent-dim/10 rounded animate-slide-in"
              >
                <div className="font-bold text-accent font-mono">[Recommender Agent] Requires Input: Data Conditions</div>
                <div className="text-[12.5px] text-text-main flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      disabled={submittedConditions}
                      checked={condCredible}
                      onChange={(e) => setCondCredible(e.target.checked)}
                      className="accent-accent"
                    />
                    Large amount of credible historical claims data available
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      disabled={submittedConditions}
                      checked={condFreq}
                      onChange={(e) => setCondFreq(e.target.checked)}
                      className="accent-accent"
                    />
                    High-frequency, low-severity lines with stable/timely reporting
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      disabled={submittedConditions}
                      checked={condDistort}
                      onChange={(e) => setCondDistort(e.target.checked)}
                      className="accent-accent"
                    />
                    Presence/absence of large claims does not greatly distort data
                  </label>
                </div>
                <div className="flex justify-end w-full">
                  <button
                    disabled={submittedConditions}
                    onClick={() => {
                      setSubmittedConditions(true);
                      onSubmitConditions({
                        credible: condCredible,
                        freq: condFreq,
                        distort: condDistort,
                      });
                    }}
                    className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:bg-bg-3 disabled:text-text-muted disabled:cursor-not-allowed text-white font-bold text-xs rounded transition-colors"
                  >
                    {submittedConditions ? 'Submitted ✓' : 'Submit & Resume →'}
                  </button>
                </div>
              </div>
            );
          }

          // Regular agent message/log
          const typeClass = {
            system: 'text-text-sub',
            agent: 'bg-accent-dim border border-accent/20 text-text-main',
            action: 'text-accent pl-5 font-mono',
            error: 'bg-accent-red/8 border-l-2 border-accent-red text-accent-red',
            warn: 'bg-accent-amber/8 border-l-2 border-accent-amber text-accent-amber',
            model: '',
            user: '',
          }[msg.role] || 'text-text-main';

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2 text-[12.5px] leading-relaxed px-2.5 py-2 rounded animate-slide-in ${typeClass}`}
            >
              <span className={`text-[13px] flex-shrink-0 w-4 text-center mt-0.5 ${msg.state === 'analyzing' ? 'animate-pulse' : ''}`}>
                {getIcon(msg.role)}
              </span>
              <span className="flex-1" dangerouslySetInnerHTML={{ __html: msg.role === 'agent' || msg.role === 'model' ? renderMarkdown(msg.text) : msg.text }} />
            </div>
          );
        })}
      </div>

      {/* Input Area */}
      <div className="p-3 border-t border-border flex gap-2 bg-bg-1">
        <textarea
          id="chat-input"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isSessionActive}
          placeholder={isSessionActive ? "Ask anything about your reserves… (Enter to send)" : "Upload data first to query parallel agent…"}
          rows={1}
          className="flex-1 bg-bg-2 border border-border rounded px-2.5 py-1.5 text-[12.5px] text-text-main resize-none outline-none focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed placeholder-text-muted h-9"
        />
        <button
          onClick={onSendMessage}
          disabled={!isSessionActive || !chatInput.trim()}
          className="px-3.5 py-1.5 bg-accent hover:bg-accent-hover disabled:bg-bg-3 disabled:text-text-muted disabled:cursor-not-allowed text-white text-xs font-semibold rounded transition-colors"
        >
          Send
        </button>
      </div>
    </aside>
  );
}
