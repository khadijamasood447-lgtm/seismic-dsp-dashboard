"use client"

import { Mountain, Map, Box, LayoutDashboard, UserCog, Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Page = 'home' | 'soil-analysis' | '3d-viz' | 'engineer' | 'authority';
type UserRole = 'engineer' | 'authority' | null;

interface NavigationProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  userRole: UserRole;
}

export function Navigation({ currentPage, onNavigate, userRole }: NavigationProps) {
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [dbStatus, setDbStatus] = useState<string | null>(null);
  const [sitesOk, setSitesOk] = useState<boolean | null>(null);

  const check = async () => {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (!r.ok) {
        setDbConnected(false);
        setDbStatus('error');
      } else {
        const j = await r.json().catch(() => null);
        const s = String(j?.services?.database?.status ?? 'unknown');
        setDbStatus(s);
        setDbConnected(s === 'healthy');
      }
    } catch {
      setDbConnected(false);
      setDbStatus('error');
    }

    try {
      const r = await fetch('/api/sites?limit=1&page=1', { cache: 'no-store' });
      setSitesOk(r.ok);
    } catch {
      setSitesOk(false);
    }
  };

  useEffect(() => {
    check();
    const id = window.setInterval(check, 30000);
    return () => window.clearInterval(id);
  }, []);

  const statusLabel = useMemo(() => {
    if (dbConnected === null) return 'Checking backend…';
    if (!dbConnected) return dbStatus === 'not_configured' ? 'Backend not configured' : 'Backend offline';
    if (sitesOk === false) return 'Backend online (sites unavailable)';
    return 'Backend online';
  }, [dbConnected, sitesOk, dbStatus]);

  const navItems = [
    { id: 'home' as Page, label: 'Home', icon: Mountain },
    { id: 'soil-analysis' as Page, label: 'Soil Analysis', icon: Map },
    { id: '3d-viz' as Page, label: '3D Visualization', icon: Box },
  ];

  const roleItems = [
    { id: 'engineer' as Page, label: 'Engineer Dashboard', icon: UserCog, role: 'engineer' as UserRole },
    { id: 'authority' as Page, label: 'CDA Dashboard', icon: Shield, role: 'authority' as UserRole },
  ];

  return (
    <nav className="bg-background border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Mountain className="w-8 h-8 text-[#0d9488]" />
            <span className="text-foreground font-medium">GeoNexus AI</span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full ${
                  dbConnected === null
                    ? 'bg-muted'
                    : dbConnected
                      ? sitesOk === false
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                      : 'bg-red-500'
                }`}
              />
              <span>{statusLabel}</span>
              <button className="text-muted-foreground hover:text-foreground" onClick={check}>
                Retry
              </button>
            </div>

            <div className="flex items-center gap-1 flex-wrap justify-end">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    currentPage === item.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm hidden sm:inline">{item.label}</span>
                </button>
              );
            })}
            
            {userRole && (
              <div className="ml-4 pl-4 border-l border-gray-300">
                {roleItems
                  .filter(item => item.role === userRole)
                  .map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onNavigate(item.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                          currentPage === item.id
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-sm hidden sm:inline">{item.label}</span>
                      </button>
                    );
                  })}
              </div>
            )}
            </div>
          </div>
        </div>

        {dbConnected === false && (
          <div className="pb-4">
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
              {dbStatus === 'not_configured'
                ? 'Supabase server is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables.'
                : 'Backend is unavailable. Check Vercel Function logs for /api/health and confirm Supabase keys are set.'}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
