import { useState } from 'react';
import { Shield, Download, CheckCircle, XCircle, Clock, FileText, AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

interface PendingProject {
  id: string;
  name: string;
  engineer: string;
  submittedDate: string;
  priority: 'high' | 'medium' | 'low';
  riskLevel: 'high' | 'medium' | 'low';
  filesCount: number;
  aiScore: number;
}

export function AuthorityDashboard() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const pendingProjects: PendingProject[] = [
    {
      id: '1',
      name: 'Residential Tower A',
      engineer: 'Sarah Chen',
      submittedDate: '2024-11-10',
      priority: 'high',
      riskLevel: 'medium',
      filesCount: 8,
      aiScore: 87
    },
    {
      id: '2',
      name: 'Bridge Infrastructure',
      engineer: 'Michael Torres',
      submittedDate: '2024-11-11',
      priority: 'high',
      riskLevel: 'high',
      filesCount: 12,
      aiScore: 65
    },
    {
      id: '3',
      name: 'Shopping Mall Extension',
      engineer: 'Emily Wang',
      submittedDate: '2024-11-09',
      priority: 'medium',
      riskLevel: 'low',
      filesCount: 5,
      aiScore: 92
    },
    {
      id: '4',
      name: 'Hospital Wing B',
      engineer: 'David Kim',
      submittedDate: '2024-11-08',
      priority: 'high',
      riskLevel: 'medium',
      filesCount: 15,
      aiScore: 78
    },
  ];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-500/10 text-red-500 border-red-500/30';
      case 'medium': return 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30';
      case 'low': return 'bg-gray-500/10 text-gray-500 border-gray-500/30';
      default: return 'bg-gray-500/10 text-gray-500 border-gray-500/30';
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      case 'low': return '#10b981';
      default: return '#64748b';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-[#f59e0b]';
    return 'text-red-500';
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-8 h-8 text-[#0d9488]" />
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Authority Portal</h1>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">Review and approve geotechnical project submissions</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - Approval Queue */}
          <div className="lg:col-span-2 space-y-6">
            {/* Queue Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <Clock className="w-8 h-8 text-[#f59e0b]" />
                  <div>
                    <div className="text-2xl font-semibold text-foreground">{pendingProjects.length}</div>
                    <div className="text-xs text-muted-foreground">Pending Review</div>
                  </div>
                </div>
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                  <div>
                    <div className="text-2xl font-semibold text-foreground">23</div>
                    <div className="text-xs text-muted-foreground">Approved Today</div>
                  </div>
                </div>
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-8 h-8 text-red-500" />
                  <div>
                    <div className="text-2xl font-semibold text-foreground">2</div>
                    <div className="text-xs text-muted-foreground">High Priority</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Approval Queue Table */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-6 border-b border-border">
                <h2 className="text-lg sm:text-xl font-semibold text-foreground">Approval Queue</h2>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left p-4 text-xs uppercase tracking-wider text-muted-foreground">Project</th>
                      <th className="text-left p-4 text-xs uppercase tracking-wider text-muted-foreground">Engineer</th>
                      <th className="text-left p-4 text-xs uppercase tracking-wider text-muted-foreground">Priority</th>
                      <th className="text-left p-4 text-xs uppercase tracking-wider text-muted-foreground">Risk</th>
                      <th className="text-left p-4 text-xs uppercase tracking-wider text-muted-foreground">AI Score</th>
                      <th className="text-left p-4 text-xs uppercase tracking-wider text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pendingProjects.map((project) => (
                      <tr 
                        key={project.id}
                        className={`hover:bg-muted/40 transition-colors cursor-pointer ${
                          selectedProject === project.id ? 'bg-muted/30' : ''
                        }`}
                        onClick={() => setSelectedProject(project.id)}
                      >
                        <td className="p-4">
                          <div>
                            <div className="text-foreground font-medium">{project.name}</div>
                            <div className="text-xs text-muted-foreground">{project.filesCount} files • {project.submittedDate}</div>
                          </div>
                        </td>
                        <td className="p-4 text-muted-foreground">{project.engineer}</td>
                        <td className="p-4">
                          <Badge className={`${getPriorityColor(project.priority)} border`}>
                            {project.priority.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: getRiskColor(project.riskLevel) }}
                            />
                            <span className="text-muted-foreground capitalize">{project.riskLevel}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-300 rounded-full overflow-hidden max-w-[80px]">
                              <div 
                                className="h-full"
                                style={{ 
                                  width: `${project.aiScore}%`,
                                  backgroundColor: project.aiScore >= 80 ? '#10b981' : project.aiScore >= 60 ? '#f59e0b' : '#ef4444'
                                }}
                              />
                            </div>
                            <span className={`text-sm ${getScoreColor(project.aiScore)}`}>
                              {project.aiScore}
                            </span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              className="bg-green-600 hover:bg-green-700 text-white"
                              onClick={(e) => {
                                e.stopPropagation();
                                alert(`Approved: ${project.name}`);
                              }}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                alert(`Rejected: ${project.name}`);
                              }}
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected Project Details */}
            {selectedProject && (
              <div className="bg-white border border-gray-300 rounded-lg p-6">
                <h3 className="text-xl text-gray-900 mb-4">Project Details</h3>
                {(() => {
                  const project = pendingProjects.find(p => p.id === selectedProject);
                  if (!project) return null;
                  
                  return (
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Project Name</div>
                          <div className="text-gray-900">{project.name}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Submitted By</div>
                          <div className="text-gray-900">{project.engineer}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Submission Date</div>
                          <div className="text-gray-900">{project.submittedDate}</div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs text-gray-600 mb-1">AI Compliance Score</div>
                          <div className={`text-xl ${getScoreColor(project.aiScore)}`}>{project.aiScore}/100</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600 mb-1">Attached Files</div>
                          <div className="text-gray-900">{project.filesCount} documents</div>
                        </div>
                        <div className="pt-2">
                          <Button className="w-full bg-[#0d9488] hover:bg-[#0d9488]/90 text-white">
                            <Download className="w-4 h-4 mr-2" />
                            Download All Files
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Report Generation */}
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-[#0d9488]" />
                <h3 className="font-semibold text-foreground">Generate Reports</h3>
              </div>
              <div className="space-y-2">
                <Button className="w-full bg-slate-800 hover:bg-slate-700 text-white justify-start" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Daily Summary
                </Button>
                <Button className="w-full bg-slate-800 hover:bg-slate-700 text-white justify-start" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Weekly Report
                </Button>
                <Button className="w-full bg-slate-800 hover:bg-slate-700 text-white justify-start" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Compliance Audit
                </Button>
                <Button className="w-full bg-slate-800 hover:bg-slate-700 text-white justify-start" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Risk Assessment
                </Button>
              </div>
            </div>

            {/* Review Timeline */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm uppercase tracking-wider text-[#0d9488] mb-4">Review Timeline</h3>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <div className="w-0.5 h-full bg-slate-700 mt-1" />
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="text-sm text-foreground">Approved 3 projects</div>
                    <div className="text-xs text-muted-foreground">Today, 2:30 PM</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                    <div className="w-0.5 h-full bg-slate-700 mt-1" />
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="text-sm text-foreground">Requested revisions</div>
                    <div className="text-xs text-muted-foreground">Today, 11:15 AM</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <div className="w-0.5 h-full bg-slate-700 mt-1" />
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="text-sm text-foreground">Rejected 1 project</div>
                    <div className="text-xs text-muted-foreground">Yesterday, 4:45 PM</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-[#0d9488]" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-white">Reviewed documentation</div>
                    <div className="text-xs text-slate-400">Yesterday, 10:00 AM</div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Insights */}
            <div className="bg-slate-900 border border-slate-700/50 rounded-lg p-6">
              <h3 className="text-sm uppercase tracking-wider text-[#0d9488] mb-4">AI Insights</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <div className="text-white">2 projects flagged</div>
                    <div className="text-xs text-slate-400">High seismic risk areas</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5" />
                  <div>
                    <div className="text-white">4 auto-approved</div>
                    <div className="text-xs text-slate-400">Score above 90</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Clock className="w-4 h-4 text-[#f59e0b] mt-0.5" />
                  <div>
                    <div className="text-white">Avg review time</div>
                    <div className="text-xs text-slate-400">2.5 days</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
