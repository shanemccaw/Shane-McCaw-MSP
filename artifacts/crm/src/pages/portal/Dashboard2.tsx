import { useState } from "react";
import PortalLayout from "@/components/PortalLayout";

type ServiceTab = "m365" | "security" | "migration";

function StepCompleted({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 relative z-10 w-[12.5%]">
      <div className="w-10 h-10 rounded-full bg-[#0c9488] text-white flex items-center justify-center shadow-md">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check</span>
      </div>
      <span className="text-[10px] text-center uppercase tracking-tighter d2-step-completed font-semibold">{label}</span>
    </div>
  );
}

function StepActive({ num, label }: { num: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 relative z-10 w-[12.5%]">
      <div className="w-10 h-10 rounded-full bg-white border-4 border-[#0c9488] text-[#0c9488] flex items-center justify-center shadow-lg ring-4 ring-[#89f5e7]">
        <span className="font-bold text-[14px]">{num}</span>
      </div>
      <span className="text-[10px] text-center uppercase tracking-tighter d2-step-active">{label}</span>
    </div>
  );
}

function StepPending({ num, label }: { num: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 relative z-10 w-[12.5%]">
      <div className="w-10 h-10 rounded-full bg-[#f2f4f6] border-2 border-[#c6c6cd] text-[#76777d] flex items-center justify-center">
        <span className="font-bold text-[14px]">{num}</span>
      </div>
      <span className="text-[10px] text-center uppercase tracking-tighter d2-step-pending font-semibold">{label}</span>
    </div>
  );
}

function M365Tracker() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#89f5e7] rounded text-[#005049]">
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>health_and_safety</span>
          </div>
          <div>
            <h3 className="text-2xl font-semibold text-[#191c1e]">M365 Health Check: Delivery Workflow</h3>
            <p className="text-[#45464d] text-sm">Currently at Stage 5: Assessments</p>
          </div>
        </div>
        <span className="px-3 py-1 bg-[#0c9488] text-white rounded-full text-[10px] uppercase font-semibold tracking-wider">Active Engagement</span>
      </div>
      <div className="bg-white p-8 rounded-xl border border-[#c6c6cd] d2-card-elevation overflow-hidden">
        <div className="relative flex justify-between">
          <div className="absolute top-5 left-0 w-full h-[2px] bg-[#c6c6cd] -z-0"></div>
          <div className="absolute top-5 left-0 h-[2px] bg-[#0c9488] -z-0 transition-all duration-1000" style={{ width: "57%" }}></div>
          <StepCompleted label="1. Access" />
          <StepCompleted label="2. Schedule" />
          <StepCompleted label="3. Execute" />
          <StepCompleted label="4. Review" />
          <StepActive num={5} label="5. Assessments" />
          <StepPending num={6} label="6. Report" />
          <StepPending num={7} label="7. Debrief" />
          <StepPending num={8} label="8. End" />
        </div>
      </div>
    </div>
  );
}

function SecurityTracker() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#d0e1fb] rounded text-[#54647a]">
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>security</span>
          </div>
          <div>
            <h3 className="text-2xl font-semibold text-[#191c1e]">Security Audit: Progress Tracker</h3>
            <p className="text-[#45464d] text-sm">Currently at Stage 2: Scope Definition</p>
          </div>
        </div>
        <span className="px-3 py-1 bg-[#e6e8ea] text-[#45464d] rounded-full text-[10px] uppercase font-semibold tracking-wider">Queued</span>
      </div>
      <div className="bg-white p-8 rounded-xl border border-[#c6c6cd] d2-card-elevation overflow-hidden">
        <div className="relative flex justify-between">
          <div className="absolute top-5 left-0 w-full h-[2px] bg-[#c6c6cd] -z-0"></div>
          <div className="absolute top-5 left-0 h-[2px] bg-[#54647a] -z-0 transition-all duration-1000" style={{ width: "14%" }}></div>
          <StepCompleted label="1. Intake" />
          <div className="flex flex-col items-center gap-3 relative z-10 w-[12.5%]">
            <div className="w-10 h-10 rounded-full bg-white border-4 border-[#54647a] text-[#54647a] flex items-center justify-center shadow-lg ring-4 ring-[#d0e1fb]">
              <span className="font-bold text-[14px]">2</span>
            </div>
            <span className="text-[10px] text-center uppercase tracking-tighter d2-step-active">2. Scope</span>
          </div>
          <StepPending num={3} label="3. Scan" />
          <StepPending num={4} label="4. Analyze" />
          <StepPending num={5} label="5. Validate" />
          <StepPending num={6} label="6. Findings" />
          <StepPending num={7} label="7. Strategy" />
          <StepPending num={8} label="8. Close" />
        </div>
      </div>
    </div>
  );
}

