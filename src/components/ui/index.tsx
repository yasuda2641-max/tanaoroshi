'use client';
import React from 'react';

// ── Badge ────────────────────────────────────────
type BadgeVariant = 'green' | 'amber' | 'red' | 'gray' | 'blue';
const badgeStyles: Record<BadgeVariant, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red:   'bg-red-50 text-red-700 border-red-200',
  gray:  'bg-stone-100 text-stone-500 border-stone-200',
  blue:  'bg-blue-50 text-blue-700 border-blue-200',
};
export function Badge({ variant, children }: { variant: BadgeVariant; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badgeStyles[variant]}`}>
      {children}
    </span>
  );
}

// ── Button ───────────────────────────────────────
type BtnVariant = 'primary' | 'outline' | 'danger' | 'ghost';
const btnStyles: Record<BtnVariant, string> = {
  primary: 'bg-[#1A3A2A] text-white hover:bg-[#2a5a3a] border-transparent',
  outline: 'bg-transparent text-stone-800 border-stone-300 hover:bg-stone-100',
  danger:  'bg-red-600 text-white hover:bg-red-700 border-transparent',
  ghost:   'bg-transparent text-stone-500 border-transparent hover:bg-stone-100',
};
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md';
}
export function Button({ variant = 'outline', size = 'md', className = '', children, ...props }: ButtonProps) {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm';
  return (
    <button
      className={`inline-flex items-center gap-1.5 font-medium rounded-md border transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${sz} ${btnStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// ── Card ─────────────────────────────────────────
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-stone-200 rounded-xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}

// ── Input ─────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}
export function Input({ label, hint, error, className = '', ...props }: InputProps) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-xs font-medium text-stone-500">{label}</label>}
      <input
        className={`w-full px-3 py-2 text-sm border rounded-md outline-none transition-colors
          border-stone-300 focus:border-[#4A7A5A] bg-white text-stone-900 placeholder:text-stone-400
          ${error ? 'border-red-400' : ''} ${className}`}
        {...props}
      />
      {hint && !error && <p className="text-xs text-stone-400">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Select ───────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}
export function Select({ label, className = '', children, ...props }: SelectProps) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-xs font-medium text-stone-500">{label}</label>}
      <select
        className={`w-full px-3 py-2 text-sm border border-stone-300 rounded-md outline-none
          focus:border-[#4A7A5A] bg-white text-stone-900 cursor-pointer ${className}`}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

// ── Textarea ─────────────────────────────────────
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}
export function Textarea({ label, className = '', ...props }: TextareaProps) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-xs font-medium text-stone-500">{label}</label>}
      <textarea
        className={`w-full px-3 py-2 text-sm border border-stone-300 rounded-md outline-none
          focus:border-[#4A7A5A] bg-white text-stone-900 resize-vertical ${className}`}
        {...props}
      />
    </div>
  );
}

// ── Modal ─────────────────────────────────────────
export function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-stone-900">{title}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── StatCard ─────────────────────────────────────
export function StatCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
      <div className="text-xs font-medium text-stone-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent ?? 'text-stone-900'}`}>{value}</div>
      {sub && <div className="text-xs text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── ProgressBar ───────────────────────────────────
export function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden w-full">
      <div className="h-full bg-[#4A7A5A] rounded-full transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Alert ─────────────────────────────────────────
type AlertVariant = 'info' | 'warn' | 'danger' | 'success';
const alertStyles: Record<AlertVariant, string> = {
  info:    'bg-blue-50 text-blue-800 border-blue-200',
  warn:    'bg-amber-50 text-amber-800 border-amber-200',
  danger:  'bg-red-50 text-red-800 border-red-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};
export function Alert({ variant = 'info', children, className = '' }: { variant?: AlertVariant; children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-4 py-3 rounded-lg text-sm border ${alertStyles[variant]} ${className}`}>{children}</div>
  );
}

// ── Loading ───────────────────────────────────────
export function Loading({ text = '読み込み中...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-stone-400 text-sm">
      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      {text}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────
export function EmptyState({ icon, text }: { icon?: string; text: string }) {
  return (
    <div className="text-center py-12 text-stone-400">
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <p className="text-sm">{text}</p>
    </div>
  );
}
