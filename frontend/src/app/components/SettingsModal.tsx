'use client'; // Wait, let's make sure it's 'use client'
import React, { useState, useEffect } from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  baseUrl: string;
  modelName: string;
  apiKey: string;
  onSave: (baseUrl: string, modelName: string, apiKey: string) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  baseUrl: initialBaseUrl,
  modelName: initialModelName,
  apiKey: initialApiKey,
  onSave,
}: SettingsModalProps) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [modelName, setModelName] = useState(initialModelName);
  const [apiKey, setApiKey] = useState(initialApiKey);

  useEffect(() => {
    setBaseUrl(initialBaseUrl);
    setModelName(initialModelName);
    setApiKey(initialApiKey);
  }, [initialBaseUrl, initialModelName, initialApiKey]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!apiKey.trim()) {
      alert('Please enter a valid API key.');
      return;
    }
    onSave(baseUrl.trim(), modelName.trim(), apiKey.trim());
  };

  return (
    <div
      className="fixed inset-0 bg-black/75 z-[1000] flex items-center justify-center animate-slide-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-2 border border-border-2 rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <div className="text-base font-bold mb-1.5 text-text-main">Universal AI Settings</div>
        <div className="text-xs text-text-sub mb-4">
          Configure any OpenAI-compatible API (OpenRouter, Groq, OpenAI, etc).
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-[11px] text-text-sub font-semibold mb-1 uppercase tracking-wider">
              Base URL
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full bg-bg-1 border border-border-2 rounded px-3 py-2 text-xs text-text-main font-mono outline-none focus:border-accent"
              placeholder="https://openrouter.ai/api/v1"
            />
          </div>

          <div>
            <label className="block text-[11px] text-text-sub font-semibold mb-1 uppercase tracking-wider">
              Model Name
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="w-full bg-bg-1 border border-border-2 rounded px-3 py-2 text-xs text-text-main font-mono outline-none focus:border-accent"
              placeholder="google/gemini-2.0-flash-exp:free"
            />
          </div>

          <div>
            <label className="block text-[11px] text-text-sub font-semibold mb-1 uppercase tracking-wider">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-bg-1 border border-border-2 rounded px-3 py-2 text-xs text-text-main font-mono outline-none focus:border-accent"
              placeholder="sk-..."
              autoComplete="new-password"
              spellCheck="false"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-transparent border border-border-2 rounded text-xs text-text-sub font-medium hover:border-text-sub hover:text-text-main transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3.5 py-1.5 bg-accent hover:bg-accent-hover text-white rounded text-xs font-bold transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
