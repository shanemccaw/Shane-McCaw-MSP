import React, { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Trash2, ArrowRight, ChevronsUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface MonitorCheck {
  key: string;
  label: string;
  properties: string[];
  filterParams?: string | null;
  endpoint?: string;
}

interface BaselineTemplate {
  templateId: string;
  label: string;
  requiredVariables: string[];
  endpoint?: string;
}

interface WizardStep {
  id: string;
  type: "monitor" | "template";
  checkKey: string | null;
  templateId: string | null;
  parameterMapping: Record<string, string>;
}

export function ConfigPackWizardDialog({
  open,
  onOpenChange,
  fetchWithAuth,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onComplete: () => void;
}) {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);

  // Pack Details
  const [packKey, setPackKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  // Pipeline Details
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [monitorChecks, setMonitorChecks] = useState<MonitorCheck[]>([]);
  const [templates, setTemplates] = useState<BaselineTemplate[]>([]);

  // Inline Template Creation
  const [showTemplateCreate, setShowTemplateCreate] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    templateId: "", label: "", endpoint: "", method: "POST", bodyTemplate: "{}"
  });

  useEffect(() => {
    if (open) {
      setCurrentStep(1);
      setPackKey(""); setLabel(""); setDescription(""); setSteps([]);
      setShowTemplateCreate(false);
      void fetchDependencies();
    }
  }, [open]);

  const fetchDependencies = async () => {
    try {
      const [mcRes, tplRes] = await Promise.all([
        fetchWithAuth("/api/admin/monitor-checks"),
        fetchWithAuth("/api/admin/baseline-templates"),
      ]);
      const mcData = await mcRes.json();
      const tplData = await tplRes.json();
      setMonitorChecks(mcData.checks || []);
      setTemplates(tplData.templates || []);
    } catch {
      toast({ title: "Failed to load dependencies", variant: "destructive" });
    }
  };

  const addStep = (type: "monitor" | "template") => {
    setSteps([...steps, { id: Date.now().toString(), type, checkKey: null, templateId: null, parameterMapping: {} }]);
  };

  const updateStep = (id: string, updates: Partial<WizardStep>) => {
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  const removeStep = (id: string) => {
    setSteps(steps.filter((s) => s.id !== id));
  };

  const getAvailableProperties = (stepIndex: number) => {
    const props: string[] = [];
    for (let i = 0; i < stepIndex; i++) {
      if (steps[i].type === "monitor" && steps[i].checkKey) {
        const check = monitorChecks.find(c => c.key === steps[i].checkKey);
        if (check?.properties) props.push(...check.properties);
      }
    }
    return Array.from(new Set(props));
  };

  const handleCreateTemplate = async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth("/api/admin/baseline-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newTemplate,
          category: "Wizard Generated",
          bodyTemplate: JSON.parse(newTemplate.bodyTemplate),
          successCriteria: {},
          requiresVerificationGate: false,
          dependsOn: []
        })
      });
      if (!res.ok) throw new Error("Failed to create template");
      toast({ title: "Template created successfully!" });
      setShowTemplateCreate(false);
      await fetchDependencies();
    } catch (e) {
      toast({ title: "Template creation failed. Verify JSON.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSavePack = async () => {
    if (!packKey || !label) {
      toast({ title: "Pack key and label are required", variant: "destructive" });
      return;
    }
    try {
      setLoading(true);
      // 1. Create Pack
      const packRes = await fetchWithAuth("/api/admin/config-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packKey, label, description, categories: [] })
      });
      if (!packRes.ok) throw new Error("Failed to create pack");

      // 2. Set Steps Order
      const templatesOrder = steps.map((s, index) => ({
        templateId: s.type === "template" ? s.templateId : null,
        checkKey: s.type === "monitor" ? s.checkKey : null,
        parameterMapping: s.parameterMapping,
        sortOrder: index,
        dependsOnOverride: null,
      }));

      const orderRes = await fetchWithAuth(`/api/admin/config-packs/${packKey}/templates/order`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: templatesOrder })
      });

      if (!orderRes.ok) throw new Error("Failed to map pipeline steps");

      toast({ title: "Config Pack Pipeline created successfully!" });
      onOpenChange(false);
      onComplete();
    } catch (e) {
      toast({ title: "Failed to create config pack", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-border bg-card text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Config Pack Pipeline Wizard</DialogTitle>
          <DialogDescription>Build a sequence of monitor checks and templates.</DialogDescription>
        </DialogHeader>

        {currentStep === 1 && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Pack Key (Unique Identifier)</Label>
              <Input value={packKey} onChange={(e) => setPackKey(e.target.value)} placeholder="e.g. security-baseline-v1" className="bg-background border-border" />
            </div>
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Security Baseline V1" className="bg-background border-border" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this pack do?" className="bg-background border-border h-24" />
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-6 py-4">
            {steps.map((step, index) => {
              const availableProps = getAvailableProperties(index);
              
              return (
                <div key={step.id} className="p-4 border border-border rounded-lg bg-background/50 relative">
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-semibold text-primary flex items-center gap-2">
                      <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">{index + 1}</span>
                      {step.type === "monitor" ? "Gather Data (Monitor Check)" : "Apply Change (Template)"}
                    </span>
                    <Button variant="ghost" size="icon" onClick={() => removeStep(step.id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {step.type === "monitor" && (
                    <div className="space-y-3">
                      <Label>Select Monitor Check</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" role="combobox" className="w-full justify-between bg-background border-border">
                            {step.checkKey
                              ? monitorChecks.find((mc) => mc.key === step.checkKey)?.label
                              : "Select a check..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0 bg-background border-border">
                          <Command>
                            <CommandInput placeholder="Search checks or endpoints..." className="text-white" />
                            <CommandList>
                              <CommandEmpty>No checks found.</CommandEmpty>
                              <CommandGroup>
                                {monitorChecks.map((mc) => (
                                  <CommandItem
                                    key={mc.key}
                                    value={`${mc.label} ${mc.key} ${mc.endpoint ?? ""}`}
                                    onSelect={() => updateStep(step.id, { checkKey: mc.key })}
                                  >
                                    <Check className={cn("mr-2 h-4 w-4", step.checkKey === mc.key ? "opacity-100" : "opacity-0")} />
                                    <div className="flex flex-col">
                                      <span>{mc.label}</span>
                                      {mc.endpoint && <span className="text-xs text-muted-foreground font-mono">{mc.endpoint}</span>}
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}

                  {step.type === "template" && (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <Label>Select Baseline Template</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="w-full justify-between bg-background border-border">
                              {step.templateId
                                ? templates.find((tpl) => tpl.templateId === step.templateId)?.label
                                : "Select a template..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[400px] p-0 bg-background border-border">
                            <Command>
                              <CommandInput placeholder="Search templates or endpoints..." className="text-white" />
                              <CommandList>
                                <CommandEmpty>No templates found.</CommandEmpty>
                                <CommandGroup>
                                  {templates.map((tpl) => (
                                    <CommandItem
                                      key={tpl.templateId}
                                      value={`${tpl.label} ${tpl.templateId} ${tpl.endpoint ?? ""}`}
                                      onSelect={() => updateStep(step.id, { templateId: tpl.templateId })}
                                    >
                                      <Check className={cn("mr-2 h-4 w-4", step.templateId === tpl.templateId ? "opacity-100" : "opacity-0")} />
                                      <div className="flex flex-col">
                                        <span>{tpl.label}</span>
                                        <span className="text-xs text-muted-foreground font-mono">{tpl.templateId} {tpl.endpoint ? `· ${tpl.endpoint}` : ""}</span>
                                      </div>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        <div className="text-right">
                          <Button variant="link" size="sm" onClick={() => setShowTemplateCreate(true)} className="text-primary p-0 h-auto">
                            + Create New Template
                          </Button>
                        </div>
                      </div>

                      {step.templateId && (
                        <div className="space-y-2 mt-4 pt-4 border-t border-border">
                          <Label className="text-sm font-semibold text-gray-300 mb-2 block">Parameter Mapping (Required by Template)</Label>
                          {templates.find((t) => t.templateId === step.templateId)?.requiredVariables.map((rv) => (
                            <div key={rv} className="flex items-center gap-3">
                              <span className="font-mono text-xs w-1/3 text-gray-400">{rv}</span>
                              <ArrowRight className="w-4 h-4 text-gray-600" />
                              <Select
                                value={step.parameterMapping[rv] || ""}
                                onValueChange={(v) => updateStep(step.id, { parameterMapping: { ...step.parameterMapping, [rv]: v } })}
                              >
                                <SelectTrigger className="bg-background border-border flex-1 h-8 text-xs">
                                  <SelectValue placeholder="Map to..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableProps.map((p) => (
                                    <SelectItem key={p} value={p}>{p}</SelectItem>
                                  ))}
                                  {availableProps.length === 0 && <SelectItem value="_none" disabled>No upstream properties available</SelectItem>}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="flex gap-2 justify-center pt-4 border-t border-border border-dashed mt-6">
              <Button variant="outline" onClick={() => addStep("monitor")} className="bg-background border-border hover:bg-white/5">
                + Gather Data Step
              </Button>
              <Button variant="outline" onClick={() => addStep("template")} className="bg-background border-border hover:bg-white/5">
                + Apply Change Step
              </Button>
            </div>
          </div>
        )}

        {showTemplateCreate && (
          <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
            <div className="bg-card border border-border p-6 rounded-lg w-full max-w-lg space-y-4">
              <h3 className="text-lg font-semibold text-white">Create Inline Template</h3>
              <div className="space-y-3">
                <div><Label>Template ID</Label><Input value={newTemplate.templateId} onChange={e => setNewTemplate({...newTemplate, templateId: e.target.value})} className="bg-background" /></div>
                <div><Label>Label</Label><Input value={newTemplate.label} onChange={e => setNewTemplate({...newTemplate, label: e.target.value})} className="bg-background" /></div>
                <div className="flex gap-2">
                  <div className="w-1/3">
                    <Label>Method</Label>
                    <Select value={newTemplate.method} onValueChange={v => setNewTemplate({...newTemplate, method: v})}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["POST", "PATCH", "PUT", "DELETE"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1"><Label>Endpoint</Label><Input value={newTemplate.endpoint} onChange={e => setNewTemplate({...newTemplate, endpoint: e.target.value})} className="bg-background" /></div>
                </div>
                <div><Label>Body (JSON)</Label><Textarea value={newTemplate.bodyTemplate} onChange={e => setNewTemplate({...newTemplate, bodyTemplate: e.target.value})} className="bg-background font-mono text-sm h-32" /></div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="ghost" onClick={() => setShowTemplateCreate(false)}>Cancel</Button>
                <Button onClick={handleCreateTemplate} disabled={loading} className="bg-primary text-white">Create Template</Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {currentStep === 1 ? (
            <Button onClick={() => setCurrentStep(2)} disabled={!packKey || !label} className="bg-primary text-white">Next: Build Pipeline</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setCurrentStep(1)}>Back</Button>
              <Button onClick={handleSavePack} disabled={loading} className="bg-primary text-white">Save Pipeline</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
