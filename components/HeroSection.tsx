import { Button } from './ui/button';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ChevronDown, User, Mountain, Shield, BarChart3, FileCheck, Upload, FileText } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';

// Define the different pages users can navigate to
type Page = 'home' | 'soil-analysis' | '3d-viz' | 'engineer' | 'authority';

// Define the different user roles
type UserRole = 'engineer' | 'authority' | 'public';

// Define what properties this component expects from its parent
interface HeroSectionProps {
  onNavigate: (page: Page) => void;
  onSelectRole: (role: UserRole) => void;
}

// Define the structure of earthquake data for the chart
interface EarthquakeData {
  year: string;
  infrastructureLoss: number;
  fatalities: number;
}

// Sample data for the earthquake chart
const earthquakeData: EarthquakeData[] = [
  { year: '2001', infrastructureLoss: 15000, fatalities: 150 },
  { year: '2005', infrastructureLoss: 220000, fatalities: 87000 },
  { year: '2010', infrastructureLoss: 25000, fatalities: 200 },
  { year: '2015', infrastructureLoss: 18000, fatalities: 180 },
];

// Animation timing constants (in milliseconds)
const ANIMATION_TIMING = {
  G_DELAY: 500,           // When the "G" logo appears
  GEONEXUS_DELAY: 1500,   // When "EONEXUS" text appears
  SLIDE_OUT_DELAY: 3500,  // When logo slides away
  HERO_SHOW_DELAY: 4000,  // When main content appears
  NAVBAR_SHOW_DELAY: 4500, // When top navigation appears
} as const;

