"use client"

import { useEffect, useState } from 'react'
import { HeroSection } from '@/components/HeroSection'
import { SoilAnalysis } from '@/components/SoilAnalysis'
import { Visualization3D } from '@/components/Visualization3D'
import { EngineerDashboard } from '@/components/EngineerDashboard'
import { AuthorityDashboard } from '@/components/AuthorityDashboard'
import { Navigation } from '@/components/Navigation'

type Page = 'home' | 'soil-analysis' | '3d-viz' | 'engineer' | 'authority'
type UserRole = 'engineer' | 'authority' | null

export default function Homepage() {
  const [currentPage, setCurrentPage] = useState<Page>('home')
  const [userRole, setUserRole] = useState<UserRole>(null)
  const [complianceResult, setComplianceResult] = useState<any>(null)

  useEffect(() => {
    try {
      const p = localStorage.getItem('seismic_current_page') as Page | null
      const r = localStorage.getItem('seismic_user_role') as UserRole | null
      const c = localStorage.getItem('seismic_compliance_result')
      if (p) setCurrentPage(p)
      if (r) setUserRole(r)
      if (c) setComplianceResult(JSON.parse(c))
    } catch {}
  }, [])

  useEffect(() => {
    const onNav = (ev: any) => {
      const p = ev?.detail?.page as Page | undefined
      if (!p) return
      setCurrentPage(p)
      try {
        localStorage.setItem('seismic_current_page', p)
      } catch {}
    }
    window.addEventListener('seismic-navigate', onNav as any)
    return () => window.removeEventListener('seismic-navigate', onNav as any)
  }, [])

  useEffect(() => {
    const onCompliance = (ev: any) => {
      const result = ev?.detail ?? null
      setComplianceResult(result)
      try {
        localStorage.setItem('seismic_compliance_result', JSON.stringify(result))
      } catch {}
    }
    window.addEventListener('seismic-compliance-result', onCompliance as any)
    return () => window.removeEventListener('seismic-compliance-result', onCompliance as any)
  }, [])

  const navigate = (p: Page) => {
    setCurrentPage(p)
    try {
      localStorage.setItem('seismic_current_page', p)
    } catch {}
  }

  const selectRole = (r: UserRole) => {
    setUserRole(r)
    try {
      localStorage.setItem('seismic_user_role', r ?? '')
    } catch {}
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HeroSection onNavigate={navigate} onSelectRole={selectRole} />
      case 'soil-analysis':
        return <SoilAnalysis />
      case '3d-viz':
        return <Visualization3D initialComplianceResult={complianceResult} />
      case 'engineer':
        return <EngineerDashboard />
      case 'authority':
        return <AuthorityDashboard />
      default:
        return <HeroSection onNavigate={navigate} onSelectRole={selectRole} />
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {currentPage !== 'home' && (
        <Navigation 
          currentPage={currentPage} 
          onNavigate={navigate}
          userRole={userRole}
        />
      )}
      {renderPage()}
    </div>
  )
}
