export const REQUIRED_PERMISSIONS = [
  {
    category: "Entra ID",
    permissions: [
      { permission: "Directory.Read.All", reason: "Read all directory objects — users, groups, and organisational structure" },
      { permission: "User.Read.All", reason: "Enumerate users and resolve UPNs across the M365 tenant" },
      { permission: "Group.Read.All", reason: "Read Microsoft 365 groups used by SharePoint and Teams" },
      { permission: "RoleManagement.Read.Directory", reason: "Inspect directory role assignments for governance reporting" },
    ],
  },
  {
    category: "Audit & Security",
    permissions: [
      { permission: "AuditLog.Read.All", reason: "Access audit logs for compliance and security reporting runbooks" },
      { permission: "SecurityEvents.Read.All", reason: "Read security alerts and events for threat-assessment reports" },
    ],
  },
  {
    category: "Exchange",
    permissions: [
      { permission: "Exchange.ManageAsApp", reason: "Connect to Exchange Online PowerShell as an application identity" },
      { permission: "Mail.Read", reason: "Read mailbox messages for reporting and compliance runbooks" },
      { permission: "MailboxSettings.Read", reason: "Read mailbox settings such as OOF configurations and language preferences" },
    ],
  },
  {
    category: "SharePoint / OneDrive",
    permissions: [
      { permission: "Sites.Read.All", reason: "Read SharePoint sites and document libraries for reporting and auditing" },
      { permission: "Files.Read.All", reason: "Read files across all OneDrive and SharePoint document libraries" },
    ],
  },
  {
    category: "Teams",
    permissions: [
      { permission: "Team.ReadBasic.All", reason: "List all teams and read basic team properties" },
      { permission: "TeamSettings.Read.All", reason: "Read team settings and configurations for governance runbooks" },
      { permission: "Channel.ReadBasic.All", reason: "List channels and read basic channel properties" },
    ],
  },
  {
    category: "Licensing",
    permissions: [
      { permission: "Organization.Read.All", reason: "Read organisation profile and subscribed SKUs for licensing runbooks" },
      { permission: "Reports.Read.All", reason: "Access Microsoft 365 usage reports for adoption and compliance dashboards" },
    ],
  },
  {
    category: "Compliance",
    permissions: [
      { permission: "Compliance.Read.All", reason: "Read compliance-related data for policy and regulatory reporting runbooks" },
      { permission: "ThreatAssessment.Read.All", reason: "Read threat assessment requests for security health reports" },
    ],
  },
];