export function HeroSection({ onNavigate, onSelectRole }: HeroSectionProps) {
  // ========== STATE VARIABLES ==========
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('public');
  const [showMainText, setShowMainText] = useState(false);
  const [showKashmirText, setShowKashmirText] = useState(false);
  const [showHero, setShowHero] = useState(false);
  const [showNavbar, setShowNavbar] = useState(false);
  const [activeButton, setActiveButton] = useState<string | null>(null);
  const [logoAnimation, setLogoAnimation] = useState({
    showG: false,
    showGeoNexus: false,
    slideOut: false
  });
  const [showSkyline, setShowSkyline] = useState(false);
  const [showAboutUs, setShowAboutUs] = useState(false);
  const [showVisionText, setShowVisionText] = useState(false);
  const [showMissionText, setShowMissionText] = useState(false);
  const [showImpactImage, setShowImpactImage] = useState(false);
  const [showImpactTitle, setShowImpactTitle] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showGraphCaption, setShowGraphCaption] = useState(false);
  
  // ========== REFS ==========
  const heroSectionRef = useRef<HTMLDivElement>(null);
  const impactSectionRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigationSectionRef = useRef<HTMLDivElement>(null);
  const whatWeDoSectionRef = useRef<HTMLDivElement>(null);
  const aboutUsSectionRef = useRef<HTMLDivElement>(null);

  // All sections for smooth scrolling
  const sections = [
    { id: 'hero', ref: heroSectionRef },
    { id: 'impact', ref: impactSectionRef },
    { id: 'navigation', ref: navigationSectionRef },
    { id: 'what-we-do', ref: whatWeDoSectionRef },
    { id: 'about-us', ref: aboutUsSectionRef }
  ];

  // Scroll management
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentSectionIndexRef = useRef(0);

  // ========== USE EFFECTS ==========

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowRoleDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Main animation sequence
  useEffect(() => {
    const animationSequence = () => {
      setTimeout(() => {
        setLogoAnimation(prev => ({ ...prev, showG: true }));
      }, ANIMATION_TIMING.G_DELAY);

      setTimeout(() => {
        setLogoAnimation(prev => ({ ...prev, showGeoNexus: true }));
      }, ANIMATION_TIMING.GEONEXUS_DELAY);

      setTimeout(() => {
        setLogoAnimation(prev => ({ ...prev, slideOut: true }));
      }, ANIMATION_TIMING.SLIDE_OUT_DELAY);

      setTimeout(() => {
        setShowHero(true);
        setShowMainText(true);
      }, ANIMATION_TIMING.HERO_SHOW_DELAY);

      setTimeout(() => {
        setShowNavbar(true);
      }, ANIMATION_TIMING.NAVBAR_SHOW_DELAY);
    };

    animationSequence();
  }, []);

  // Animation for impact section elements when they come into view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Staggered animations for impact section
            setTimeout(() => {
              setShowImpactTitle(true);
            }, 200);
            setTimeout(() => {
              setShowKashmirText(true);
            }, 400);
            setTimeout(() => {
              setShowGraph(true);
            }, 600);
            setTimeout(() => {
              setShowGraphCaption(true);
            }, 800);
            setTimeout(() => {
              setShowImpactImage(true);
            }, 1000);
          }
        });
      },
      { threshold: 0.3 }
    );

    if (impactSectionRef.current) {
      observer.observe(impactSectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Animation for What We Do section when it comes into view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setTimeout(() => {
              setShowSkyline(true);
            }, 300);
            setTimeout(() => {
              setShowVisionText(true);
            }, 600);
            setTimeout(() => {
              setShowMissionText(true);
            }, 900);
          }
        });
      },
      { threshold: 0.2 }
    );

    if (whatWeDoSectionRef.current) {
      observer.observe(whatWeDoSectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Animation for About Us section when it comes into view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setTimeout(() => {
              setShowAboutUs(true);
            }, 300);
          }
        });
      },
      { threshold: 0.3 }
    );

    if (aboutUsSectionRef.current) {
      observer.observe(aboutUsSectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // ========== SCROLLING FUNCTIONS ==========
  const scrollToNextSection = useCallback(() => {
    if (isScrolling || currentSectionIndexRef.current >= sections.length - 1) return;
    
    setIsScrolling(true);
    const nextIndex = currentSectionIndexRef.current + 1;
    currentSectionIndexRef.current = nextIndex;
    
    sections[nextIndex].ref.current?.scrollIntoView({ 
      behavior: 'smooth'
    });
    
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 600);
  }, [isScrolling, sections]);

  const scrollToPreviousSection = useCallback(() => {
    if (isScrolling || currentSectionIndexRef.current <= 0) return;
    
    setIsScrolling(true);
    const prevIndex = currentSectionIndexRef.current - 1;
    currentSectionIndexRef.current = prevIndex;
    
    sections[prevIndex].ref.current?.scrollIntoView({ 
      behavior: 'smooth'
    });
    
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 600);
  }, [isScrolling, sections]);

  const scrollToSection = useCallback((sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (section && !isScrolling) {
      const index = sections.findIndex(s => s.id === sectionId);
      currentSectionIndexRef.current = index;
      setIsScrolling(true);
      
      section.ref.current?.scrollIntoView({ 
        behavior: 'smooth'
      });
      
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 600);
    }
  }, [isScrolling, sections]);

  // Smooth scrolling implementation
  useEffect(() => {
    let lastScrollTime = 0;
    const SCROLL_COOLDOWN = 800;

    const handleWheel = (event: WheelEvent) => {
      const now = Date.now();
      
      if (now - lastScrollTime < SCROLL_COOLDOWN) {
        return;
      }

      const target = event.target as HTMLElement;
      if (target.closest('button') || target.closest('.dropdown') || target.closest('input') || target.closest('textarea')) {
        return;
      }

      if (Math.abs(event.deltaY) < 50) return;

      event.preventDefault();
      
      if (event.deltaY > 0) {
        lastScrollTime = now;
        scrollToNextSection();
      } else if (event.deltaY < 0) {
        lastScrollTime = now;
        scrollToPreviousSection();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const now = Date.now();
      
      if (now - lastScrollTime < SCROLL_COOLDOWN) {
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        lastScrollTime = now;
        scrollToNextSection();
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        lastScrollTime = now;
        scrollToPreviousSection();
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [scrollToNextSection, scrollToPreviousSection]);

  // ========== EVENT HANDLERS ==========
  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    setShowRoleDropdown(false);
    onSelectRole(role);
  };

  const getRoleDisplayName = (role: UserRole): string => {
    const roleNames = {
      engineer: 'Site Engineer',
      authority: 'CDA Authority',
      public: 'Public User'
    };
    return roleNames[role];
  };

  const handleButtonClick = (buttonId: string, onClick: () => void) => {
    setActiveButton(buttonId);
    setTimeout(() => {
      setActiveButton(null);
    }, 300);
    onClick();
  };

  // ========== NAVIGATION BUTTONS CONFIGURATION ==========
  const getNavigationButtons = () => {
    const baseButtons = [
      {
        id: 'subsurface',
        label: 'Subsurface Risk Intelligence',
        subtext: 'Vulnerability at a glance',
        onClick: () => onNavigate('soil-analysis'),
        icon: BarChart3,
        available: true
      },
      {
        id: 'simulator',
        label: 'Earthquake Scenario Simulator',
        subtext: 'Visualize seismic impact',
        onClick: () => onNavigate('3d-viz'),
        icon: Shield,
        available: true
      },
      {
        id: 'reports',
        label: 'Reports',
        subtext: 'Data that speaks safety',
        onClick: () => {
          if (selectedRole === 'engineer') {
            onNavigate('engineer');
          } else if (selectedRole === 'authority') {
            onNavigate('authority');
          } else {
            onNavigate('soil-analysis');
          }
        },
        icon: FileText,
        available: true
      }
    ];

    const roleSpecificButtons = {
      engineer: [
        {
          id: 'design-hub',
          label: 'Design Hub',
          subtext: 'Your blueprints, our seismic insights',
          onClick: () => onNavigate('engineer'),
          icon: Upload,
          available: true
        }
      ],
      authority: [
        {
          id: 'compliance',
          label: 'Compliance & Approval',
          subtext: 'Streamlined regulatory oversight',
          onClick: () => onNavigate('authority'),
          icon: FileCheck,
          available: true
        }
      ],
      public: []
    };

    return [...baseButtons, ...roleSpecificButtons[selectedRole]];
  };

  const navigationButtons = getNavigationButtons();
  const fallbackImage = "https://images.unsplash.com/photo-1685211097893-c3fcafdae020?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBza3lzY3JhcGVyJTIwY2l0eXxlbnwxfHx8fDE3NjI5NDU4NzZ8MA&ixlib=rb-4.1.0&q=80&w=1080";

  const getGridColumns = () => {
    const buttonCount = navigationButtons.length;
    if (buttonCount === 3) return 'lg:grid-cols-3';
    if (buttonCount === 4) return 'lg:grid-cols-2 xl:grid-cols-4';
    return 'lg:grid-cols-2';
  };

  return (
    <div className="bg-[#0a0f1c]">
      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-20px) scale(1.05); }
        }
        @keyframes slideInLeft {
          0% { transform: translateX(-100px); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInRight {
          0% { transform: translateX(100px); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideUp {
          0% { transform: translateY(100px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(235, 211, 202, 0.3); }
          50% { box-shadow: 0 0 40px rgba(235, 211, 202, 0.6); }
        }
        @keyframes fadeInScale {
          0% { transform: scale(0.8); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeInUp {
          0% { transform: translateY(30px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .animate-float { animation: float 8s ease-in-out infinite; }
        .animate-slide-left { animation: slideInLeft 1s ease-out forwards; }
        .animate-slide-right { animation: slideInRight 1s ease-out forwards; }
        .animate-slide-up { animation: slideUp 1s ease-out forwards; }
        .animate-pulse-glow { animation: pulseGlow 3s ease-in-out infinite; }
        .animate-fade-in-scale { animation: fadeInScale 1s ease-out forwards; }
        .animate-fade-in-up { animation: fadeInUp 1s ease-out forwards; }
      `}</style>

      {/* Fixed Navigation Bar */}
      {showNavbar && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-[#0a0f1c]/90 backdrop-blur-lg border-b border-[#334155] animate-in fade-in duration-500">
          <div className="max-w-7xl mx-auto px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mountain className="w-7 h-7 text-[#EBD3CA]" />
                <span className="text-white text-xl font-bold tracking-wider">GEONEXUS</span>
              </div>

              <div className="relative dropdown" ref={dropdownRef}>
                <Button
                  variant="outline"
                  className="border border-[#334155] text-white hover:bg-[#1e293b] hover:border-[#EBD3CA] px-6 py-2 bg-[#0f172a]/80 backdrop-blur-lg flex items-center gap-2 transition-all duration-300 hover:shadow-lg hover:shadow-[#EBD3CA]/20"
                  onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                >
                  <User className="w-4 h-4 text-[#EBD3CA]" />
                  <span className="text-white">{getRoleDisplayName(selectedRole)}</span>
                  <ChevronDown className={`w-4 h-4 text-[#EBD3CA] transition-transform duration-200 ${
                    showRoleDropdown ? 'rotate-180' : ''
                  }`} />
                </Button>
                
                {showRoleDropdown && (
                  <div className="absolute top-full right-0 mt-2 w-56 bg-[#1e293b] rounded-xl shadow-2xl border border-[#334155] py-2 z-30 backdrop-blur-lg">
                    <div className="px-4 py-2 border-b border-[#334155]">
                      <span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wide">Select Role</span>
                    </div>
                    {(['public', 'engineer', 'authority'] as UserRole[]).map((role) => (
                      <button
                        key={role}
                        onClick={() => handleRoleSelect(role)}
                        className={`w-full text-left px-4 py-3 transition-all duration-200 ${
                          selectedRole === role 
                            ? 'bg-[#EBD3CA] text-[#0a0f1c] font-medium' 
                            : 'text-[#e2e8f0] hover:bg-[#334155]'
                        }`}
                      >
                        {getRoleDisplayName(role)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logo Animation Overlay */}
      {!showHero && (
        <div className={`fixed inset-0 bg-[#0a0f1c] z-50 flex items-center justify-center transition-all duration-700 ${
          logoAnimation.slideOut ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
        }`}>
          <div className="flex items-center gap-8">
            <div className={`transition-all duration-1000 ${
              logoAnimation.showG ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
            }`}>
              <div className="relative">
                <div className="absolute inset-0 bg-[#EBD3CA] rounded-full blur-xl opacity-50 animate-pulse"></div>
                <div className="relative w-32 h-32 border-4 border-[#EBD3CA] rounded-full flex items-center justify-center bg-[#0a0f1c]/90 backdrop-blur-sm">
                  <span className="text-[#EBD3CA] text-6xl font-light tracking-wider">G</span>
                </div>
              </div>
            </div>
            
            <div className={`transition-all duration-1000 delay-500 ${
              logoAnimation.showGeoNexus 
                ? 'translate-x-0 opacity-100' 
                : '-translate-x-12 opacity-0'
            }`}>
              <div className="relative">
                <div className="absolute inset-0 bg-white blur-lg opacity-20"></div>
                <span className="relative text-white text-5xl font-light tracking-widest">
                  EONEXUS
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <div 
        id="hero-section"
        ref={heroSectionRef}
        className={`relative min-h-screen overflow-hidden flex flex-col bg-[#0a0f1c] transition-opacity duration-700 ${
          showHero ? 'opacity-100' : 'opacity-0'
        } ${showNavbar ? 'pt-16' : ''}`}
      >
        <div className="absolute inset-0 w-full h-full z-0">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/videos/skylineformission.png"
          >
            <source src="/videos/HEROSECTION.mp4" type="video/mp4" />
          </video>
        </div>
        
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0f1c]/60 to-transparent z-10 pointer-events-none"></div>
        
        <div className="relative h-full flex items-center z-20">
          <div className="max-w-7xl mx-auto px-8 w-full mt-24">
            <div className="max-w-2xl space-y-6">
              <div className="space-y-2">
                <p className="text-white text-sm font-medium tracking-widest uppercase">
                  WHERE DATA MEETS THE GROUND
                </p>
                <div className="w-24 h-0.5 bg-gradient-to-r from-[#EBD3CA] to-transparent"></div>
              </div>

              <div className="space-y-3">
                <h1 className="text-white text-5xl md:text-6xl lg:text-7xl font-light leading-[0.9]">
                  <div className={`transition-all duration-500 ease-out ${
                    showMainText ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
                  }`}>
                    See the
                  </div>
                  <span className="font-bold text-white">
                    <div className={`transition-all duration-500 ease-out delay-100 ${
                      showMainText ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
                    }`}>
                      Unseen
                    </div>
                  </span>
                </h1>
                
                <h1 className="text-white text-5xl md:text-6xl lg:text-7xl font-light leading-[0.9]">
                  <div className={`transition-all duration-500 ease-out delay-200 ${
                    showMainText ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
                  }`}>
                    Build with
                  </div>
                  <span className="font-bold text-white">
                    <div className={`transition-all duration-500 ease-out delay-300 ${
                      showMainText ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
                    }`}>
                      Confidence
                    </div>
                  </span>
                </h1>
              </div>

              <div className="pt-8">
                <div className={`transition-all duration-500 ease-out delay-400 ${
                  showMainText ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
                }`}>
                  <Button 
                    variant="outline" 
                    className="border-2 border-[#EBD3CA] text-white hover:bg-[#EBD3CA] hover:text-[#0a0f1c] px-12 py-6 text-lg font-medium transition-all duration-500 hover:scale-105 hover:shadow-2xl hover:shadow-[#EBD3CA]/20"
                    onClick={() => scrollToSection('navigation')}
                  >
                    Learn More
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Impact Section - UPDATED with animations and larger PNG */}
      <div 
        id="impact-section" 
        ref={impactSectionRef}
        className="min-h-screen bg-[#0f172a] py-12 flex items-center"
      >
        <div className="max-w-7xl mx-auto px-8 w-full">
          <div className="flex flex-col lg:flex-row items-start gap-8 lg:gap-16">
            {/* Left Side - Content and Graph */}
            <div className="flex-1 w-full space-y-8">
              {/* Title - Left Aligned with Animation */}
              <div className={`text-left transition-all duration-700 ease-out ${
                showImpactTitle ? 'animate-fade-in-up opacity-100' : 'opacity-0 translate-y-8'
              }`}>
                <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                  Seismic Impact Analysis
                </h2>
              </div>

              {/* Kashmir Text - No Background with Animation */}
              <div className={`text-white transition-all duration-700 ease-out ${
                showKashmirText ? 'animate-fade-in-up opacity-100' : 'opacity-0 translate-y-8'
              }`}>
                <p className="text-lg leading-relaxed font-light">
                  The 2005 Kashmir earthquake alone claimed over 87,000 lives and inflicted $5.2 billion in damage, devastating both Pakistan&apos;s people and its economy in moments.
                </p>
              </div>

              {/* Graph Container - No Background with Animation */}
              <div className={`w-full transition-all duration-700 ease-out ${
                showGraph ? 'animate-fade-in-up opacity-100' : 'opacity-0 translate-y-8'
              }`}>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart 
                    data={earthquakeData} 
                    margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                    <XAxis 
                      dataKey="year" 
                      stroke="#94a3b8"
                      fontSize={12}
                      axisLine={{ stroke: '#94a3b8' }}
                      tickLine={{ stroke: '#94a3b8' }}
                    />
                    <YAxis 
                      stroke="#94a3b8"
                      fontSize={12}
                      axisLine={{ stroke: '#94a3b8' }}
                      tickLine={{ stroke: '#94a3b8' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1e293b', 
                        border: '1px solid #334155', 
                        borderRadius: '8px',
                        color: '#e2e8f0',
                        fontSize: '12px'
                      }}
                      formatter={(value: number, name: string) => {
                        if (name === 'infrastructureLoss') return [`${value.toLocaleString()} houses`, 'Infrastructure Loss'];
                        if (name === 'fatalities') return [`${value.toLocaleString()} deaths`, 'Fatalities'];
                        return [value, name];
                      }}
                    />
                    <Legend 
                      wrapperStyle={{
                        fontSize: '12px',
                        color: '#94a3b8',
                        marginTop: '10px'
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="infrastructureLoss" 
                      stroke="#EBD3CA" 
                      strokeWidth={3}
                      name="Infrastructure Loss (Houses)" 
                      dot={{ fill: '#EBD3CA', strokeWidth: 2, r: 4 }}
                      activeDot={{ r: 6, fill: '#EBD3CA' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="fatalities" 
                      stroke="#dc2626" 
                      strokeWidth={3}
                      name="Fatalities (Death Count)" 
                      dot={{ fill: '#dc2626', strokeWidth: 2, r: 4 }}
                      activeDot={{ r: 6, fill: '#dc2626' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                
                {/* Graph Caption Below Graph with Animation */}
                <div className={`mt-4 text-center transition-all duration-700 ease-out ${
                  showGraphCaption ? 'animate-fade-in-up opacity-100' : 'opacity-0 translate-y-8'
                }`}>
                  <p className="text-sm text-[#94a3b8]">
                    Historical earthquake data showing infrastructure loss and human impact
                  </p>
                </div>
              </div>
            </div>

            {/* Right Side - Impact Image - Larger and No Background */}
            <div className="flex-1 flex items-center justify-end">
              <div className={`transition-all duration-1000 ease-out ml-12 ${
                showImpactImage ? 'animate-fade-in-scale' : 'opacity-0 scale-90'
              }`}>
                <img
                  src="/videos/impact.png"
                  alt="Seismic Impact Visualization"
                  className="max-w-full h-auto animate-float"
                  style={{ 
                    maxHeight: '500px',
                    objectFit: 'contain'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Section */}
      <div 
        id="navigation-section" 
        ref={navigationSectionRef}
        className="min-h-screen bg-[#0f172a] flex items-center justify-center py-20 relative"
      >
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-50"
          style={{ backgroundImage: "url('/videos/soilbackground.jpg')" }}
        ></div>
        
        <div className="absolute inset-0 bg-[#0f172a]/18"></div>
        
        <div className="max-w-6xl mx-auto px-8 w-full relative z-10">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white tracking-tight mb-8">
              Shared Insights, Safer Structures
            </h2>
            
            <p className="text-xl text-white font-light tracking-wide max-w-3xl mx-auto mb-16">
              Insights for ground analytics and risk assessment
            </p>
          </div>
          
          <div className={`grid grid-cols-1 md:grid-cols-2 ${getGridColumns()} gap-8 max-w-5xl mx-auto`}>
            {navigationButtons.map((button) => {
              const IconComponent = button.icon;
              return (
                <button
                  key={button.id}
                  className={`relative group bg-white/5 backdrop-blur-lg rounded-3xl p-8 border-2 border-white/60 hover:border-white transition-all duration-500 hover:scale-105 hover:shadow-2xl hover:shadow-white/40 text-left min-h-[220px] w-full ${
                    activeButton === button.id ? 'opacity-70 scale-95' : 'opacity-100'
                  }`}
                  onClick={() => handleButtonClick(button.id, button.onClick)}
                >
                  <div className="absolute inset-0 rounded-3xl bg-white opacity-0 group-hover:opacity-20 transition-all duration-500 blur-lg"></div>
                  
                  <div className="relative z-10 h-full flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 bg-white/30 rounded-2xl border border-white/50 group-hover:bg-white/40 group-hover:border-white transition-all duration-300">
                          <IconComponent className="w-8 h-8 text-white group-hover:scale-110 transition-transform duration-300" />
                        </div>
                      </div>
                      <h3 className="text-white text-xl font-bold mb-4 leading-tight group-hover:text-white transition-colors duration-300">
                        {button.label}
                      </h3>
                    </div>
                    <p className="text-white text-base leading-relaxed group-hover:opacity-100 transition-opacity duration-300">
                      {button.subtext}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* What We Do Section */}
      <div 
        id="what-we-do-section" 
        ref={whatWeDoSectionRef}
        className="min-h-screen relative overflow-hidden bg-gradient-to-br from-[#0a0f1c] to-[#0f172a] flex flex-col"
      >
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyMzUsIDIxMSwgMjAyLCAwLjA1KSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-20"></div>
        
        <div className="relative w-full flex-1 flex items-center z-10">
          <div className="max-w-7xl mx-auto px-8 w-full">
            <div className="grid md:grid-cols-2 gap-16 items-start">
              <div className={`text-white space-y-6 transition-all duration-1000 ${
                showVisionText ? 'animate-slide-left' : 'opacity-0 translate-x-20'
              }`}>
                <div className="space-y-2">
                  <h2 className="text-4xl md:text-5xl font-bold">VISION</h2>
                  <div className="w-20 h-1 bg-gradient-to-r from-[#EBD3CA] to-transparent"></div>
                </div>
                <p className="text-xl md:text-2xl text-[#EBD3CA] font-light leading-relaxed">
                  A world where every structure stands resilient against seismic forces, built on the certainty of predictive ground intelligence.
                </p>
              </div>
              
              <div className={`text-white space-y-6 transition-all duration-1000 ${
                showMissionText ? 'animate-slide-right' : 'opacity-0 -translate-x-20'
              }`}>
                <div className="space-y-2">
                  <h2 className="text-4xl md:text-5xl font-bold">MISSION</h2>
                  <div className="w-20 h-1 bg-gradient-to-r from-[#EBD3CA] to-transparent"></div>
                </div>
                <p className="text-xl md:text-2xl text-[#EBD3CA] font-light leading-relaxed">
                  To empower engineers and developers with predictive ground analytics that transform seismic risks into optimized, safe, and cost-effective building solutions.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-0 w-full mt-auto">
          <div className={`w-full transition-all duration-800 ease-out ${
            showSkyline ? 'animate-float opacity-100' : 'opacity-0 translate-y-50'
          }`}>
            <img
              src="/videos/skylineformission.png"
              alt="Skyline mission"
              className="w-full h-auto object-cover "
              style={{ 
                maxHeight: '80vh',
                objectPosition: 'center bottom',
                width: '100%'
              }}
            />
          </div>
          
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1c] via-[#0a0f1c]/80 to-transparent pointer-events-none"></div>
        </div>
      </div>

      {/* Combined About Us & Footer Section */}
      <div 
        id="about-us-section" 
        ref={aboutUsSectionRef}
        className="min-h-screen bg-[#0a0f1c] flex flex-col relative transition-all duration-1000"
      >
        <div 
          className={`absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-1000 ${
            showAboutUs ? 'opacity-38 translate-y-0' : 'opacity-38 translate-y-10'
          }`}
          style={{ backgroundImage: "url('/videos/aboutus.jpeg')" }}
        ></div>
        
        <div className={`absolute inset-0 bg-[#0a0f1c]/70 transition-all duration-1000 ${
          showAboutUs ? 'opacity-100' : 'opacity-70'
        }`}></div>

        <div className="flex-1 flex items-center py-12 relative z-10">
          <div className={`max-w-7xl mx-auto px-8 w-full transition-all duration-1000 ${
            showAboutUs ? 'animate-slide-up' : 'opacity-0'
          }`}>
            <div className="grid md:grid-cols-2 gap-16 items-start">
              <div>
                <h2 className="text-5xl font-bold mb-8 text-white">ABOUT US</h2>
                <div className="space-y-4 text-[#e2e8f0] text-lg">
                  <p>Tel: 123-456-789</p>
                  <p>Email: info@geonexus.ai</p>
                  <p>Social: @geonexus</p>
                </div>
                <p className="mt-12 text-[#94a3b8] text-sm">
                  Our office is wheelchair-accessible.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#0f172a] py-12 border-t border-[#334155] relative z-10">
          <div className="max-w-7xl mx-auto px-8 text-center">
            <p className="text-[#94a3b8] text-sm">© 2024 GeoNexus AI. All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
