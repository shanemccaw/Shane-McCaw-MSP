/**
 * Project Management studio screen module.
 *
 * Provides a dedicated Gantt chart, Milestone timeline, and Epic roadmap.
 * Registered at /project-management.
 */

import { Flag, Target, Plus, Calendar } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ProjectManagementBody } from "./ProjectManagementBody";

export const ROUTE = "/project-management";

registerScreen({
  id: "project-management",
  title: "Project Management",
  area: "build",
  route: ROUTE,
  icon: Target,

  ribbon: [
    {
      tab: "build",
      group: {
        label: "Project",
        large: [
          {
            label: "Gantt & Milestones",
            icon: Target,
            intent: "open",
            color: ACCENT.amber,
            onSelect: () => getShellApi()?.navigate(ROUTE),
            title: "Open ADHD-friendly Project Gantt Chart & Milestone Timeline",
          },
        ],
      },
    },
  ],

  render: () => <ProjectManagementBody />,
});
