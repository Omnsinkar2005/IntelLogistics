import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, ClipboardList, Truck, Package, FileCheck, Activity, PlayCircle } from "lucide-react";
import { cn } from "@/utils";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/requirements", icon: ClipboardList, label: "Requirements" },
  { to: "/shipments", icon: Truck, label: "Shipments" },
  { to: "/transporters", icon: Package, label: "Transporters" },
  { to: "/pod", icon: FileCheck, label: "POD" },
];

export function AppShell() {
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* ─── Sidebar ─── */}
      <aside className="w-60 flex-shrink-0 flex flex-col" style={{ background: "var(--sidebar-bg)" }}>
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-tight tracking-tight">IntelLogistics</p>
              <p className="text-[11px] text-slate-400 tracking-wide">Logistics Intelligence</p>
            </div>
          </div>
        </div>

        {/* Company context */}
        <div className="px-5 py-3 border-b border-white/5">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Company</p>
          <p className="text-sm font-semibold text-slate-200 mt-0.5">Biological E Limited</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 relative",
                  isActive
                    ? "bg-indigo-500/15 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-indigo-400" />
                  )}
                  <Icon className={cn("w-[18px] h-[18px] flex-shrink-0 transition-colors", isActive ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300")} />
                  {label}
                  {/* Live dot for Dashboard when active */}
                  {to === "/" && isActive && (
                    <div className="ml-auto live-dot" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Demo Mode — visually distinct from the product nav above */}
        <div className="px-3 pb-3">
          <div className="border-t border-white/5 pt-3">
            <NavLink
              to="/demo"
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 border",
                  isActive
                    ? "bg-amber-500/15 text-amber-200 border-amber-500/30"
                    : "text-amber-400/80 border-amber-500/10 hover:bg-amber-500/10 hover:text-amber-200"
                )
              }
            >
              <PlayCircle className="w-[18px] h-[18px] flex-shrink-0" />
              Demo Mode
            </NavLink>
          </div>
        </div>

        {/* Footer — User */}
        <div className="px-4 py-4 border-t border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-300">
              AS
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-200 truncate">Arjun Sharma</p>
              <p className="text-[11px] text-slate-500">Logistics Manager</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Main content ─── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-6 animate-fade-in-up" key={location.pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
