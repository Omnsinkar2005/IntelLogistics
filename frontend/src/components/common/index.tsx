import { cn } from "@/utils";
import { Loader2, AlertCircle, PackageSearch } from "lucide-react";
import type { ReactNode } from "react";

// ─── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide", className)}>
      {children}
    </span>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading, children, className, disabled, ...props }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500 shadow-sm shadow-indigo-600/20 hover:shadow-md hover:shadow-indigo-600/25",
    secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 focus:ring-slate-300 shadow-sm",
    ghost: "text-slate-600 hover:bg-slate-100 focus:ring-slate-300",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm shadow-red-600/20",
  };
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-sm" };
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, className, hover = false }: { children?: ReactNode; className?: string; hover?: boolean }) {
  return (
    <div className={cn("bg-white border border-slate-200/80 rounded-xl shadow-sm", hover && "card-hover", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-4 border-b border-slate-100", className)}>{children}</div>;
}

export function CardBody({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, icon: Icon, color = "blue", onClick }: {
  label: string; value: string | number; sub?: string;
  icon?: React.ElementType; color?: "blue" | "green" | "red" | "amber" | "purple" | "indigo";
  onClick?: () => void;
}) {
  const iconBg: Record<string, string> = {
    blue: "stat-accent-blue text-blue-600",
    green: "stat-accent-green text-emerald-600",
    red: "stat-accent-red text-red-500",
    amber: "stat-accent-amber text-amber-600",
    purple: "stat-accent-purple text-purple-600",
    indigo: "stat-accent-indigo text-indigo-600",
  };
  return (
    <Card hover className={cn("p-5", onClick && "cursor-pointer")} >
      <div className="flex items-start justify-between" onClick={onClick}>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
          <p className="mt-1.5 text-2xl font-extrabold text-slate-900 tabular-nums">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        {Icon && (
          <div className={cn("p-2.5 rounded-xl", iconBg[color])}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Loading ──────────────────────────────────────────────────────────────────
export function LoadingSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin text-indigo-500", className ?? "w-6 h-6")} />;
}

export function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <LoadingSpinner className="w-8 h-8" />
      <p className="text-xs text-slate-400 font-medium">Loading...</p>
    </div>
  );
}

// ─── Error ────────────────────────────────────────────────────────────────────
export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-red-400" />
      </div>
      <p className="text-sm text-slate-600 max-w-sm">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

// ─── Empty ────────────────────────────────────────────────────────────────────
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
        <PackageSearch className="w-6 h-6 text-slate-300" />
      </div>
      <div>
        <p className="font-semibold text-slate-700">{title}</p>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-50/80 border-b border-slate-100", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 text-slate-700 border-b border-slate-50", className)}>{children}</td>;
}

// ─── Section Header ───────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

// ─── KPI Pill ─────────────────────────────────────────────────────────────────
// `neutral` renders a gray "unknown" style — use it when the value is
// unavailable, so missing data doesn't read as "bad" (red).
export function KPIPill({ label, value, good, neutral }: { label: string; value: string; good: boolean; neutral?: boolean }) {
  return (
    <div className={cn(
      "flex flex-col items-center px-3 py-2.5 rounded-lg border transition-colors",
      neutral ? "bg-slate-50 border-slate-100" : good ? "bg-emerald-50/60 border-emerald-100" : "bg-red-50/60 border-red-100"
    )}>
      <span className={cn("text-base font-bold", neutral ? "text-slate-400" : good ? "text-emerald-600" : "text-red-500")}>{value}</span>
      <span className="text-[11px] text-slate-500 mt-0.5 text-center leading-tight font-medium">{label}</span>
    </div>
  );
}

// ─── Score Bar ────────────────────────────────────────────────────────────────
export function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100);
  const color = score >= 90 ? "bg-emerald-500" : score >= 80 ? "bg-green-500" : score >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full bg-slate-100 rounded-full h-1.5">
      <div className={cn("h-1.5 rounded-full transition-all duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────
export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-slate-100 my-4", className)} />;
}

// ─── Status Dot ───────────────────────────────────────────────────────────────
export function StatusDot({ color = "green", pulse = false }: { color?: "green" | "red" | "amber" | "blue"; pulse?: boolean }) {
  const colors: Record<string, string> = {
    green: "bg-emerald-500",
    red: "bg-red-500",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
  };
  return (
    <span className={cn("inline-block w-2 h-2 rounded-full", colors[color], pulse && "animate-pulse-soft")} />
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}
export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-semibold text-slate-600">{label}</label>}
      <input
        className={cn(
          "w-full px-3 py-2 text-sm border rounded-lg bg-white text-slate-900 placeholder-slate-400",
          "focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-colors",
          error ? "border-red-400" : "border-slate-200",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
}
export function Select({ label, error, className, children, ...props }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-semibold text-slate-600">{label}</label>}
      <select
        className={cn(
          "w-full px-3 py-2 text-sm border rounded-lg bg-white text-slate-900",
          "focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-colors",
          error ? "border-red-400" : "border-slate-200",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ─── Textarea ─────────────────────────────────────────────────────────────────
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}
export function Textarea({ label, error, className, ...props }: TextareaProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-semibold text-slate-600">{label}</label>}
      <textarea
        className={cn(
          "w-full px-3 py-2 text-sm border rounded-lg bg-white text-slate-900 placeholder-slate-400 resize-none",
          "focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-colors",
          error ? "border-red-400" : "border-slate-200",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
