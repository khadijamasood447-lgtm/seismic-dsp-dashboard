import { useState } from 'react';
import { Upload, FileText, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Progress } from './ui/progress';

interface Project {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected' | 'under_review';
  submittedDate: string;
  reviewDate?: string;
  progress: number;
}

export function EngineerDashboard() {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const projects: Project[] = [
    {
      id: '1',
      name: 'Downtown Office Complex',
      status: 'approved',
      submittedDate: '2024-11-05',
      reviewDate: '2024-11-08',
      progress: 100
    },
    {
      id: '2',
      name: 'Residential Tower A',
      status: 'under_review',
      submittedDate: '2024-11-10',
      progress: 65
    },
    {
      id: '3',
      name: 'Bridge Infrastructure',
      status: 'pending',
      submittedDate: '2024-11-11',
      progress: 0
    },
  ];

  const handleFileUpload = () => {
    setIsUploading(true);
    setUploadProgress(0);
    
    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsUploading(false);
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'rejected':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'under_review':
        return <Clock className="w-5 h-5 text-[#f59e0b]" />;
      default:
        return <AlertCircle className="w-5 h-5 text-slate-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-500/10 text-green-500 border-green-500/30';
      case 'rejected':
        return 'bg-red-500/10 text-red-500 border-red-500/30';
      case 'under_review':
        return 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30';
      default:
        return 'bg-gray-500/10 text-gray-500 border-gray-500/30';
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-2">Engineer Portal</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Submit and track your geotechnical project submissions</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Upload Section */}
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <Upload className="w-5 h-5 text-[#0d9488]" />
                <h2 className="text-lg sm:text-xl font-semibold text-foreground">Upload Project Files</h2>
              </div>

              {/* Upload Zone */}
              <div className="border-2 border-dashed border-border rounded-lg p-8 sm:p-12 text-center hover:border-primary transition-colors cursor-pointer bg-background/20">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-foreground mb-2">Drop IFC files here or click to browse</p>
                <p className="text-sm text-muted-foreground mb-4">Supports .ifc, .dwg, .pdf (Max 500MB)</p>
                <Button 
                  className="bg-[#0d9488] hover:bg-[#0d9488]/90 text-white"
                  onClick={handleFileUpload}
                  disabled={isUploading}
                >
                  {isUploading ? 'Uploading...' : 'Select Files'}
                </Button>
              </div>

              {/* Upload Progress */}
              {isUploading && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Uploading project_model.ifc</span>
                    <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}
            </div>

            {/* Projects Timeline */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-6">Project Submissions</h2>
              
              <div className="space-y-4">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="bg-muted/30 border border-border rounded-lg p-4 hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-start gap-3 flex-1">
                        {getStatusIcon(project.status)}
                        <div className="flex-1">
                          <h3 className="text-foreground mb-1 font-medium">{project.name}</h3>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>Submitted: {project.submittedDate}</span>
                            {project.reviewDate && (
                              <span>• Reviewed: {project.reviewDate}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs border ${getStatusColor(project.status)}`}>
                        {project.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </div>

                    {project.status === 'under_review' && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-gray-600">Review Progress</span>
                          <span className="text-xs text-gray-600">{project.progress}%</span>
                        </div>
                        <Progress value={project.progress} className="h-1.5" />
                      </div>
                    )}

                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" className="border-gray-300 text-gray-900 hover:bg-gray-100">
                        View Details
                      </Button>
                      <Button size="sm" variant="outline" className="border-gray-300 text-gray-900 hover:bg-gray-100">
                        Download Files
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm uppercase tracking-wider text-[#0d9488] mb-4">Statistics</h3>
              <div className="space-y-4">
                <div>
                  <div className="text-2xl font-semibold text-foreground">12</div>
                  <div className="text-xs text-muted-foreground">Total Projects</div>
                </div>
                <div>
                  <div className="text-2xl text-green-500">8</div>
                  <div className="text-xs text-muted-foreground">Approved</div>
                </div>
                <div>
                  <div className="text-2xl text-[#f59e0b]">3</div>
                  <div className="text-xs text-muted-foreground">Under Review</div>
                </div>
                <div>
                  <div className="text-2xl text-slate-500">1</div>
                  <div className="text-xs text-muted-foreground">Pending</div>
                </div>
              </div>
            </div>

            {/* Submission Guidelines */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm uppercase tracking-wider text-[#0d9488] mb-4">Submission Guidelines</h3>
              <div className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#0d9488] mt-2" />
                  <span>All IFC files must be BIM Level 2 compliant</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#0d9488] mt-2" />
                  <span>Include geotechnical survey reports</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#0d9488] mt-2" />
                  <span>Soil analysis data required for all projects</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#0d9488] mt-2" />
                  <span>Review typically takes 3-5 business days</span>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm uppercase tracking-wider text-[#0d9488] mb-4">Recent Activity</h3>
              <div className="space-y-3">
                <div className="text-sm">
                  <div className="text-foreground">Project approved</div>
                  <div className="text-xs text-muted-foreground">2 hours ago</div>
                </div>
                <div className="text-sm">
                  <div className="text-foreground">Files uploaded</div>
                  <div className="text-xs text-muted-foreground">1 day ago</div>
                </div>
                <div className="text-sm">
                  <div className="text-foreground">Review started</div>
                  <div className="text-xs text-muted-foreground">3 days ago</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
