"use client"

import type React from "react"

import { useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { ArrowRight, Shield } from "lucide-react"

export function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { login } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await login(email, password)
    } catch (error) {
      console.error("Login failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 right-1/3 w-96 h-96 bg-accent/20 rounded-full blur-3xl animate-float-up"></div>
        <div
          className="absolute bottom-1/3 left-1/4 w-80 h-80 bg-primary/20 rounded-full blur-3xl"
          style={{ animationDelay: "1s" }}
        ></div>
        <div className="absolute top-1/2 right-1/4 w-72 h-72 bg-accent/10 rounded-full blur-3xl animate-pulse"></div>
      </div>

      <Card className="w-full max-w-md p-8 shadow-2xl border border-accent/20 relative z-10 animate-fade-in-up glass-effect">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-accent to-accent/60 rounded-xl flex items-center justify-center shadow-lg shadow-accent/30 animate-glow-pulse">
              <Shield className="w-6 h-6 text-accent-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold gradient-text">SeismicDSP</h1>
              <p className="text-xs text-accent font-bold uppercase tracking-widest">Authority Platform</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground font-medium leading-relaxed">
            BIM-GIS Integrated Seismic Decision Support
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-foreground mb-2 uppercase tracking-wide">
              Email Address
            </label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-input border-accent/20 text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-accent/60 focus:border-accent transition-all"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-foreground mb-2 uppercase tracking-wide">Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-input border-accent/20 text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-accent/60 focus:border-accent transition-all"
              required
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-accent to-accent/80 hover:from-accent hover:to-accent text-accent-foreground font-bold h-11 rounded-lg transition-all duration-300 flex items-center justify-center gap-2 group shadow-lg shadow-accent/30 hover:shadow-xl hover:shadow-accent/40"
            disabled={isLoading}
          >
            {isLoading ? "Signing in..." : "Sign In"}
            {!isLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
          </Button>
        </form>

        <div className="mt-8 pt-6 border-t border-accent/10">
          <p className="text-xs font-bold text-accent text-center mb-4 uppercase tracking-widest">Demo Credentials</p>
          <div className="space-y-2 text-xs">
            {[
              { role: "Admin", email: "admin@seismic.com" },
              { role: "Engineer", email: "engineer@seismic.com" },
              { role: "Viewer", email: "viewer@seismic.com" },
            ].map((cred) => (
              <div
                key={cred.email}
                className="bg-accent/5 hover:bg-accent/10 p-3 rounded-lg transition-all cursor-pointer group border border-accent/10 hover:border-accent/30"
              >
                <p className="font-bold text-foreground">{cred.role}</p>
                <p className="text-muted-foreground font-mono text-xs">{cred.email}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
