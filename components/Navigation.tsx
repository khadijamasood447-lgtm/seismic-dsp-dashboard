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
  const [sitesOk, setSitesOk] = useState<boolean | null>(null);

  const check = async () => {
    try {
      const r = await fetch('/api/db/health', { cache: 'no-store' });
      if (!r.ok) {
        setDbConnected(false);
      } else {
        const j = await r.json().catch(() => null);
        setDbConnected(Boolean(j?.ok && j?.db?.connected));
      }
    } catch {
      setDbConnected(false);
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
    if (!dbConnected) return 'Backend offline (DB)';
    if (sitesOk === false) return 'Backend online (sites unavailable)';
    return 'Backend online';
  }, [dbConnected, sitesOk]);

  const navItems = [
    { id: 'home' as Page, label: 'Home', icon: Mountain },
    { id: 'soil-analysis' as Page, label: 'Soil Analysis', icon: Map },
    { id: '3d-viz' as Page, label: '3D Visualization', icon: Box },
  ];

  const roleItems = [
    { id: 'engineer' as Page, label: 'Engineer Dashboard', icon: UserCog, role: 'engineer' as UserRole },
    { id: 'authority' as Page, label: 'Authority Dashboard', icon: Shield, role: 'authority' as UserRole },
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
              Database connection is not available. Check your deployment environment variables for `DATABASE_URL` and SSL mode (`PGSSLMODE=require` when needed).
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