function MigrationTracker() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#131b2e] rounded text-[#7c839b]">
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>cloud_sync</span>
          </div>
          <div>
            <h3 className="text-2xl font-semibold text-[#191c1e]">Azure Migration: Project Timeline</h3>
            <p className="text-[#45464d] text-sm">Currently at Stage 1: Initial Discovery</p>
          </div>
        </div>
        <span className="px-3 py-1 bg-[#e6e8ea] text-[#45464d] rounded-full text-[10px] uppercase font-semibold tracking-wider">Planning</span>
      </div>
      <div className="bg-white p-8 rounded-xl border border-[#c6c6cd] d2-card-elevation overflow-hidden">
        <div className="relative flex justify-between">
          <div className="absolute top-5 left-0 w-full h-[2px] bg-[#c6c6cd] -z-0"></div>
          <div className="absolute top-5 left-0 h-[2px] bg-[#191c1e] -z-0 transition-all duration-1000" style={{ width: "0%" }}></div>
          <div className="flex flex-col items-center gap-3 relative z-10 w-[12.5%]">
            <div className="w-10 h-10 rounded-full bg-white border-4 border-[#191c1e] text-[#191c1e] flex items-center justify-center shadow-lg ring-4 ring-[#dae2fd]">
              <span className="font-bold text-[14px]">1</span>
            </div>
            <span className="text-[10px] text-center uppercase tracking-tighter d2-step-active">1. Discovery</span>
          </div>
          <StepPending num={2} label="2. Assessment" />
          <StepPending num={3} label="3. Pilot" />
          <StepPending num={4} label="4. Planning" />
          <StepPending num={5} label="5. Migration" />
          <StepPending num={6} label="6. Testing" />
          <StepPending num={7} label="7. Go-Live" />
          <StepPending num={8} label="8. Support" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard2() {
  const [activeTab, setActiveTab] = useState<ServiceTab>("m365");

  return (
    <PortalLayout>
      <div className="p-10 max-w-[1280px] mx-auto space-y-12">

        {/* Page Header */}
        <header className="flex items-center justify-between pb-6 border-b border-[#c6c6cd]">
          <h2 className="text-3xl font-semibold text-[#191c1e] tracking-tight">Executive Dashboard</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-[#c6c6cd]">
              <span className="material-symbols-outlined text-[#0c9488]" style={{ fontSize: 20 }}>verified_user</span>
              <span className="text-sm font-semibold text-[#191c1e]">Secure Session Active</span>
            </div>
          </div>
        </header>

        {/* Multi-Service Workflow Tracker */}
        <section>
          <div className="flex items-center border-b border-[#c6c6cd] w-full mb-4 gap-6">
            <button
              onClick={() => setActiveTab("m365")}
              className={`d2-service-tab py-4 px-2 text-[11px] uppercase tracking-widest font-semibold flex items-center gap-2${activeTab === "m365" ? " active" : ""}`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>health_and_safety</span>
              <span>M365 Health Check</span>
            </button>
            <button
              onClick={() => setActiveTab("security")}
              className={`d2-service-tab py-4 px-2 text-[11px] uppercase tracking-widest font-semibold flex items-center gap-2${activeTab === "security" ? " active" : ""}`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>security</span>
              <span>Security Audit</span>
            </button>
            <button
              onClick={() => setActiveTab("migration")}
              className={`d2-service-tab py-4 px-2 text-[11px] uppercase tracking-widest font-semibold flex items-center gap-2${activeTab === "migration" ? " active" : ""}`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>cloud_sync</span>
              <span>Cloud Migration</span>
            </button>
          </div>
          {activeTab === "m365" && <M365Tracker />}
          {activeTab === "security" && <SecurityTracker />}
          {activeTab === "migration" && <MigrationTracker />}
        </section>

        {/* Messaging Hub + Calendar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Messaging Hub */}
          <section className="lg:col-span-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-semibold text-[#191c1e]">Secure Messaging Hub</h3>
              <button className="text-[#0c9488] text-sm font-semibold flex items-center gap-1 hover:underline">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit_square</span>
                <span>New Message</span>
              </button>
            </div>
            <div className="bg-white rounded-xl border border-[#c6c6cd] overflow-hidden flex h-[450px] d2-card-elevation">
              {/* Thread list */}
              <div className="w-72 border-r border-[#c6c6cd] bg-[#f2f4f6] flex flex-col flex-shrink-0">
                <div className="p-4 border-b border-[#c6c6cd] bg-white">
                  <div className="relative">
                    <input
                      className="w-full pl-9 pr-4 py-2 bg-[#eceef0] rounded-lg border-none text-sm focus:ring-1 focus:ring-[#0078D4] outline-none"
                      placeholder="Search mail..."
                      type="text"
                      readOnly
                    />
                    <span className="material-symbols-outlined absolute left-2 top-2 text-[#45464d]" style={{ fontSize: 20 }}>search</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto d2-custom-scrollbar">
                  <div className="p-3 bg-[#d0e1fb]/30 border-l-4 border-[#0078D4]">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-[13px]">Shane McCaw</span>
                      <span className="text-[10px] text-[#76777d]">10:42 AM</span>
                    </div>
                    <p className="text-[12px] font-semibold text-[#191c1e] truncate">Update: Tenant Config Review</p>
                    <p className="text-[11px] text-[#45464d] line-clamp-1">I've reviewed the exports you sent yesterday...</p>
                  </div>
                  <div className="p-3 border-b border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-[13px]">Support Team</span>
                      <span className="text-[10px] text-[#76777d]">Yesterday</span>
                    </div>
                    <p className="text-[12px] text-[#191c1e] truncate">Onboarding Completed</p>
                    <p className="text-[11px] text-[#45464d] line-clamp-1">Your secure vault is now ready for use...</p>
                  </div>
                  <div className="p-3 border-b border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-[13px]">Billing Dept</span>
                      <span className="text-[10px] text-[#76777d]">Oct 18</span>
                    </div>
                    <p className="text-[12px] text-[#191c1e] truncate">Invoice #INV-2023-089</p>
                    <p className="text-[11px] text-[#45464d] line-clamp-1">Please find the attached invoice for the M365...</p>
                  </div>
                </div>
              </div>
              {/* Message pane */}
              <div className="flex-1 flex flex-col bg-white">
                <div className="p-4 border-b border-[#c6c6cd] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#191c1e] rounded-full flex items-center justify-center text-white font-bold text-[12px]">SM</div>
                    <div>
                      <h4 className="font-bold text-sm">Shane McCaw</h4>
                      <p className="text-[10px] text-[#0c9488]">Online · Lead Consultant</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[#45464d]">
                    <span className="material-symbols-outlined cursor-pointer hover:text-[#0078D4]" style={{ fontSize: 20 }}>archive</span>
                    <span className="material-symbols-outlined cursor-pointer hover:text-[#0078D4]" style={{ fontSize: 20 }}>report</span>
                    <span className="material-symbols-outlined cursor-pointer hover:text-[#ba1a1a] text-[#ba1a1a]" style={{ fontSize: 20 }}>delete</span>
                  </div>
                </div>
                <div className="flex-1 p-6 overflow-y-auto d2-custom-scrollbar space-y-4">
                  <div className="flex flex-col items-end gap-1">
                    <div className="bg-[#d0e1fb] text-[#0b1c30] p-3 rounded-2xl rounded-tr-none max-w-[80%] text-[13px]">
                      Hello Shane, I've uploaded the global configuration exports to the vault as requested. Could you confirm receipt?
                    </div>
                    <span className="text-[10px] text-[#76777d]">Sent 9:15 AM</span>
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <div className="bg-[#e6e8ea] text-[#191c1e] p-3 rounded-2xl rounded-tl-none max-w-[80%] text-[13px]">
                      Confirmed! I'm seeing 4 files in the secure vault. I'll begin the review process now and should have the initial assessment findings for the Stage 5 review by tomorrow.
                    </div>
                    <span className="text-[10px] text-[#76777d]">Shane McCaw · 10:42 AM</span>
                  </div>
                </div>
                <div className="p-4 border-t border-[#c6c6cd]">
                  <div className="flex items-center gap-2 bg-[#eceef0] p-2 rounded-xl">
                    <button className="text-[#45464d] p-1 hover:text-[#0078D4]">
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>attach_file</span>
                    </button>
                    <input className="flex-1 bg-transparent border-none focus:ring-0 text-sm outline-none" placeholder="Type a message..." type="text" readOnly />
                    <button className="bg-[#191c1e] text-white p-2 rounded-lg">
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>send</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Service Calendar */}
          <section className="lg:col-span-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-semibold text-[#191c1e]">Service Calendar</h3>
            </div>
            <div className="bg-white p-6 rounded-xl border border-[#c6c6cd] d2-card-elevation h-[450px] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <span className="font-bold text-base">October 2023</span>
                <div className="flex gap-1">
                  <button className="p-1 hover:bg-[#eceef0] rounded"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span></button>
                  <button className="p-1 hover:bg-[#eceef0] rounded"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span></button>
                </div>
              </div>
              <div className="grid grid-cols-7 text-center mb-2">
                {["S","M","T","W","T","F","S"].map((d, i) => (
                  <span key={i} className="text-[10px] text-[#76777d] font-bold">{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {[24,25,26,27,28,29,30].map(d => (
                  <div key={`prev-${d}`} className="h-8 flex items-center justify-center text-[11px] text-[#76777d]">{d}</div>
                ))}
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                  <div key={d} className={`h-8 flex items-center justify-center text-[11px] font-bold rounded-full ${d === 12 ? "bg-[#191c1e] text-white" : d === 24 ? "bg-[#89f5e7] text-[#005049]" : "text-[#191c1e]"}`}>
                    {d}
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-[#c6c6cd] space-y-3 overflow-y-auto d2-custom-scrollbar flex-1">
                <div className="flex items-start gap-3">
                  <div className="w-1 bg-[#0c9488] h-10 rounded flex-shrink-0"></div>
                  <div>
                    <p className="text-[11px] font-bold">Oct 24 · Milestone</p>
                    <p className="text-[12px] text-[#45464d]">M365 Configuration Report Delivery</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-1 bg-[#505f76] h-10 rounded flex-shrink-0"></div>
                  <div>
                    <p className="text-[11px] font-bold">Oct 26 · Meeting</p>
                    <p className="text-[12px] text-[#45464d]">Post-Audit Review Call (30 min)</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Service Reports + Document Vault */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Service Reports */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-semibold text-[#191c1e]">Service Reports</h3>
            </div>
            <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation p-6 space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[#191c1e]" style={{ fontSize: 20 }}>folder_open</span>
                  <h4 className="font-bold text-sm text-[#191c1e]">M365 Health Check Reports</h4>
                </div>
                <div className="space-y-2 ml-7">
                  {[
                    { name: "Initial Discovery Findings - Final", date: "Oct 12, 2023" },
                    { name: "Security Posture Audit Draft", date: "In Progress" },
                  ].map((r) => (
                    <div key={r.name} className="flex items-center justify-between p-3 bg-[#f2f4f6] rounded border border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-[#ba1a1a]" style={{ fontSize: 20 }}>picture_as_pdf</span>
                        <span className="text-sm">{r.name}</span>
                      </div>
                      <span className="text-[10px] text-[#76777d]">{r.date}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[#191c1e]" style={{ fontSize: 20 }}>folder_open</span>
                  <h4 className="font-bold text-sm text-[#191c1e]">Monthly Infrastructure Audits</h4>
                </div>
                <div className="space-y-2 ml-7">
                  <div className="flex items-center justify-between p-3 bg-[#f2f4f6] rounded border border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[#0c9488]" style={{ fontSize: 20 }}>table_chart</span>
                      <span className="text-sm">Resource Utilization Summary - Sept</span>
                    </div>
                    <span className="text-[10px] text-[#76777d]">Oct 05, 2023</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Secure Document Vault */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-semibold text-[#191c1e]">Secure Document Vault</h3>
              <button className="bg-[#191c1e] text-white px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>upload_file</span>
                <span>Upload to Vault</span>
              </button>
            </div>
            <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation p-6 space-y-6">
              {/* Legal */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[#191c1e]" style={{ fontSize: 20 }}>gavel</span>
                  <h4 className="font-bold text-sm text-[#191c1e]">Legal &amp; Master Agreements</h4>
                </div>
                <div className="ml-7 rounded border border-[#c6c6cd]/30 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <tbody>
                      <tr className="hover:bg-[#eceef0]/30 transition-colors bg-[#f2f4f6]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-[#0c9488]" style={{ fontSize: 20 }}>verified</span>
                            <div>
                              <p className="text-sm font-semibold">Master Services Agreement (MSA)</p>
                              <p className="text-[10px] text-[#76777d]">Last accessed: 2 days ago</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center w-24">
                          <span className="px-2 py-0.5 bg-[#eceef0] text-[#45464d] rounded text-[10px] font-bold">CONTRACT</span>
                        </td>
                        <td className="px-4 py-3 text-right w-24">
                          <button className="text-[#45464d] hover:text-[#191c1e]"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span></button>
                          <button className="text-[#45464d] hover:text-[#191c1e] ml-2"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>visibility</span></button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              {/* M365 Docs */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[#191c1e]" style={{ fontSize: 20 }}>health_and_safety</span>
                  <h4 className="font-bold text-sm text-[#191c1e]">M365 Health Check Documents</h4>
                </div>
                <div className="ml-7 rounded border border-[#c6c6cd]/30 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <tbody>
                      <tr className="hover:bg-[#eceef0]/30 transition-colors bg-[#f2f4f6]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-[#0c9488]" style={{ fontSize: 20 }}>description</span>
                            <div>
                              <p className="text-sm font-semibold">M365 Health Check SOW</p>
                              <p className="text-[10px] text-[#76777d]">Uploaded Oct 10, 2023</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center w-24">
                          <span className="px-2 py-0.5 bg-[#d0e1fb] text-[#54647a] rounded text-[10px] font-bold">PROJECT</span>
                        </td>
                        <td className="px-4 py-3 text-right w-24">
                          <button className="text-[#45464d] hover:text-[#191c1e]"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span></button>
                          <button className="text-[#45464d] hover:text-[#191c1e] ml-2"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>visibility</span></button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Security Audit Docs */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[#191c1e]" style={{ fontSize: 20 }}>security</span>
                  <h4 className="font-bold text-sm text-[#191c1e]">Security Audit Documents</h4>
                </div>
                <div className="ml-7 rounded border border-[#c6c6cd]/30 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <tbody>
                      <tr className="hover:bg-[#eceef0]/30 transition-colors bg-[#f2f4f6]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-[#ba1a1a]" style={{ fontSize: 20 }}>assignment_late</span>
                            <div>
                              <p className="text-sm font-semibold">Security Gap Recommendations</p>
                              <p className="text-[10px] text-[#ba1a1a] font-bold">Pending Approval</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center w-24">
                          <span className="px-2 py-0.5 bg-[#ffdad6] text-[#93000a] rounded text-[10px] font-bold">AUDIT</span>
                        </td>
                        <td className="px-4 py-3 text-right w-24">
                          <button className="text-[#45464d] hover:text-[#191c1e]"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span></button>
                          <button className="text-[#45464d] hover:text-[#191c1e] ml-2"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>drive_file_rename_outline</span></button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Financial Overview */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-semibold text-[#191c1e]">Financial Overview</h3>
            <div className="flex gap-4">
              <div className="bg-[#e6e8ea] px-4 py-2 rounded-lg border border-[#c6c6cd]">
                <p className="text-[10px] font-semibold uppercase text-[#45464d]">Total Due</p>
                <p className="font-bold text-lg">$1,245.50</p>
              </div>
              <div className="bg-[#0c9488]/10 px-4 py-2 rounded-lg border border-[#0c9488]/20">
                <p className="text-[10px] font-semibold uppercase text-[#0c9488]">Credits Available</p>
                <p className="font-bold text-lg text-[#0c9488]">$450.00</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-[#f2f4f6] border-b border-[#c6c6cd]">
                <tr>
                  {["Invoice #", "Date Issued", "Due Date", "Amount", "Status", "Action"].map((h, i) => (
                    <th key={h} className={`px-6 py-4 text-[10px] uppercase font-semibold tracking-wider text-[#45464d]${i === 5 ? " text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c6c6cd]/30 text-sm">
                <tr>
                  <td className="px-6 py-4 font-mono text-sm">INV-2023-089</td>
                  <td className="px-6 py-4">Oct 15, 2023</td>
                  <td className="px-6 py-4">Nov 15, 2023</td>
                  <td className="px-6 py-4 font-bold text-[#191c1e]">$497.00</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 bg-[#ffdad6] text-[#93000a] rounded-full text-[10px] font-bold">UNPAID</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="bg-[#191c1e] text-white px-3 py-1 rounded text-[11px] font-semibold hover:opacity-90">Pay Now</button>
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-mono text-sm">INV-2023-082</td>
                  <td className="px-6 py-4">Sept 28, 2023</td>
                  <td className="px-6 py-4">Oct 28, 2023</td>
                  <td className="px-6 py-4 font-bold text-[#191c1e]">$748.50</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 bg-[#89f5e7] text-[#005049] rounded-full text-[10px] font-bold">PROCESSING</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-[#45464d] hover:text-[#191c1e]"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>receipt_long</span></button>
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-mono text-sm">INV-2023-075</td>
                  <td className="px-6 py-4">Aug 12, 2023</td>
                  <td className="px-6 py-4">Sept 12, 2023</td>
                  <td className="px-6 py-4 font-bold text-[#191c1e]">$1,200.00</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 bg-[#0c9488] text-white rounded-full text-[10px] font-bold">PAID</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-[#45464d] hover:text-[#191c1e]"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Active Pipeline Kanban */}
        <section>
          <div className="flex items-center gap-4 mb-8">
            <h3 className="text-2xl font-semibold text-[#191c1e]">Active Pipeline</h3>
            <div className="h-[1px] flex-1 bg-[#c6c6cd]"></div>
            <div className="flex gap-4 items-center">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#0c9488]"></span>
                <span className="text-[11px] font-semibold text-[#45464d]">M365</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#505f76]"></span>
                <span className="text-[11px] font-semibold text-[#45464d]">Security</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#191c1e]"></span>
                <span className="text-[11px] font-semibold text-[#45464d]">Migration</span>
              </div>
              <button className="p-2 border border-[#c6c6cd] rounded hover:bg-[#eceef0] transition-colors ml-2">
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>filter_list</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pb-4">
            {/* Backlog */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#76777d]"></span>
                  <span className="text-[11px] uppercase tracking-widest font-semibold text-[#45464d]">Backlog</span>
                </div>
                <span className="text-[11px] text-[#76777d] font-mono">2</span>
              </div>
              <div className="d2-kanban-column border-2 border-dashed border-[#c6c6cd] rounded-xl p-4 min-h-[400px] space-y-4">
                <div className="bg-white p-4 rounded border-l-4 border-l-[#505f76] border border-[#c6c6cd] d2-card-elevation">
                  <span className="px-2 py-0.5 bg-[#d0e1fb] text-[#54647a] rounded text-[10px] font-bold uppercase mb-2 inline-block">Security Audit</span>
                  <h6 className="text-sm font-semibold mb-3">Vulnerability Scan Initiation</h6>
                  <div className="flex justify-between items-center mt-4">
                    <span className="text-[10px] text-[#76777d] font-mono">SEC-002</span>
                    <div className="w-6 h-6 rounded-full bg-[#b7c8e1] flex items-center justify-center text-[10px] text-white font-bold">SA</div>
                  </div>
                </div>
                <div className="bg-white p-4 rounded border-l-4 border-l-[#191c1e] border border-[#c6c6cd] d2-card-elevation">
                  <span className="px-2 py-0.5 bg-[#131b2e] text-[#7c839b] rounded text-[10px] font-bold uppercase mb-2 inline-block">Migration</span>
                  <h6 className="text-sm font-semibold mb-3">Azure Landing Zone Design</h6>
                  <div className="flex justify-between items-center mt-4">
                    <span className="text-[10px] text-[#76777d] font-mono">MIG-005</span>
                    <div className="w-6 h-6 rounded-full bg-[#dae2fd] flex items-center justify-center text-[10px] font-bold">AZ</div>
                  </div>
                </div>
              </div>
            </div>

            {/* In Progress */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#6bd8cb]"></span>
                  <span className="text-[11px] uppercase tracking-widest font-semibold text-[#45464d]">In Progress</span>
                </div>
                <span className="text-[11px] text-[#76777d] font-mono">1</span>
              </div>
              <div className="d2-kanban-column border-2 border-dashed border-[#c6c6cd] rounded-xl p-4 min-h-[400px] space-y-4">
                <div className="bg-white p-4 rounded border-l-4 border-l-[#0c9488] border border-[#c6c6cd] d2-card-elevation">
                  <span className="px-2 py-0.5 bg-[#89f5e7] text-[#005049] rounded text-[10px] font-bold uppercase mb-2 inline-block">M365 Health Check</span>
                  <h6 className="text-sm font-semibold mb-3">Teams &amp; SharePoint Governance Audit</h6>
                  <div className="w-full h-1 bg-[#eceef0] rounded-full overflow-hidden mt-4">
                    <div className="h-full bg-[#0c9488]" style={{ width: "45%" }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Required */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#ba1a1a] animate-pulse"></span>
                  <span className="text-[11px] uppercase tracking-widest font-bold text-[#ba1a1a]">Action Required</span>
                </div>
                <span className="text-[11px] text-[#ba1a1a] font-mono font-bold">1</span>
              </div>
              <div className="d2-kanban-column border-2 border-dashed border-[#ffdad6] bg-[#ffdad6]/10 rounded-xl p-4 min-h-[400px] space-y-4">
                <div className="bg-white p-4 rounded border-2 border-[#ba1a1a] d2-card-elevation relative rotate-1">
                  <div className="absolute -top-3 -right-2 bg-[#ba1a1a] text-white px-2 py-0.5 rounded text-[10px] font-bold shadow-lg">M365 URGENT</div>
                  <span className="px-2 py-0.5 bg-[#ffdad6] text-[#93000a] rounded text-[10px] font-bold uppercase mb-2 inline-block">Compliance</span>
                  <h6 className="text-sm font-bold text-[#191c1e] mb-2">Upload Tenant Config Files</h6>
                  <button className="w-full mt-4 py-2 bg-[#ba1a1a] text-white rounded text-[11px] font-semibold flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>upload_file</span>
                    <span>Upload Now</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Completed */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#0c9488]"></span>
                  <span className="text-[11px] uppercase tracking-widest font-semibold text-[#45464d]">Completed</span>
                </div>
                <span className="text-[11px] text-[#76777d] font-mono">2</span>
              </div>
              <div className="d2-kanban-column border-2 border-dashed border-[#c6c6cd] rounded-xl p-4 min-h-[400px] space-y-4">
                <div className="bg-[#eceef0] p-4 rounded border border-[#c6c6cd] opacity-75">
                  <span className="material-symbols-outlined text-[#0c9488] float-right" style={{ fontSize: 18 }}>check_circle</span>
                  <span className="text-[10px] font-bold text-[#0c9488] uppercase block mb-1">M365</span>
                  <h6 className="text-sm font-semibold mb-1 line-through text-[#45464d]">Initial Audit Session</h6>
                  <p className="text-[10px] text-[#45464d]">Completed Oct 12</p>
                </div>
                <div className="bg-[#eceef0] p-4 rounded border border-[#c6c6cd] opacity-75">
                  <span className="material-symbols-outlined text-[#505f76] float-right" style={{ fontSize: 18 }}>check_circle</span>
                  <span className="text-[10px] font-bold text-[#505f76] uppercase block mb-1">Security</span>
                  <h6 className="text-sm font-semibold mb-1 line-through text-[#45464d]">MSA Signature Process</h6>
                  <p className="text-[10px] text-[#45464d]">Completed Oct 08</p>
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </PortalLayout>
  );
}
